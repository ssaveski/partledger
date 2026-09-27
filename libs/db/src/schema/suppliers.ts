import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { recordSources } from './parts.ts';
import { tenants } from './tenants.ts';

export const supplierStatuses = ['active', 'inactive'] as const;

export const contactRoles = ['sales', 'quality', 'logistics', 'finance', 'other'] as const;

export const identityRegisters = ['vies', 'lei'] as const;

export const identityCheckResults = ['verified', 'mismatch', 'notFound', 'notChecked'] as const;

/**
 * A supplier of the tenant (U10, R10). Its tenant, id, source and creation time never change: the
 * app role holds no UPDATE on them. A supplier is never deleted, only made inactive, so the RFQs,
 * quotes and seals that name it keep resolving.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    vatId: text('vat_id'),
    lei: text('lei'),
    status: text('status', { enum: supplierStatuses }).notNull(),
    source: text('source', { enum: recordSources }).notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    foreignKey({ name: 'suppliers_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    // The target of the contacts', approvals' and identity checks' composite foreign keys (KTD11).
    unique('suppliers_tenant_id_id_key').on(table.tenantId, table.id),
    unique('suppliers_tenant_id_code_key').on(table.tenantId, table.code),
    check('suppliers_code_check', sql`${table.code} ~ '^[A-Z0-9-]{2,20}$'`),
    check('suppliers_name_check', sql`length(${table.name}) between 1 and 200`),
    check('suppliers_country_check', sql`${table.country} ~ '^[A-Z]{2}$'`),
    check('suppliers_vat_id_check', sql`${table.vatId} is null or ${table.vatId} ~ '^[A-Z]{2}[A-Z0-9+*]{2,12}$'`),
    check('suppliers_lei_check', sql`${table.lei} is null or ${table.lei} ~ '^[A-Z0-9]{18}[0-9]{2}$'`),
    check('suppliers_status_check', sql`${table.status} in ('active', 'inactive')`),
    check('suppliers_source_check', sql`${table.source} in ('erp', 'platform')`),
    check('suppliers_version_check', sql`${table.version} >= 1`),
    check('suppliers_updated_check', sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const suppliersAccess = defineTableAccess({
  table: 'suppliers',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      code: ['UPDATE'],
      name: ['UPDATE'],
      country: ['UPDATE'],
      vat_id: ['UPDATE'],
      lei: ['UPDATE'],
      status: ['UPDATE'],
      version: ['UPDATE'],
      updated_at: ['UPDATE'],
    },
  },
});

/**
 * A person at a supplier whom supplier links are sent to (U10, KTD21). A contact is never
 * changed: removing one records the time, once (guard trigger), and a changed address is a
 * removal and a new contact, so links sent to the old address can be revoked (U17). A current
 * contact's address is unique within its supplier.
 */
export const supplierContacts = pgTable(
  'supplier_contacts',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    supplierId: uuid('supplier_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: contactRoles }).notNull(),
    addedAt: timestamptz('added_at').notNull(),
    removedAt: timestamptz('removed_at'),
  },
  (table) => [
    foreignKey({ name: 'supplier_contacts_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'supplier_contacts_supplier_fkey',
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }),
    unique('supplier_contacts_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('supplier_contacts_current_email_key')
      .on(table.tenantId, table.supplierId, table.email)
      .where(sql`${table.removedAt} is null`),
    check('supplier_contacts_name_check', sql`length(${table.name}) between 1 and 200`),
    check(
      'supplier_contacts_email_check',
      sql`${table.email} ~ '^[^@\\s]{1,64}@[^@\\s]{1,255}$' and ${table.email} = lower(${table.email})`,
    ),
    check('supplier_contacts_role_check', sql`${table.role} in ('sales', 'quality', 'logistics', 'finance', 'other')`),
    check('supplier_contacts_removed_check', sql`${table.removedAt} is null or ${table.removedAt} >= ${table.addedAt}`),
  ],
);

export const supplierContactsAccess = defineTableAccess({
  table: 'supplier_contacts',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: { pl_app: { removed_at: ['UPDATE'] } },
});

/**
 * The result of one check of a supplier against the EU VAT register (VIES) or the LEI register
 * (R10), with the identifier checked and the time. Results are only ever added; the latest for
 * the supplier's current identifier is the one shown. `notChecked` records that the register
 * could not be reached: informational only, it never blocks the supplier.
 */
export const supplierIdentityChecks = pgTable(
  'supplier_identity_checks',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    supplierId: uuid('supplier_id').notNull(),
    register: text('register', { enum: identityRegisters }).notNull(),
    identifier: text('identifier').notNull(),
    result: text('result', { enum: identityCheckResults }).notNull(),
    checkedAt: timestamptz('checked_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'supplier_identity_checks_tenant_id_fkey',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
    foreignKey({
      name: 'supplier_identity_checks_supplier_fkey',
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }),
    index('supplier_identity_checks_latest_idx').on(
      table.tenantId,
      table.supplierId,
      table.register,
      table.checkedAt.desc(),
    ),
    check('supplier_identity_checks_register_check', sql`${table.register} in ('vies', 'lei')`),
    check('supplier_identity_checks_identifier_check', sql`${table.identifier} ~ '^[A-Z0-9+*]{4,20}$'`),
    check(
      'supplier_identity_checks_result_check',
      sql`${table.result} in ('verified', 'mismatch', 'notFound', 'notChecked')`,
    ),
  ],
);

export const supplierIdentityChecksAccess = defineTableAccess({
  table: 'supplier_identity_checks',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
});
