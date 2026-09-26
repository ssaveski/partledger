import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { newIdempotencyKey, startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';

const createdNote = z.object({ noteId: z.uuid(), version: z.number().int() });

describe('command atomicity and expected versions', () => {
  let harness: ApiHarness;
  let buyer: IssuedToken;

  beforeAll(async () => {
    harness = await startApiHarness();
    buyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('a command that writes and then returns a failure leaves nothing written', async () => {
    const idempotencyKey = newIdempotencyKey();
    const response = await harness.command(
      'staff',
      'internalTest.createNoteThenRefuse',
      { title: 'Refused synthetic bracket' },
      { token: buyer.token, idempotencyKey },
    );
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Conflict',
      message: 'pl.error.conflict.transitionNotAllowed',
      params: {},
    });
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Refused synthetic bracket'`)).toBe(0);
    expect(await harness.count('select 1 from idempotency_keys where key = $1', [idempotencyKey])).toBe(0);
  });

  it('a command that succeeds commits its writes and its idempotency key together', async () => {
    const idempotencyKey = newIdempotencyKey();
    const response = await harness.command(
      'staff',
      'internalTest.createNote',
      { title: 'Committed synthetic bracket' },
      { token: buyer.token, idempotencyKey },
    );
    expect(response.status).toBe(200);
    const { noteId } = createdNote.parse(response.body);
    expect(await harness.count('select 1 from internal_test_notes where id = $1', [noteId])).toBe(1);
    expect(await harness.count('select 1 from idempotency_keys where key = $1', [idempotencyKey])).toBe(1);
  });

  it('a stale expectedVersion returns 409 with a message key and changes nothing', async () => {
    const created = createdNote.parse(
      (
        await harness.command(
          'staff',
          'internalTest.createNote',
          { title: 'Versioned synthetic flange' },
          { token: buyer.token, idempotencyKey: newIdempotencyKey() },
        )
      ).body,
    );
    const renamed = await harness.command(
      'staff',
      'internalTest.renameNote',
      { noteId: created.noteId, title: 'Versioned synthetic flange, revised', expectedVersion: 1 },
      { token: buyer.token },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ noteId: created.noteId, version: 2 });

    const stale = await harness.command(
      'staff',
      'internalTest.renameNote',
      { noteId: created.noteId, title: 'Overwritten by a stale client', expectedVersion: 1 },
      { token: buyer.token },
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({
      error: 'Conflict',
      message: 'pl.error.conflict.versionMismatch',
      params: { expectedVersion: 1, actualVersion: 2 },
    });
    expect(
      await harness.count(
        `select 1 from internal_test_notes where id = $1 and title = 'Versioned synthetic flange, revised'`,
        [created.noteId],
      ),
    ).toBe(1);
  });

  it('a command on a missing aggregate returns 404 with a message key', async () => {
    const response = await harness.command(
      'staff',
      'internalTest.renameNote',
      { noteId: '00000000-0000-4000-8000-000000000000', title: 'Nothing to rename', expectedVersion: 1 },
      { token: buyer.token },
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NotFound',
      message: 'pl.error.notFound.resource',
      params: { resource: 'note' },
    });
  });
});
