import { describe, expect, it } from 'vitest';

import { supplierFailureMessageKey } from './query-view';

describe('portal failure messages', () => {
  it('point a supplier to the buyer, not to support, when a response cannot be read', () => {
    expect(supplierFailureMessageKey({ kind: 'malformed' })).toBe('pl.portal.error.unexpected');
  });

  it('keep the shared message for failures that already say what to do', () => {
    expect(supplierFailureMessageKey({ kind: 'unavailable' })).toBe('pl.error.unavailable.dependencyUnavailable');
  });
});
