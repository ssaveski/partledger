import { describe, expect, it } from 'vitest';

import { GleifClient } from './gleif.client';
import type { RegisterFetch } from './identity-registers';
import { ViesClient } from './vies.client';

const lei = '5299000SYNTHETIC0133';

function answering(status: number, body: unknown, seen: string[] = []): RegisterFetch {
  return (url) => {
    seen.push(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

/** Never answers, but gives up when the request's signal aborts, as fetch does. */
const hanging: RegisterFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation timed out.', 'TimeoutError'));
    });
  });

const failing: RegisterFetch = () => Promise.reject(new TypeError('fetch failed'));

const options = { baseUrl: 'https://register.test/api', timeoutMilliseconds: 50 };

describe('the VIES client', () => {
  it('asks the member state of the prefix about the number', async () => {
    const seen: string[] = [];
    const client = new ViesClient({ ...options, fetch: answering(200, { isValid: true, name: 'X' }, seen) });
    await client.check('SE556677889901');
    expect(seen).toEqual(['https://register.test/api/ms/SE/vat/556677889901']);
  });

  it('reads a valid number with its registered name, and a hidden name as none', async () => {
    const named = new ViesClient({ ...options, fetch: answering(200, { isValid: true, name: ' Synthetic AB ' }) });
    const hidden = new ViesClient({ ...options, fetch: answering(200, { isValid: true, name: '---' }) });
    expect(await named.check('SE556677889901')).toEqual({ kind: 'found', registeredName: 'Synthetic AB' });
    expect(await hidden.check('SE556677889901')).toEqual({ kind: 'found', registeredName: null });
  });

  it('reads an invalid number as not found', async () => {
    const client = new ViesClient({ ...options, fetch: answering(200, { isValid: false, userError: 'INVALID' }) });
    expect(await client.check('SE556677889901')).toEqual({ kind: 'notFound' });
  });

  it('reads a member state outage as unreachable, not as an unregistered number', async () => {
    const client = new ViesClient({
      ...options,
      fetch: answering(200, { isValid: false, userError: 'MS_UNAVAILABLE' }),
    });
    expect(await client.check('SE556677889901')).toEqual({ kind: 'unreachable' });
  });

  it('reads a timeout, a network failure, an error status or an unreadable body as unreachable', async () => {
    for (const fetch of [hanging, failing, answering(500, {}), answering(200, { unexpected: true })]) {
      expect(await new ViesClient({ ...options, fetch }).check('SE556677889901')).toEqual({ kind: 'unreachable' });
    }
  });
});

describe('the GLEIF client', () => {
  const record = { data: { attributes: { entity: { legalName: { name: 'Synthetic Holdings AB' } } } } };

  it('reads an LEI record with its legal name', async () => {
    const seen: string[] = [];
    const client = new GleifClient({ ...options, fetch: answering(200, record, seen) });
    expect(await client.check(lei)).toEqual({ kind: 'found', registeredName: 'Synthetic Holdings AB' });
    expect(seen).toEqual([`https://register.test/api/lei-records/${lei}`]);
  });

  it('reads a 404 as not found', async () => {
    expect(await new GleifClient({ ...options, fetch: answering(404, {}) }).check(lei)).toEqual({ kind: 'notFound' });
  });

  it('reads a timeout, a network failure, an error status or an unreadable body as unreachable', async () => {
    for (const fetch of [hanging, failing, answering(503, {}), answering(200, { data: {} })]) {
      expect(await new GleifClient({ ...options, fetch }).check(lei)).toEqual({ kind: 'unreachable' });
    }
  });
});
