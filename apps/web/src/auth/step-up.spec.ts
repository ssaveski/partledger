import { translate } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import type { Fetcher } from './session';
import {
  isStepUpRequired,
  pendingCommandLifetimeMilliseconds,
  pendingCommandStorageKey,
  resumeAfterStepUp,
  sendCommand,
  stepUpUrl,
  type Navigation,
  type PendingStorage,
} from './step-up';

const stepUpError = { error: 'StepUpRequired', message: 'pl.error.stepUpRequired.recentAuthentication', params: {} };
const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const approval = {
  name: 'internalTest.approveNote',
  body: { noteId: '3f6c1d2e-8a9b-4c7d-9e0f-1a2b3c4d5e6f', expectedVersion: 1 },
  idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
};

function answering(...answers: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: Fetcher = (url, init) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? { status: 500, body: null };
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
  return { fetcher, calls };
}

function memoryStorage(): PendingStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function page(pathname: string, search = '') {
  const assigned: string[] = [];
  const location: Navigation = {
    pathname,
    search,
    hash: '',
    assign: (url: string | URL) => {
      assigned.push(String(url));
    },
  };
  return { location, assigned };
}

describe('step-up in the staff app', () => {
  it('tells the step-up error apart from the uniform 401 of a refused session', () => {
    expect(isStepUpRequired(401, stepUpError)).toBe(true);
    expect(isStepUpRequired(401, uniform401)).toBe(false);
    expect(isStepUpRequired(403, stepUpError)).toBe(false);
    expect(isStepUpRequired(401, '<html>proxy</html>')).toBe(false);
  });

  it('starts a step-up through the API and comes back to a path on this app only', () => {
    expect(stepUpUrl('/rfqs/42?tab=award')).toBe('/api/v1/auth/step-up?returnTo=%2Frfqs%2F42%3Ftab%3Daward');
    expect(stepUpUrl('//attacker.example')).toBe('/api/v1/auth/step-up?returnTo=%2F');
  });

  it('sends a command that needs no step-up once and returns its answer', async () => {
    const { fetcher, calls } = answering({ status: 200, body: { noteId: approval.body.noteId, version: 2 } });
    const storage = memoryStorage();
    const { location, assigned } = page('/notes');
    expect(await sendCommand(approval, { fetcher, storage, location })).toEqual({
      kind: 'answered',
      status: 200,
      body: { noteId: approval.body.noteId, version: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/v1/commands/internalTest.approveNote');
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-partledger-request': 'staff-app',
      'idempotency-key': approval.idempotencyKey,
    });
    expect(assigned).toEqual([]);
    expect(storage.items.size).toBe(0);
  });

  it('keeps the command and leaves for the step-up when the API asks for one', async () => {
    const { fetcher } = answering({ status: 401, body: stepUpError });
    const storage = memoryStorage();
    const { location, assigned } = page('/notes/42', '?tab=approval&stepUp=failed');
    expect(await sendCommand(approval, { fetcher, storage, location, now: () => 1000 })).toEqual({
      kind: 'steppingUp',
    });
    expect(assigned).toEqual(['/api/v1/auth/step-up?returnTo=%2Fnotes%2F42%3Ftab%3Dapproval']);
    expect(JSON.parse(storage.items.get(pendingCommandStorageKey) ?? 'null')).toEqual({ ...approval, savedAt: 1000 });
  });

  it('retries the command once after the step-up, with the same idempotency key', async () => {
    const storage = memoryStorage();
    await sendCommand(approval, {
      fetcher: answering({ status: 401, body: stepUpError }).fetcher,
      storage,
      location: page('/notes/42').location,
      now: () => 1000,
    });
    const { fetcher, calls } = answering({ status: 200, body: { noteId: approval.body.noteId, version: 2 } });
    const returned = page('/notes/42');
    expect(await resumeAfterStepUp({ fetcher, storage, location: returned.location, now: () => 61_000 })).toEqual({
      kind: 'answered',
      status: 200,
      body: { noteId: approval.body.noteId, version: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers).toMatchObject({ 'idempotency-key': approval.idempotencyKey });
    expect(calls[0]?.init?.body).toBe(JSON.stringify(approval.body));
    expect(storage.items.size).toBe(0);
    expect(await resumeAfterStepUp({ fetcher, storage, location: returned.location })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('drops the command with a translated message when the step-up did not complete', async () => {
    const storage = memoryStorage();
    storage.setItem(pendingCommandStorageKey, JSON.stringify({ ...approval, savedAt: 1000 }));
    const { fetcher, calls } = answering({ status: 200, body: {} });
    const outcome = await resumeAfterStepUp({
      fetcher,
      storage,
      location: page('/notes/42', '?stepUp=failed').location,
      now: () => 2000,
    });
    expect(outcome).toEqual({ kind: 'stepUpFailed', messageKey: 'pl.auth.stepUpFailed' });
    expect(translate('pl.auth.stepUpFailed')).toMatch(/could not confirm your identity/);
    expect(calls).toHaveLength(0);
    expect(storage.items.size).toBe(0);
  });

  it('never replays a pending command older than a step-up can take', async () => {
    const storage = memoryStorage();
    storage.setItem(pendingCommandStorageKey, JSON.stringify({ ...approval, savedAt: 0 }));
    const { fetcher, calls } = answering({ status: 200, body: {} });
    const outcome = await resumeAfterStepUp({
      fetcher,
      storage,
      location: page('/notes/42').location,
      now: () => pendingCommandLifetimeMilliseconds + 1,
    });
    expect(outcome?.kind).toBe('stepUpFailed');
    expect(calls).toHaveLength(0);
  });

  it('asks for a step-up only once: a second step-up error after the retry ends the attempt', async () => {
    const storage = memoryStorage();
    storage.setItem(pendingCommandStorageKey, JSON.stringify({ ...approval, savedAt: 1000 }));
    const { fetcher } = answering({ status: 401, body: stepUpError });
    const returned = page('/notes/42');
    const outcome = await resumeAfterStepUp({ fetcher, storage, location: returned.location, now: () => 2000 });
    expect(outcome?.kind).toBe('stepUpFailed');
    expect(returned.assigned).toEqual([]);
  });

  it('ignores a tampered or unreadable pending command', async () => {
    const storage = memoryStorage();
    storage.setItem(pendingCommandStorageKey, '{"name":1}');
    const { fetcher, calls } = answering({ status: 200, body: {} });
    expect(await resumeAfterStepUp({ fetcher, storage, location: page('/').location })).toBeNull();
    storage.setItem(pendingCommandStorageKey, 'not json');
    expect(await resumeAfterStepUp({ fetcher, storage, location: page('/').location })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('answers unavailable, keeping nothing, when the API cannot be reached', async () => {
    const unreachable: Fetcher = () => Promise.reject(new TypeError('network'));
    const storage = memoryStorage();
    expect(await sendCommand(approval, { fetcher: unreachable, storage, location: page('/').location })).toEqual({
      kind: 'unavailable',
      messageKey: 'pl.auth.sessionUnavailable',
    });
    expect(storage.items.size).toBe(0);
  });
});
