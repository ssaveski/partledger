import { describe, expect, it } from 'vitest';

import { createPartCommand, erpOwnedPartFields, updatePartCommand } from './commands';

const partId = '00000000-0000-4000-8000-000000000001';

describe('the part commands', () => {
  it('take a part number of letters, digits and separators, and refuse spaces', () => {
    const part = { revision: 'A', description: 'Synthetic', category: 'castings', unit: 'each' };
    expect(createPartCommand.input.safeParse({ ...part, partNumber: 'PN-10432/B' }).success).toBe(true);
    expect(createPartCommand.input.safeParse({ ...part, partNumber: 'PN 10432' }).success).toBe(false);
  });

  it('change at least one field of a part, at the version the caller read', () => {
    expect(updatePartCommand.input.safeParse({ partId, expectedVersion: 1, changes: {} }).success).toBe(false);
    expect(
      updatePartCommand.input.safeParse({ partId, expectedVersion: 1, changes: { category: 'seals' } }).success,
    ).toBe(true);
    expect(updatePartCommand.input.safeParse({ partId, changes: { category: 'seals' } }).success).toBe(false);
  });

  it('leave the category to the platform on a part the ERP owns', () => {
    expect(erpOwnedPartFields).not.toContain('category');
  });
});
