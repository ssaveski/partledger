import { sql } from 'drizzle-orm';
import { check, date, foreignKey, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { tenantIdentifier, timestamptz } from './columns.ts';
import { suppliers } from './suppliers.ts';
import { tenants } from './tenants.ts';

export const approvalStatuses = ['approved', 'conditional', 'suspended', 'notApproved'] as const;

/**
 * A supplier's entry on the tenant's approved-supplier list (R9): its status, the part
 * categories it covers and the last day it is valid. One entry per supplier; taking a supplier
 * off the list sets `notApproved` with no scope or expiry, so the entry and its version carry on.
 * Its history is the audit chain. Whether the platform may change it depends on the tenant's
 * `supplier_list_source`, which the command checks.
 */
export const approvedSupplierEntries = pgTable(
  'approved_supplier_entries',
  {
    tenantId: tenantIdentifier(),
    supplierId: uuid('supplier_id').notNull(),
    status: text('status', { enum: approvalStatuses }).notNull(),
    scope: text('scope').array().notNull(),
    expiresOn: date('expires_on', { mode: 'string' }),
    version: integer('version').notNull().default(1),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'approved_supplier_entries_pkey', columns: [table.tenantId, table.supplierId] }),
    foreignKey({
      name: 'approved_supplier_entries_tenant_id_fkey',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
    foreignKey({
      name: 'approved_supplier_entries_supplier_fkey',
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }),
    check(
      'approved_supplier_entries_status_check',
      sql`${table.status} in ('approved', 'conditional', 'suspended', 'notApproved')`,
    ),
    check(
      'approved_supplier_entries_scope_check',
      sql`${table.scope} <@ array['castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics']::text[]`,
    ),
    check(
      'approved_supplier_entries_not_approved_check',
      sql`${table.status} <> 'notApproved' or (cardinality(${table.scope}) = 0 and ${table.expiresOn} is null)`,
    ),
    check(
      'approved_supplier_entries_active_scope_check',
      sql`${table.status} not in ('approved', 'conditional') or cardinality(${table.scope}) > 0`,
    ),
    check('approved_supplier_entries_version_check', sql`${table.version} >= 1`),
  ],
);

export const approvedSupplierEntriesAccess = defineTableAccess({
  table: 'approved_supplier_entries',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      status: ['UPDATE'],
      scope: ['UPDATE'],
      expires_on: ['UPDATE'],
      version: ['UPDATE'],
      updated_at: ['UPDATE'],
    },
  },
});
