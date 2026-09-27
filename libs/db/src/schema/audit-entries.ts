import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, jsonb, pgTable, primaryKey, smallint, text, unique } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/** Who acted (R26); the same list as the principal types, fixed here because the chain hashes it. */
export const auditActorTypes = ['person', 'ai_agent', 'supplier_token', 'system', 'platform_operator'] as const;

/**
 * The tenant's hash chain (KTD17, R26). `canonical` holds the exact bytes that were hashed
 * into `entry_hash`; every other column is a copy for querying, which the verifier checks
 * against those bytes. Entries are insert-only: grants give no UPDATE or DELETE and guard
 * triggers refuse them, and TRUNCATE, for every role including the owner (KTD11).
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    tenantId: tenantIdentifier(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    prevHash: bytea('prev_hash').notNull(),
    entryHash: bytea('entry_hash').notNull(),
    canonical: bytea('canonical').notNull(),
    actorType: text('actor_type', { enum: auditActorTypes }).notNull(),
    actorId: text('actor_id'),
    actedUnder: jsonb('acted_under').notNull(),
    correlationId: text('correlation_id').notNull(),
    time: timestamptz('time').notNull(),
    schemaVersion: smallint('schema_version').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (table) => [
    primaryKey({ name: 'audit_entries_pkey', columns: [table.tenantId, table.seq] }),
    // The genesis entry chains to a fixed constant, so this also allows one genesis per tenant.
    unique('audit_entries_tenant_id_prev_hash_key').on(table.tenantId, table.prevHash),
    foreignKey({ name: 'audit_entries_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    check('audit_entries_seq_check', sql`${table.seq} >= 1`),
    check('audit_entries_prev_hash_check', sql`octet_length(${table.prevHash}) = 32`),
    check('audit_entries_entry_hash_check', sql`octet_length(${table.entryHash}) = 32`),
    check(
      'audit_entries_actor_type_check',
      sql`${table.actorType} in ('person', 'ai_agent', 'supplier_token', 'system', 'platform_operator')`,
    ),
    check('audit_entries_schema_version_check', sql`${table.schemaVersion} = 1`),
  ],
);

/** The columns an appender needs to find the head; `pl_portal` and `pl_ai_worker` may read only these. */
const chainHeadColumns = { tenant_id: ['SELECT'], seq: ['SELECT'], entry_hash: ['SELECT'], time: ['SELECT'] } as const;

export const auditEntriesAccess = defineTableAccess({
  table: 'audit_entries',
  tenantKey: 'tenant_id',
  grants: {
    pl_app: ['SELECT', 'INSERT'],
    pl_portal: ['INSERT'],
    pl_ai_worker: ['INSERT'],
    pl_verifier: ['SELECT'],
  },
  columnGrants: { pl_portal: chainHeadColumns, pl_ai_worker: chainHeadColumns },
  insertOnly: true,
});
