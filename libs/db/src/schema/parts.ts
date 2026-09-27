import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/** The contracts' part categories, which approved-supplier scopes refer to. */
export const partCategories = ['castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics'] as const;

export const partUnits = ['each', 'kilogram', 'metre'] as const;

/** Who owns a master-data record: the ERP export, or the platform. */
export const recordSources = ['erp', 'platform'] as const;

/**
 * A part of the tenant parts list (R6, U10). Its tenant, id, source and creation time never
 * change: the app role holds no UPDATE on them. A part is never deleted, only deactivated, so
 * RFQ lines and seals that name it keep resolving. `version` counts changes for the expected
 * version every change names (R33).
 */
export const parts = pgTable(
  'parts',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    partNumber: text('part_number').notNull(),
    revision: text('revision').notNull(),
    description: text('description').notNull(),
    category: text('category', { enum: partCategories }).notNull(),
    unit: text('unit', { enum: partUnits }).notNull(),
    source: text('source', { enum: recordSources }).notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    foreignKey({ name: 'parts_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    // The target of later composite foreign keys, such as RFQ lines (KTD11).
    unique('parts_tenant_id_id_key').on(table.tenantId, table.id),
    unique('parts_tenant_id_part_number_key').on(table.tenantId, table.partNumber),
    check('parts_part_number_check', sql`${table.partNumber} ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'`),
    check('parts_revision_check', sql`${table.revision} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$'`),
    check('parts_description_check', sql`length(${table.description}) <= 500`),
    check(
      'parts_category_check',
      sql`${table.category} in ('castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics')`,
    ),
    check('parts_unit_check', sql`${table.unit} in ('each', 'kilogram', 'metre')`),
    check('parts_source_check', sql`${table.source} in ('erp', 'platform')`),
    check('parts_version_check', sql`${table.version} >= 1`),
    check('parts_updated_check', sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const partsAccess = defineTableAccess({
  table: 'parts',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      part_number: ['UPDATE'],
      revision: ['UPDATE'],
      description: ['UPDATE'],
      category: ['UPDATE'],
      unit: ['UPDATE'],
      active: ['UPDATE'],
      version: ['UPDATE'],
      updated_at: ['UPDATE'],
    },
  },
});
