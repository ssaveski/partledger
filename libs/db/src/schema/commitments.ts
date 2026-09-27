import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/**
 * The commitment store (KTD17, R39): the salt and value behind each commitment that a chain
 * payload carries. It lives outside the chain, so erasure clears the salt and value and
 * leaves every entry hash intact. A guard trigger allows exactly that one change: no other
 * update, no DELETE and no TRUNCATE, for any role.
 */
export const commitments = pgTable(
  'commitments',
  {
    tenantId: tenantIdentifier(),
    commitment: bytea('commitment').notNull(),
    salt: bytea('salt'),
    value: text('value'),
    createdAt: timestamptz('created_at').notNull(),
    erasedAt: timestamptz('erased_at'),
  },
  (table) => [
    primaryKey({ name: 'commitments_pkey', columns: [table.tenantId, table.commitment] }),
    foreignKey({ name: 'commitments_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    check('commitments_commitment_check', sql`octet_length(${table.commitment}) = 32`),
    check('commitments_salt_check', sql`${table.salt} is null or octet_length(${table.salt}) = 32`),
    check(
      'commitments_erasure_check',
      sql`(${table.erasedAt} is null and ${table.salt} is not null and ${table.value} is not null)
        or (${table.erasedAt} is not null and ${table.salt} is null and ${table.value} is null)`,
    ),
  ],
);

export const commitmentsAccess = defineTableAccess({
  table: 'commitments',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'], pl_portal: ['INSERT'], pl_ai_worker: ['INSERT'] },
  // Erasure is the one permitted change.
  columnGrants: { pl_app: { salt: ['UPDATE'], value: ['UPDATE'], erased_at: ['UPDATE'] } },
  eraseOnly: true,
});
