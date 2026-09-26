import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { credentialResolverRole } from '../roles.ts';
import { defineTableAccess } from '../table-access.ts';
import { bytea, generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/**
 * Credentials presented before a tenant is known (KTD37). Every kind has the same shape:
 * a public id plus a 256-bit secret of which only the SHA-256 is stored.
 */
export const credentialKinds = ['staff_session', 'supplier_link', 'drop_credential', 'operator_grant'] as const;

export type CredentialKind = (typeof credentialKinds)[number];

export const credentials = pgTable(
  'credentials',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    kind: text('kind', { enum: credentialKinds }).notNull(),
    subjectId: uuid('subject_id'),
    secretHash: bytea('secret_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: 'credentials_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    index('credentials_tenant_id_index').on(table.tenantId),
    check(
      'credentials_kind_check',
      sql`${table.kind} in ('staff_session', 'supplier_link', 'drop_credential', 'operator_grant')`,
    ),
    check('credentials_secret_hash_check', sql`octet_length(${table.secretHash}) = 32`),
    check('credentials_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const credentialsAccess = defineTableAccess({
  table: 'credentials',
  tenantKey: 'tenant_id',
  // The app issues credentials inside a tenant context and never reads them back directly;
  // lookups go through resolve_credential, owned by the resolver role.
  grants: { pl_app: ['INSERT'], [credentialResolverRole]: ['SELECT'] },
  readAllPolicyRoles: [credentialResolverRole],
});
