import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineCommand, defineQuery } from '../define';
import { errorCode } from '../errors';
import {
  createApiClient,
  failureMessageKey,
  isPermissionFailure,
  type AdapterResult,
  type ApiAdapter,
  type ClientFailure,
} from './api-client';

const exampleQuery = defineQuery({
  name: 'examples.read',
  description: 'Read an example.',
  input: z.object({ exampleId: z.uuid().describe('The example.') }).describe('Which example.'),
  output: z
    .object({ exampleId: z.uuid().describe('The example.'), count: z.number().int().describe('A count.') })
    .strict()
    .describe('An example.'),
  errors: [errorCode('NotFound', 'resource')],
  access: { person: ['buyer'] },
});

const exampleId = '00000000-0000-4000-8000-000000000001';

function adapterAnswering(result: AdapterResult) {
  const query = vi.fn<ApiAdapter['query']>(() => Promise.resolve(result));
  const command = vi.fn<ApiAdapter['command']>(() => Promise.resolve(result));
  const answer = () => Promise.resolve(result);
  const adapter: ApiAdapter = { query, command, session: answer, signOut: answer };
  return { adapter, query, command };
}

const exampleCommand = defineCommand({
  name: 'examples.rename',
  description: 'Rename an example.',
  purpose: 'business',
  input: z.object({ exampleId: z.uuid().describe('The example.') }).describe('Which example.'),
  output: z
    .object({ exampleId: z.uuid().describe('The example.') })
    .strict()
    .describe('The renamed example.'),
  errors: [errorCode('NotFound', 'resource')],
  access: { person: ['buyer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

describe('the typed API client', () => {
  it('returns the output parsed against the declaration when the adapter answers in the declared shape', async () => {
    const { adapter, query } = adapterAnswering({ ok: true, body: { exampleId, count: 3 } });
    const result = await createApiClient(adapter).query(exampleQuery, { exampleId });
    expect(result).toEqual({ ok: true, value: { exampleId, count: 3 } });
    expect(query).toHaveBeenCalledWith('examples.read', { exampleId });
  });

  it('refuses input that does not parse without calling the adapter', async () => {
    const { adapter, query } = adapterAnswering({ ok: true, body: {} });
    const result = await createApiClient(adapter).query(exampleQuery, { exampleId: 'not-a-uuid' });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'invalid', issues: [{ path: ['exampleId'], code: 'invalid_format' }] },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports a response that does not match the declared output as malformed', async () => {
    const { adapter } = adapterAnswering({ ok: true, body: { exampleId, count: 'three' } });
    expect(await createApiClient(adapter).query(exampleQuery, { exampleId })).toEqual({
      ok: false,
      failure: { kind: 'malformed' },
    });
  });

  it('reports an answer with fields the declaration does not have as malformed', async () => {
    const { adapter } = adapterAnswering({ ok: true, body: { exampleId, count: 3, unitPrice: '12.00' } });
    const result = await createApiClient(adapter).query(exampleQuery, { exampleId });
    expect(result.ok).toBe(false);
  });

  it('passes a refusal from the adapter through unchanged', async () => {
    const failure: ClientFailure = {
      kind: 'refused',
      error: 'NotFound',
      message: 'pl.error.notFound.resource',
      params: {},
    };
    const { adapter } = adapterAnswering({ ok: false, failure });
    expect(await createApiClient(adapter).query(exampleQuery, { exampleId })).toEqual({ ok: false, failure });
  });
});

describe('the typed API client for commands and the session', () => {
  it('sends a command with its idempotency key and parses the output against the declaration', async () => {
    const { adapter, command } = adapterAnswering({ ok: true, body: { exampleId } });
    const result = await createApiClient(adapter).command(exampleCommand, { exampleId }, 'key-0000000000000001');
    expect(result).toEqual({ ok: true, value: { exampleId } });
    expect(command).toHaveBeenCalledWith('examples.rename', { exampleId }, 'key-0000000000000001');
  });

  it('refuses command input that does not parse without calling the adapter', async () => {
    const { adapter, command } = adapterAnswering({ ok: true, body: { exampleId } });
    const result = await createApiClient(adapter).command(exampleCommand, { exampleId: 'x' }, 'key-0000000000000001');
    expect(result.ok).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it('parses the session against the staff session shape', async () => {
    const session = {
      userId: exampleId,
      tenantId: exampleId,
      expiresAt: '2026-09-27T20:00:00.000Z',
      idleExpiresAt: '2026-09-27T10:30:00.000Z',
    };
    expect(await createApiClient(adapterAnswering({ ok: true, body: session }).adapter).session()).toEqual({
      ok: true,
      value: session,
    });
    expect(await createApiClient(adapterAnswering({ ok: true, body: { userId: 'x' } }).adapter).session()).toEqual({
      ok: false,
      failure: { kind: 'malformed' },
    });
  });
});

describe('client failures', () => {
  it('name the message key a screen shows for each kind of failure', () => {
    expect(
      failureMessageKey({
        kind: 'refused',
        error: 'Conflict',
        message: 'pl.error.conflict.versionMismatch',
        params: {},
      }),
    ).toBe('pl.error.conflict.versionMismatch');
    expect(failureMessageKey({ kind: 'invalid', issues: [] })).toBe('pl.error.invalid.request');
    expect(failureMessageKey({ kind: 'unauthenticated' })).toBe('pl.error.unauthenticated.credential');
    expect(failureMessageKey({ kind: 'unavailable' })).toBe('pl.error.unavailable.dependencyUnavailable');
    expect(failureMessageKey({ kind: 'malformed' })).toBe('pl.error.internal.unexpected');
  });

  it('treat only a Forbidden refusal as missing permission', () => {
    expect(
      isPermissionFailure({
        kind: 'refused',
        error: 'Forbidden',
        message: 'pl.error.forbidden.notPermitted',
        params: {},
      }),
    ).toBe(true);
    expect(
      isPermissionFailure({ kind: 'refused', error: 'NotFound', message: 'pl.error.notFound.resource', params: {} }),
    ).toBe(false);
    expect(isPermissionFailure({ kind: 'unauthenticated' })).toBe(false);
  });
});
