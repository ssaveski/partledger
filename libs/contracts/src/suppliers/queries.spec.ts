import { describe, expect, it } from 'vitest';

import { supplierFixtureOutputs } from '../fixtures';
import { englishCatalogue } from '../i18n/catalogue';
import { expiryStatuses } from '../reads';
import { approvalStatuses, identityCheckStatuses, supplierListQuery, supplierListSchema } from './queries';

const list = supplierFixtureOutputs.list;

describe('the supplier list contract', () => {
  it('parses the synthetic supplier list', () => {
    expect(supplierListSchema.safeParse(list).success).toBe(true);
  });

  it('shows approval scope, expiry and identity check for every supplier', () => {
    const northwind = supplierListSchema.parse(list).suppliers.find((supplier) => supplier.code === 'NOR-0101');
    expect(northwind?.approval).toEqual({
      status: 'approved',
      scope: ['castings', 'machinedParts'],
      expiresOn: '2027-05-31',
      expiry: 'current',
    });
    expect(northwind?.identityCheck).toEqual({ status: 'notApplicable', register: null, checkedAt: null });
  });

  it('refuses a scope that is not a part category', () => {
    const [first] = list.suppliers;
    const withBadScope = {
      ...list,
      suppliers: [{ ...first, approval: { ...first?.approval, scope: ['aerospace'] } }],
    };
    expect(supplierListSchema.safeParse(withBadScope).success).toBe(false);
  });

  it('covers every approval, expiry and identity state in the synthetic suppliers', () => {
    const suppliers = supplierListSchema.parse(list).suppliers;
    expect(new Set(suppliers.map((supplier) => supplier.approval.status))).toEqual(
      new Set(approvalStatuses.slice(0, 3)),
    );
    expect(new Set(suppliers.map((supplier) => supplier.approval.expiry))).toEqual(new Set(expiryStatuses));
    expect(new Set(suppliers.map((supplier) => supplier.identityCheck.status))).toEqual(new Set(identityCheckStatuses));
  });

  it('is a described suppliers query without input', () => {
    expect(supplierListQuery.name).toBe('suppliers.list');
    expect(supplierListQuery.input.safeParse({}).success).toBe(true);
    expect(supplierListQuery.output.description).toBeDefined();
  });

  it('has an English label for every approval, expiry, identity and register state', () => {
    const keys = [
      ...approvalStatuses.map((status) => `pl.suppliers.approval.${status}`),
      ...expiryStatuses.map((status) => `pl.suppliers.expiry.${status}`),
      ...identityCheckStatuses.map((status) => `pl.suppliers.identity.${status}`),
      'pl.suppliers.register.vies',
      'pl.suppliers.register.lei',
    ];
    expect(keys.filter((key) => !Object.hasOwn(englishCatalogue, key))).toEqual([]);
  });
});
