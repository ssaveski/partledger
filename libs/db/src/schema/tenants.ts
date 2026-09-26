import { sql } from 'drizzle-orm';
import { check, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, timestamptz } from './columns.ts';

/** Data-residency regions a tenant can be pinned to at creation (R1). */
export const tenantRegions = ['ca', 'eu'] as const;

export const tenants = pgTable(
  'tenants',
  {
    id: generatedIdentifier(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    region: text('region', { enum: tenantRegions }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('tenants_slug_key').on(table.slug),
    check('tenants_slug_check', sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('tenants_region_check', sql`${table.region} in ('ca', 'eu')`),
    check('tenants_display_name_check', sql`length(${table.displayName}) between 1 and 200`),
  ],
);

export const tenantsAccess = defineTableAccess({
  table: 'tenants',
  tenantKey: 'id',
  grants: { pl_app: ['SELECT'] },
});
