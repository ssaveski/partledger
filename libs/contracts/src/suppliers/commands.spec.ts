import { describe, expect, it } from 'vitest';

import { createSupplierCommand, isValidLei, setApprovalCommand, updateSupplierCommand } from './commands';

const supplierId = '00000000-0000-4000-8000-000000000001';

describe('supplier identifiers', () => {
  it('accepts an LEI whose check digits hold, and refuses one whose do not', () => {
    expect(isValidLei('5299000SYNTHETIC0133')).toBe(true);
    expect(isValidLei('5299000SYNTHETIC0134')).toBe(false);
    expect(isValidLei('5299000synthetic0133')).toBe(false);
  });

  it('takes a VAT id with its prefix and no spaces', () => {
    const base = { code: 'SUP-01', name: 'Synthetic', country: 'SE', lei: null };
    expect(createSupplierCommand.input.safeParse({ ...base, vatId: 'SE556677889901' }).success).toBe(true);
    expect(createSupplierCommand.input.safeParse({ ...base, vatId: 'SE 5566 7788 9901' }).success).toBe(false);
  });
});

describe('a supplier change', () => {
  it('names at least one field', () => {
    const change = { supplierId, expectedVersion: 1 };
    expect(updateSupplierCommand.input.safeParse({ ...change, changes: {} }).success).toBe(false);
    expect(updateSupplierCommand.input.safeParse({ ...change, changes: { lei: null } }).success).toBe(true);
  });
});

describe('an approved-supplier entry', () => {
  const entry = { supplierId, expectedVersion: 0, status: 'approved', scope: ['castings'], expiresOn: '2027-06-30' };

  it('covers at least one category while approved or conditional', () => {
    expect(setApprovalCommand.input.safeParse(entry).success).toBe(true);
    expect(setApprovalCommand.input.safeParse({ ...entry, scope: [] }).success).toBe(false);
    expect(setApprovalCommand.input.safeParse({ ...entry, status: 'suspended', scope: [] }).success).toBe(true);
  });

  it('keeps no scope or expiry once off the list', () => {
    const off = { ...entry, status: 'notApproved' };
    expect(setApprovalCommand.input.safeParse(off).success).toBe(false);
    expect(setApprovalCommand.input.safeParse({ ...off, scope: [], expiresOn: null }).success).toBe(true);
  });

  it('names each category once', () => {
    expect(setApprovalCommand.input.safeParse({ ...entry, scope: ['castings', 'castings'] }).success).toBe(false);
  });

  it('is changed only by a quality engineer (R9)', () => {
    expect(setApprovalCommand.access).toEqual({ person: ['quality_engineer'] });
  });
});
