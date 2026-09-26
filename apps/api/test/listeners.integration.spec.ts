import { correlationIdHeader, healthResponseSchema } from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { formatCredentialToken } from '../src/principals/credential-token';
import { newIdempotencyKey, startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';

const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const createdNote = z.object({ noteId: z.uuid(), version: z.number().int() });
const noteRows = z.array(z.object({ tenant_id: z.uuid(), created_by: z.uuid().nullable(), actor_type: z.string() }));

describe('listeners, principals and access', () => {
  let harness: ApiHarness;
  let buyer: IssuedToken;
  let supplierLink: IssuedToken;

  beforeAll(async () => {
    harness = await startApiHarness();
    buyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    supplierLink = await harness.issue('supplier_link', harness.tenantA);
  });

  afterAll(async () => {
    await harness.close();
  });

  function createNote(adapter: 'staff' | 'portal' | 'drop' | 'operator', token: string | undefined, body: object) {
    return harness.command(
      adapter,
      'internalTest.createNote',
      body,
      token === undefined ? { idempotencyKey: newIdempotencyKey() } : { token, idempotencyKey: newIdempotencyKey() },
    );
  }

  async function storedNote(noteId: string) {
    const result = await harness.superuser.query(
      'select tenant_id, created_by, actor_type from internal_test_notes where id = $1',
      [noteId],
    );
    return noteRows.parse(result.rows)[0];
  }

  it('serves the health endpoint on every listener', async () => {
    for (const url of Object.values(harness.api.listeners.urls)) {
      const response = await fetch(`${url}/api/v1/health`);
      expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
    }
  });

  it('a portal credential on the staff listener gets 401', async () => {
    const response = await createNote('staff', supplierLink.token, { title: 'Crossed synthetic link' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual(uniform401);
  });

  it('a staff credential on the portal, drop and operator listeners gets 401', async () => {
    for (const adapter of ['portal', 'drop', 'operator'] as const) {
      const response = await createNote(adapter, buyer.token, { title: 'Crossed synthetic session' });
      expect(response.status).toBe(401);
      expect(response.body).toEqual(uniform401);
    }
  });

  it('answers a missing, malformed, unknown, wrong, expired or revoked credential with the same 401', async () => {
    const expired = await harness.issue('staff_session', harness.tenantA, {
      roles: ['buyer'],
      expiresInMilliseconds: 1_000,
    });
    const revoked = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    await harness.superuser.query('update credentials set revoked_at = now() where id = $1', [revoked.credentialId]);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const [, , secret = ''] = buyer.token.split('_');
    const tokens = [
      undefined,
      'not-a-credential',
      formatCredentialToken('staff_session', '00000000-0000-4000-8000-000000000000', secret),
      formatCredentialToken('staff_session', buyer.credentialId, 'A'.repeat(43)),
      expired.token,
      revoked.token,
    ];
    for (const token of tokens) {
      const response = await createNote('staff', token, { title: 'Refused synthetic credential' });
      expect(response.status).toBe(401);
      expect(response.body).toEqual(uniform401);
    }
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Refused synthetic credential'`)).toBe(
      0,
    );
  });

  it('ignores a principal type and tenant in the request body', async () => {
    const response = await createNote('staff', buyer.token, {
      title: 'Body-claimed synthetic principal',
      principal: { type: 'system' },
      actorType: 'platform_operator',
      tenantId: harness.tenantB,
    });
    expect(response.status).toBe(200);
    const note = await storedNote(createdNote.parse(response.body).noteId);
    expect(note).toEqual({ tenant_id: harness.tenantA, created_by: buyer.subjectId, actor_type: 'person' });
  });

  it('takes the principal from the credential on each listener', async () => {
    const drop = await harness.issue('drop_credential', harness.tenantB);
    const fromPortal = await createNote('portal', supplierLink.token, { title: 'Portal synthetic note' });
    const fromDrop = await createNote('drop', drop.token, { title: 'Drop synthetic note' });
    expect(await storedNote(createdNote.parse(fromPortal.body).noteId)).toEqual({
      tenant_id: harness.tenantA,
      created_by: supplierLink.subjectId,
      actor_type: 'supplier_token',
    });
    expect(await storedNote(createdNote.parse(fromDrop.body).noteId)).toEqual({
      tenant_id: harness.tenantB,
      created_by: null,
      actor_type: 'system',
    });
  });

  it('refuses a person without an allowed role with 403 and a message key', async () => {
    for (const roles of [['auditor'], [], ['tenant_admin']] as const) {
      const person = await harness.issue('staff_session', harness.tenantA, { roles });
      const response = await createNote('staff', person.token, { title: 'Unpermitted synthetic note' });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: {} });
    }
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Unpermitted synthetic note'`)).toBe(0);
  });

  it('refuses a step-up command without a recent step-up', async () => {
    const approver = await harness.issue('staff_session', harness.tenantA, { roles: ['approver'] });
    const created = createdNote.parse(
      (await createNote('staff', buyer.token, { title: 'Awaiting synthetic approval' })).body,
    );
    const response = await harness.command(
      'staff',
      'internalTest.approveNote',
      { noteId: created.noteId, expectedVersion: 1 },
      { token: approver.token, idempotencyKey: newIdempotencyKey() },
    );
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'StepUpRequired',
      message: 'pl.error.stepUpRequired.recentAuthentication',
      params: {},
    });
  });

  it('answers invalid input with paths and codes, never the values sent', async () => {
    const response = await createNote('staff', buyer.token, { title: '', delayMilliseconds: 'soon' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid',
      message: 'pl.error.invalid.request',
      issues: [
        { path: ['title'], code: 'too_small' },
        { path: ['delayMilliseconds'], code: 'invalid_type' },
      ],
    });
  });

  it('answers malformed JSON with a message key', async () => {
    const response = await fetch(`${harness.api.listeners.urls.staff}/api/v1/commands/internalTest.createNote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${buyer.token}` },
      body: '{"title":',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid', message: 'pl.error.invalid.request', params: {} });
  });

  it('answers an operation that is not registered with 404 and a message key', async () => {
    const missing = await harness.command('staff', 'internalTest.dropTables', {}, { token: buyer.token });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'NotFound', message: 'pl.error.notFound.route', params: {} });
    const commandAsQuery = await harness.query('staff', 'internalTest.createNote', {}, buyer.token);
    expect(commandAsQuery.status).toBe(404);
  });

  it('sets a correlation id and no-store on every operation response', async () => {
    const response = await createNote('staff', buyer.token, { title: 'Correlated synthetic note' });
    expect(response.headers.get(correlationIdHeader)).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reads return allowed transitions and blocking reasons as message keys', async () => {
    const created = createdNote.parse(
      (await createNote('staff', buyer.token, { title: 'Readable synthetic note' })).body,
    );
    const response = await harness.query('staff', 'internalTest.getNote', { noteId: created.noteId }, buyer.token);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: created.noteId,
      title: 'Readable synthetic note',
      version: 1,
      status: 'draft',
      allowedTransitions: ['rename'],
      blockingReasons: [{ transition: 'approve', message: 'pl.error.forbidden.notPermitted', params: {} }],
    });
  });

  it('an operator reads through its grant on the operator listener only', async () => {
    const created = createdNote.parse(
      (await createNote('staff', buyer.token, { title: 'Operator synthetic note' })).body,
    );
    const operator = await harness.issue('platform_operator', harness.tenantA);
    const onOperator = await harness.query(
      'operator',
      'internalTest.getNote',
      { noteId: created.noteId },
      operator.token,
    );
    expect(onOperator.status).toBe(200);
    const onStaff = await harness.query('staff', 'internalTest.getNote', { noteId: created.noteId }, operator.token);
    expect(onStaff.status).toBe(401);
  });

  it('a principal of another tenant cannot read the note', async () => {
    const created = createdNote.parse(
      (await createNote('staff', buyer.token, { title: 'Tenant A synthetic note' })).body,
    );
    const otherTenantBuyer = await harness.issue('staff_session', harness.tenantB, { roles: ['buyer'] });
    const response = await harness.query(
      'staff',
      'internalTest.getNote',
      { noteId: created.noteId },
      otherTenantBuyer.token,
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NotFound',
      message: 'pl.error.notFound.resource',
      params: { resource: 'note' },
    });
  });

  it('a query cannot write: its transaction is read-only', async () => {
    const created = createdNote.parse(
      (await createNote('staff', buyer.token, { title: 'Untouched synthetic note' })).body,
    );
    const response = await harness.query(
      'staff',
      'internalTest.touchNoteInQuery',
      { noteId: created.noteId },
      buyer.token,
    );
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal', message: 'pl.error.internal.unexpected', params: {} });
    expect(
      await harness.count(`select 1 from internal_test_notes where id = $1 and title = 'Untouched synthetic note'`, [
        created.noteId,
      ]),
    ).toBe(1);
  });

  it('answers query input that is not JSON with a validation failure', async () => {
    const response = await fetch(
      `${harness.api.listeners.urls.staff}/api/v1/queries/internalTest.getNote?input=%7Bnot`,
      {
        headers: { authorization: `Bearer ${buyer.token}` },
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid',
      message: 'pl.error.invalid.request',
      issues: [{ path: ['input'], code: 'invalid_json' }],
    });
  });
});
