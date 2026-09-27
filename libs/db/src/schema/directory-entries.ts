import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { tenantRegions } from './tenants.ts';

/**
 * The global directory (R1): a tenant's slug and the region it lives in, and nothing else, so
 * the staff app can send a person to their region before anyone is signed in. It is a global
 * table: it holds no tenant's data and is read before any tenant is known. A tenant is added
 * in its own provisioning transaction, and the insert policy admits only the slug and region
 * of the tenant that transaction can see.
 */
export const directoryEntries = pgTable(
  'directory_entries',
  {
    slug: text('slug').primaryKey(),
    region: text('region', { enum: tenantRegions }).notNull(),
  },
  (table) => [
    check('directory_entries_slug_check', sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('directory_entries_region_check', sql`${table.region} in ('ca', 'eu')`),
  ],
);

export const directoryEntriesAccess = defineTableAccess({
  table: 'directory_entries',
  tenantKey: 'none',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  policies: [
    { name: 'directory_entries_lookup', command: 'r', role: 'pl_app', using: 'true', check: null },
    {
      name: 'directory_entries_register',
      command: 'a',
      role: 'pl_app',
      using: null,
      check:
        '(EXISTS ( SELECT 1\n   FROM tenants\n  WHERE ((tenants.slug = directory_entries.slug) AND (tenants.region = directory_entries.region))))',
    },
  ],
});
