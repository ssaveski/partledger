import { describe, expect, it } from 'vitest';

import { contentDisposition } from './download.controller';

describe('the download file name', () => {
  it('the extended filename percent-encodes apostrophes and parentheses', () => {
    expect(contentDisposition("Supplier's certificate (2026)*.pdf")).toBe(
      `attachment; filename="Supplier_s certificate _2026__.pdf"; filename*=UTF-8''Supplier%27s%20certificate%20%282026%29%2A.pdf`,
    );
  });
});
