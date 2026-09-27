import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineQuery } from '../define';
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
  return { adapter: { query }, query };
}

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
