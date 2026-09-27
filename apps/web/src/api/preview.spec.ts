import type { AdapterResult, ApiAdapter } from '@partledger/contracts/client';
import { describe, expect, it, vi } from 'vitest';

import { createPreviewStore, previewStateFrom, withPreviewStore } from './preview';

describe('the preview state in the address', () => {
  it('reads each designed state and ignores anything else', () => {
    expect(previewStateFrom('?preview=empty')).toBe('empty');
    expect(previewStateFrom('?q=pump&preview=forbidden')).toBe('forbidden');
    expect(previewStateFrom('?preview=slow')).toBe('slow');
    expect(previewStateFrom('?preview=unavailable')).toBe('unavailable');
    expect(previewStateFrom('?preview=broken')).toBeNull();
    expect(previewStateFrom('')).toBeNull();
  });
});

describe('the preview store', () => {
  function fixtures() {
    const query = vi.fn<ApiAdapter['query']>(() => Promise.resolve({ ok: true, body: { from: 'fixtures' } }));
    const unused = () => Promise.resolve<AdapterResult>({ ok: false, failure: { kind: 'unavailable' } });
    const adapter: ApiAdapter = { query, command: unused, session: unused, signOut: unused };
    return { adapter, query };
  }

  it('asks the fixtures until the preview writes the same query and input', async () => {
    const store = createPreviewStore();
    const { adapter, query } = fixtures();
    const previewed = withPreviewStore(adapter, store);
    expect(await previewed.query('parts.list', {})).toEqual({ ok: true, body: { from: 'fixtures' } });

    store.write('parts.list', {}, { from: 'preview' });
    expect(await previewed.query('parts.list', {})).toEqual({ ok: true, body: { from: 'preview' } });
    expect(await previewed.query('rfqs.detail', { rfqId: 'x' })).toEqual({ ok: true, body: { from: 'fixtures' } });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps writes for one input apart from another', () => {
    const store = createPreviewStore();
    store.write('rfqs.detail', { rfqId: 'a' }, { reference: 'RFQ-1' });
    expect(store.read('rfqs.detail', { rfqId: 'a' })).toEqual({ found: true, body: { reference: 'RFQ-1' } });
    expect(store.read('rfqs.detail', { rfqId: 'b' })).toEqual({ found: false });
  });

  it('hands out a copy, so a screen cannot change what the next read returns', () => {
    const store = createPreviewStore();
    store.write('parts.list', {}, { parts: [1] });
    const first = store.read('parts.list', {});
    const body = first.found ? first.body : null;
    if (typeof body === 'object' && body !== null && 'parts' in body && Array.isArray(body.parts)) {
      body.parts.push(2);
    }
    expect(store.read('parts.list', {})).toEqual({ found: true, body: { parts: [1] } });
  });
});
