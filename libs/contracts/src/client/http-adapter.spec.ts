import { describe, expect, it, vi } from 'vitest';

import { createHttpAdapter, type FetchLike } from './http-adapter';

function respondWith(status: number, body: () => Promise<unknown>) {
  const fetch = vi.fn<FetchLike>(() => Promise.resolve({ ok: status >= 200 && status < 300, status, json: body }));
  return { adapter: createHttpAdapter({ fetch }), fetch };
}

const input = { rfqId: '00000000-0000-4000-8000-000000001042' };

describe('the HTTP adapter', () => {
  it('requests the generated query route with the input as JSON, same-origin', async () => {
    const { adapter, fetch } = respondWith(200, () => Promise.resolve({ fine: true }));
    const result = await adapter.query('rfqs.detail', input);
    expect(result).toEqual({ ok: true, body: { fine: true } });
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/queries/rfqs.detail?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' },
    );
  });

  it('prefixes an origin when one is given', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    await createHttpAdapter({ fetch, origin: 'https://staff.example.test' }).query('rfqs.detail', input);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/^https:\/\/staff\.example\.test\/api\/v1\/queries\/rfqs\.detail\?input=/);
  });

  it('reports a 401 as unauthenticated whatever its body says', async () => {
    const { adapter } = respondWith(401, () =>
      Promise.resolve({ error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} }),
    );
    expect(await adapter.query('rfqs.detail', input)).toEqual({ ok: false, failure: { kind: 'unauthenticated' } });
  });

  it('turns a declared refusal into a refused failure carrying its message key and params', async () => {
    const { adapter } = respondWith(403, () =>
      Promise.resolve({ error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: { rfq: 'RFQ-1042' } }),
    );
    expect(await adapter.query('rfqs.detail', input)).toEqual({
      ok: false,
      failure: {
        kind: 'refused',
        error: 'Forbidden',
        message: 'pl.error.forbidden.notPermitted',
        params: { rfq: 'RFQ-1042' },
      },
    });
  });

  it('turns a validation body into an invalid failure with its issues', async () => {
    const { adapter } = respondWith(400, () =>
      Promise.resolve({
        error: 'Invalid',
        message: 'pl.error.invalid.request',
        issues: [{ path: ['rfqId'], code: 'invalid_format' }],
      }),
    );
    expect(await adapter.query('rfqs.detail', input)).toEqual({
      ok: false,
      failure: { kind: 'invalid', issues: [{ path: ['rfqId'], code: 'invalid_format' }] },
    });
  });

  it('reports a failed request as unavailable', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await createHttpAdapter({ fetch }).query('rfqs.detail', input)).toEqual({
      ok: false,
      failure: { kind: 'unavailable' },
    });
  });

  it('reports an error response without a readable body as unavailable', async () => {
    const { adapter } = respondWith(502, () => Promise.reject(new SyntaxError('Unexpected token <')));
    expect(await adapter.query('rfqs.detail', input)).toEqual({ ok: false, failure: { kind: 'unavailable' } });
  });

  it('reports an error body in no known shape as unavailable rather than echoing it', async () => {
    const { adapter } = respondWith(500, () => Promise.resolve({ stack: 'at secret.ts:1' }));
    expect(await adapter.query('rfqs.detail', input)).toEqual({ ok: false, failure: { kind: 'unavailable' } });
  });

  it('reports a success whose body is not JSON as malformed', async () => {
    const { adapter } = respondWith(200, () => Promise.reject(new SyntaxError('Unexpected token <')));
    expect(await adapter.query('rfqs.detail', input)).toEqual({ ok: false, failure: { kind: 'malformed' } });
  });
});
