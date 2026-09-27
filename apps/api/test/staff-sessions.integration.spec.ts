import { randomUUID } from 'node:crypto';

import { staffAuthPaths, staffRequestHeader, staffSessionSchema } from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { IdentityProvider, RefreshOutcome } from '../src/auth/identity-provider';
import { sessionCookieName } from '../src/auth/session-cookie';
import {
  credentialHeaders,
  newIdempotencyKey,
  startApiHarness,
  stubIdentity,
  stubIdentityProvider,
  type ApiHarness,
} from './support/api-harness';
import { placeholderAuthEnvironment } from './support/auth-environment';

const idleMinutes = 30;
const refreshSeconds = 60;
const unavailable503 = { error: 'Unavailable', message: 'pl.error.unavailable.dependencyUnavailable', params: {} };
const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const endReasons = z.array(z.object({ end_reason: z.string().nullable() }));

type NextRefresh = 'refreshed' | 'refused' | 'unavailable' | 'another_tenant';

describe('staff session lifetimes', () => {
  let harness: ApiHarness;
  let nextRefresh: NextRefresh = 'refreshed';
  const refreshes: string[] = [];

  const identityProvider: IdentityProvider = {
    ...stubIdentityProvider,
    refresh(refreshToken): Promise<RefreshOutcome> {
      refreshes.push(nextRefresh);
      const identity = stubIdentity.parse(JSON.parse(refreshToken));
      switch (nextRefresh) {
        case 'refreshed':
          return Promise.resolve({ kind: 'refreshed', identity, refreshToken });
        case 'refused':
          return Promise.resolve({ kind: 'refused', reason: 'code_refused' });
        case 'unavailable':
          return Promise.resolve({ kind: 'unavailable' });
        case 'another_tenant':
          return Promise.resolve({
            kind: 'refreshed',
            identity: { ...identity, tenantId: randomUUID() },
            refreshToken,
          });
      }
    },
  };

  beforeAll(async () => {
    harness = await startApiHarness({
      identityProvider,
      authEnvironment: placeholderAuthEnvironment({
        STAFF_SESSION_IDLE_TIMEOUT_MINUTES: String(idleMinutes),
        STAFF_SESSION_REFRESH_INTERVAL_SECONDS: String(refreshSeconds),
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  function readSession(token: string) {
    return fetch(`${harness.api.listeners.urls.staff}${staffAuthPaths.session}`, {
      headers: credentialHeaders('staff', token),
    });
  }

  async function endReasonOf(credentialId: string): Promise<string | null | undefined> {
    const result = await harness.superuser.query('select end_reason from staff_sessions where credential_id = $1', [
      credentialId,
    ]);
    return endReasons.parse(result.rows)[0]?.end_reason;
  }

  it('reports the session with its absolute and idle expiry', async () => {
    const person = await harness.issue('staff_session', harness.tenantA);
    const response = await readSession(person.token);
    expect(response.status).toBe(200);
    const session = staffSessionSchema.parse(await response.json());
    expect(session).toMatchObject({ userId: person.subjectId, tenantId: harness.tenantA });
    expect(Date.parse(session.idleExpiresAt) - harness.clock.now().getTime()).toBeGreaterThan(
      (idleMinutes - 1) * 60_000,
    );
  });

  it('activity within the idle timeout keeps the session alive', async () => {
    const person = await harness.issue('staff_session', harness.tenantA, { expiresInMilliseconds: 10 * 3_600_000 });
    for (let step = 0; step < 3; step += 1) {
      harness.clock.advance((idleMinutes - 5) * 60_000);
      expect((await readSession(person.token)).status, `step ${String(step)}`).toBe(200);
    }
  });

  it('a session idle past the idle timeout ends and stays ended', async () => {
    const person = await harness.issue('staff_session', harness.tenantA, { expiresInMilliseconds: 10 * 3_600_000 });
    harness.clock.advance(idleMinutes * 60_000 + 1000);
    const response = await readSession(person.token);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(uniform401);
    expect(await endReasonOf(person.credentialId)).toBe('idle_timeout');
    expect((await readSession(person.token)).status).toBe(401);
  });

  it('a session past its absolute timeout is refused however active it is', async () => {
    const person = await harness.issue('staff_session', harness.tenantA, { expiresInMilliseconds: 20 * 60_000 });
    harness.clock.advance(15 * 60_000);
    expect((await readSession(person.token)).status).toBe(200);
    harness.clock.advance(6 * 60_000);
    expect((await readSession(person.token)).status).toBe(401);
  });

  it('refreshes only once the refresh interval has passed', async () => {
    const person = await harness.issue('staff_session', harness.tenantA);
    refreshes.length = 0;
    expect((await readSession(person.token)).status).toBe(200);
    expect(refreshes).toEqual([]);
    harness.clock.advance(refreshSeconds * 1000);
    expect((await readSession(person.token)).status).toBe(200);
    expect((await readSession(person.token)).status).toBe(200);
    expect(refreshes).toEqual(['refreshed']);
  });

  it('a refused refresh ends the session', async () => {
    const person = await harness.issue('staff_session', harness.tenantA);
    harness.clock.advance(refreshSeconds * 1000);
    nextRefresh = 'refused';
    try {
      expect((await readSession(person.token)).status).toBe(401);
    } finally {
      nextRefresh = 'refreshed';
    }
    expect(await endReasonOf(person.credentialId)).toBe('refresh_failed');
    expect((await readSession(person.token)).status).toBe(401);
  });

  it('an unreachable identity provider answers 503 on the session, command and query routes and keeps the session', async () => {
    const person = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    harness.clock.advance(refreshSeconds * 1000);
    nextRefresh = 'unavailable';
    try {
      const session = await readSession(person.token);
      expect(session.status).toBe(503);
      expect(await session.json()).toEqual(unavailable503);
      const command = await harness.command(
        'staff',
        'internalTest.createNote',
        { title: 'Outage synthetic note' },
        { token: person.token, idempotencyKey: newIdempotencyKey() },
      );
      expect(command.status).toBe(503);
      expect(command.body).toEqual(unavailable503);
      const query = await harness.query('staff', 'internalTest.getNote', { noteId: randomUUID() }, person.token);
      expect(query.status).toBe(503);
    } finally {
      nextRefresh = 'refreshed';
    }
    expect(await endReasonOf(person.credentialId)).toBeNull();
    expect((await readSession(person.token)).status).toBe(200);
  });

  it('a refresh that names another tenant ends the session', async () => {
    const person = await harness.issue('staff_session', harness.tenantA);
    harness.clock.advance(refreshSeconds * 1000);
    nextRefresh = 'another_tenant';
    try {
      expect((await readSession(person.token)).status).toBe(401);
    } finally {
      nextRefresh = 'refreshed';
    }
    expect(await endReasonOf(person.credentialId)).toBe('identity_changed');
  });

  it('signing out without a session still clears the cookie', async () => {
    const response = await fetch(`${harness.api.listeners.urls.staff}${staffAuthPaths.signOut}`, {
      method: 'POST',
      headers: { [staffRequestHeader.name]: staffRequestHeader.value },
    });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([
      `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    ]);
  });

  it('the sign-in and session routes exist only on the staff listener', async () => {
    const person = await harness.issue('staff_session', harness.tenantA);
    for (const adapter of ['portal', 'drop', 'operator'] as const) {
      const base = harness.api.listeners.urls[adapter];
      for (const path of [staffAuthPaths.signIn, staffAuthPaths.callback, staffAuthPaths.session]) {
        const response = await fetch(`${base}${path}`, {
          redirect: 'manual',
          headers: { cookie: `${sessionCookieName}=${person.token}` },
        });
        expect(response.status, `${adapter} ${path}`).toBe(404);
      }
    }
  });

  it('a session of another tenant never reads as this tenant', async () => {
    const person = await harness.issue('staff_session', harness.tenantB);
    const session = staffSessionSchema.parse(await (await readSession(person.token)).json());
    expect(session.tenantId).toBe(harness.tenantB);
  });
});
