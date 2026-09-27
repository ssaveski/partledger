import { partListSchema, rfqListSchema, supplierListSchema } from '@partledger/contracts';
import { partFixtureOutputs, rfqFixtureOutputs, supplierFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { filterParts, hasFilters, partListSearchSchema } from './parts/part-filters';
import { filterRfqs, rfqListSearchSchema } from './rfqs/rfq-list-filters';
import { filterSuppliers, supplierListSearchSchema } from './suppliers/supplier-filters';

const parts = partListSchema.parse(partFixtureOutputs.list).parts;
const suppliers = supplierListSchema.parse(supplierFixtureOutputs.list).suppliers;
const rfqs = rfqListSchema.parse(rfqFixtureOutputs.list).rfqs;

describe('the parts filter', () => {
  it('narrows by category and by part number or description', () => {
    expect(filterParts(parts, { category: 'castings' }).map((part) => part.partNumber)).toEqual([
      'PN-10432',
      'PN-10440',
    ]);
    expect(filterParts(parts, { q: 'shaft' }).map((part) => part.partNumber)).toEqual(['PN-20877']);
    expect(filterParts(parts, { q: 'pn-3100', category: 'seals' }).map((part) => part.partNumber)).toEqual([
      'PN-31006',
      'PN-31007',
    ]);
  });

  it('drops a category the contract does not know rather than failing the page', () => {
    expect(partListSearchSchema.parse({ category: 'aerospace', q: 'pump' })).toEqual({ q: 'pump' });
  });

  it('counts blank text as no filter', () => {
    expect(hasFilters({ q: '  ' })).toBe(false);
    expect(hasFilters({ category: 'seals' })).toBe(true);
  });
});

describe('the supplier filter', () => {
  it('narrows by approval status and by name or code', () => {
    expect(filterSuppliers(suppliers, { approval: 'suspended' }).map((supplier) => supplier.name)).toEqual([
      'Halden Electronics',
    ]);
    expect(filterSuppliers(suppliers, { q: 'KES' }).map((supplier) => supplier.name)).toEqual(['Kestrel Machining']);
  });

  it('drops an approval status the contract does not know', () => {
    expect(supplierListSearchSchema.parse({ approval: 'maybe' })).toEqual({});
  });
});

describe('the RFQ filter', () => {
  it('narrows by status and by reference or title', () => {
    expect(filterRfqs(rfqs, { status: 'pendingApproval' }).map((rfq) => rfq.reference)).toEqual([
      'RFQ-1031-R2',
      'RFQ-1027',
    ]);
    expect(filterRfqs(rfqs, { q: '1042' }).map((rfq) => rfq.reference)).toEqual(['RFQ-1042']);
  });

  it('drops a status the contract does not know', () => {
    expect(rfqListSearchSchema.parse({ status: 'archived' })).toEqual({});
  });
});
