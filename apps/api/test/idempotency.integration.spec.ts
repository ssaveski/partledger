import { idempotentReplayHeader } from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idempotencyKeyLifetimeMilliseconds } from '../src/idempotency/idempotency.service';
import { newIdempotencyKey, startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';

const createdNote = z.object({ noteId: z.uuid(), version: z.number().int() });
const storedResults = z.array(z.object({ result: z.unknown() }));

describe('idempotency keys', () => {
  let harness: ApiHarness;
  let buyer: IssuedToken;

  beforeAll(async () => {
    harness = await startApiHarness();
    buyer = await harness.issue('staff_session', harness.tenantA, {
      roles: ['buyer'],
      expiresInMilliseconds: 3 * idempotencyKeyLifetimeMilliseconds,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  function createNote(title: string, idempotencyKey: string | undefined, token = buyer.token, delayMilliseconds = 0) {
    return harness.command(
      'staff',
      'internalTest.createNote',
      { title, delayMilliseconds },
      idempotencyKey === undefined ? { token } : { token, idempotencyKey },
    );
  }

  it('two concurrent requests with the same key act once and return the same result', async () => {
    const idempotencyKey = newIdempotencyKey();
    const [first, second] = await Promise.all([
      createNote('Concurrent synthetic gasket', idempotencyKey, buyer.token, 500),
      createNote('Concurrent synthetic gasket', idempotencyKey, buyer.token, 500),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    expect([first.headers.get(idempotentReplayHeader), second.headers.get(idempotentReplayHeader)].sort()).toEqual(
      [null, 'true'].sort(),
    );
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Concurrent synthetic gasket'`)).toBe(
      1,
    );
  });

  it('a replay returns the first result without acting again', async () => {
    const idempotencyKey = newIdempotencyKey();
    const first = await createNote('Replayed synthetic washer', idempotencyKey);
    const replay = await createNote('Replayed synthetic washer', idempotencyKey);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get(idempotentReplayHeader)).toBe('true');
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Replayed synthetic washer'`)).toBe(1);
  });

  it('stores only the command output, which holds identifiers', async () => {
    const idempotencyKey = newIdempotencyKey();
    const response = await createNote('Stored synthetic shim', idempotencyKey);
    const result = await harness.superuser.query('select result from idempotency_keys where key = $1', [
      idempotencyKey,
    ]);
    expect(storedResults.parse(result.rows)).toEqual([{ result: createdNote.parse(response.body) }]);
  });

  it('a key reused by a different credential never returns the first credential result', async () => {
    const otherBuyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    const idempotencyKey = newIdempotencyKey();
    const first = createdNote.parse((await createNote('Shared-key synthetic bolt', idempotencyKey)).body);
    const other = await createNote('Shared-key synthetic bolt', idempotencyKey, otherBuyer.token);
    expect(other.status).toBe(200);
    expect(other.headers.get(idempotentReplayHeader)).toBeNull();
    expect(createdNote.parse(other.body).noteId).not.toBe(first.noteId);
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Shared-key synthetic bolt'`)).toBe(2);
  });

  it('a key reused with a different body is refused', async () => {
    const idempotencyKey = newIdempotencyKey();
    await createNote('Original synthetic nut', idempotencyKey);
    const reused = await createNote('Different synthetic nut', idempotencyKey);
    expect(reused.status).toBe(422);
    expect(reused.body).toEqual({
      error: 'Unprocessable',
      message: 'pl.error.unprocessable.idempotencyKeyReused',
      params: {},
    });
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Different synthetic nut'`)).toBe(0);
  });

  it('a command that requires a key refuses a request without one', async () => {
    const response = await createNote('Keyless synthetic rivet', undefined);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid',
      message: 'pl.error.invalid.idempotencyKeyRequired',
      params: {},
    });
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Keyless synthetic rivet'`)).toBe(0);
  });

  it('a malformed key is a validation failure on the header', async () => {
    const response = await createNote('Badly keyed synthetic pin', 'short');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid',
      message: 'pl.error.invalid.request',
      issues: [{ path: ['headers', 'idempotency-key'], code: 'invalid_format' }],
    });
  });

  it('a failed command leaves no key, so a retry with the same key runs', async () => {
    const idempotencyKey = newIdempotencyKey();
    const refused = await harness.command(
      'staff',
      'internalTest.renameNote',
      { noteId: '00000000-0000-4000-8000-000000000000', title: 'Missing synthetic part', expectedVersion: 1 },
      { token: buyer.token, idempotencyKey },
    );
    expect(refused.status).toBe(404);
    const again = await harness.command(
      'staff',
      'internalTest.renameNote',
      { noteId: '00000000-0000-4000-8000-000000000000', title: 'Missing synthetic part', expectedVersion: 1 },
      { token: buyer.token, idempotencyKey },
    );
    expect(again.status).toBe(404);
    expect(again.headers.get(idempotentReplayHeader)).toBeNull();
  });

  it('an expired key acts afresh', async () => {
    const idempotencyKey = newIdempotencyKey();
    const first = createdNote.parse((await createNote('Expiring synthetic clip', idempotencyKey)).body);
    harness.clock.advance(idempotencyKeyLifetimeMilliseconds + 60_000);
    const later = await createNote('Expiring synthetic clip', idempotencyKey);
    expect(later.status).toBe(200);
    expect(later.headers.get(idempotentReplayHeader)).toBeNull();
    expect(createdNote.parse(later.body).noteId).not.toBe(first.noteId);
    expect(await harness.count('select 1 from idempotency_keys where key = $1', [idempotencyKey])).toBe(1);
  });
});
