import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler } from '../client/fixture-adapter';
import type { PartCategory } from '../parts/queries';
import type { SupplierEvidenceStatus } from '../rfqs/queries';
import { supplierListQuery, type ApprovalStatus } from '../suppliers/queries';
import { fixtureId } from './ids';

/**
 * Synthetic suppliers: invented organisations, codes and register results only. The first four
 * are the suppliers of the key-screen RFQs, with the same ids and evidence statuses.
 */

type SupplierListOutput = z.input<typeof supplierListQuery.output>;

/** Every synthetic supplier has been assessed, so the RFQ fixtures can show its evidence status. */
export type FixtureSupplier = SupplierListOutput['suppliers'][number] & { readonly evidence: SupplierEvidenceStatus };

/** The date every synthetic expiry status is evaluated on. */
export const fixtureAsOf = '2026-09-27';

export const fixtureSupplierIds = {
  northwind: fixtureId(2001),
  birchfield: fixtureId(2002),
  kestrel: fixtureId(2003),
  arbor: fixtureId(2004),
  lindqvist: fixtureId(2005),
  halden: fixtureId(2006),
} as const;

export const fixtureSuppliers: readonly FixtureSupplier[] = [
  {
    supplierId: fixtureSupplierIds.arbor,
    code: 'ARB-0104',
    name: 'Arbor Fasteners',
    country: 'CA',
    approval: { status: 'approved', scope: ['fasteners', 'seals'], expiresOn: '2027-06-30', expiry: 'current' },
    identityCheck: { status: 'notChecked', register: 'lei', checkedAt: '2026-09-26T03:00:00Z' },
    evidence: 'deviation',
  },
  {
    supplierId: fixtureSupplierIds.birchfield,
    code: 'BIR-0102',
    name: 'Birchfield Precision',
    country: 'CA',
    approval: {
      status: 'approved',
      scope: ['machinedParts', 'fasteners', 'seals'],
      expiresOn: '2026-11-15',
      expiry: 'expiringSoon',
    },
    identityCheck: { status: 'verified', register: 'lei', checkedAt: '2026-09-20T03:00:00Z' },
    evidence: 'expiring',
  },
  {
    supplierId: fixtureSupplierIds.halden,
    code: 'HAL-0206',
    name: 'Halden Electronics',
    country: 'DE',
    approval: { status: 'suspended', scope: ['electronics'], expiresOn: '2026-08-31', expiry: 'expired' },
    identityCheck: { status: 'notFound', register: 'vies', checkedAt: '2026-09-21T03:00:00Z' },
    evidence: 'invalid',
  },
  {
    supplierId: fixtureSupplierIds.kestrel,
    code: 'KES-0103',
    name: 'Kestrel Machining',
    country: 'US',
    approval: { status: 'conditional', scope: ['machinedParts'], expiresOn: '2027-03-31', expiry: 'current' },
    identityCheck: { status: 'mismatch', register: 'lei', checkedAt: '2026-09-19T03:00:00Z' },
    evidence: 'invalid',
  },
  {
    supplierId: fixtureSupplierIds.lindqvist,
    code: 'LIN-0205',
    name: 'Lindqvist Sheet Metal',
    country: 'SE',
    approval: { status: 'approved', scope: ['sheetMetal', 'fasteners'], expiresOn: null, expiry: 'noExpiry' },
    identityCheck: { status: 'verified', register: 'vies', checkedAt: '2026-09-22T03:00:00Z' },
    evidence: 'valid',
  },
  {
    supplierId: fixtureSupplierIds.northwind,
    code: 'NOR-0101',
    name: 'Northwind Castings',
    country: 'CA',
    approval: {
      status: 'approved',
      scope: ['castings', 'machinedParts'],
      expiresOn: '2027-05-31',
      expiry: 'current',
    },
    identityCheck: { status: 'notApplicable', register: null, checkedAt: null },
    evidence: 'valid',
  },
];

const activeApprovals: readonly ApprovalStatus[] = ['approved', 'conditional'];

/** Whether a supplier's active approval covers a category, as the server decides for assignment. */
export function fixtureCovers(supplier: FixtureSupplier, category: PartCategory): boolean {
  return (
    activeApprovals.includes(supplier.approval.status) &&
    supplier.approval.expiry !== 'expired' &&
    supplier.approval.scope.includes(category)
  );
}

const supplierList: SupplierListOutput = {
  asOf: fixtureAsOf,
  approvedListSource: 'erp',
  suppliers: [...fixtureSuppliers],
};

export const supplierFixtureHandlers: readonly FixtureHandler[] = [
  fixtureQuery(supplierListQuery, (_input, view) => ({
    kind: 'output',
    output: view === 'empty' ? { ...supplierList, suppliers: [] } : supplierList,
  })),
];

export const supplierFixtureOutputs = { list: supplierList };
