import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, tenantIdentifier, timestamptz } from './columns.ts';
import { credentials } from './credentials.ts';
import { tenants } from './tenants.ts';

/** Why a staff session ended; a session that has ended never resumes. */
export const staffSessionEndReasons = [
  'signed_out',
  'idle_timeout',
  'refresh_failed',
  'identity_changed',
  'membership_removed',
] as const;

export type StaffSessionEndReason = (typeof staffSessionEndReasons)[number];

/**
 * The server-side half of a staff session (KTD20). The browser holds only the session
 * credential (`staff_session` in `credentials`, whose expiry is the absolute timeout); the
 * identity provider's refresh token lives here, encrypted and bound to its credential, and is
 * never sent to the browser or written to a log. The subject is the identity provider's user
 * id, a pseudonymous uuid.
 */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    tenantId: tenantIdentifier(),
    credentialId: uuid('credential_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** AES-256-GCM: 12-byte nonce, ciphertext, 16-byte tag; the credential id is the associated data. */
    refreshTokenCiphertext: bytea('refresh_token_ciphertext').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    refreshedAt: timestamptz('refreshed_at').notNull(),
    endedAt: timestamptz('ended_at'),
    endReason: text('end_reason', { enum: staffSessionEndReasons }),
  },
  (table) => [
    primaryKey({ name: 'staff_sessions_pkey', columns: [table.tenantId, table.credentialId] }),
    foreignKey({ name: 'staff_sessions_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'staff_sessions_credential_fkey',
      columns: [table.tenantId, table.credentialId],
      foreignColumns: [credentials.tenantId, credentials.id],
    }),
    index('staff_sessions_subject_index').on(table.tenantId, table.subjectId),
    check(
      'staff_sessions_end_reason_check',
      sql`${table.endReason} in ('signed_out', 'idle_timeout', 'refresh_failed', 'identity_changed', 'membership_removed')`,
    ),
    check('staff_sessions_ended_check', sql`(${table.endedAt} is null) = (${table.endReason} is null)`),
    check('staff_sessions_ciphertext_check', sql`octet_length(${table.refreshTokenCiphertext}) > 28`),
  ],
);

export const staffSessionsAccess = defineTableAccess({
  table: 'staff_sessions',
  tenantKey: 'tenant_id',
  // Only the session's moving parts can change; its tenant, credential and subject cannot.
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      refresh_token_ciphertext: ['UPDATE'],
      last_seen_at: ['UPDATE'],
      refreshed_at: ['UPDATE'],
      ended_at: ['UPDATE'],
      end_reason: ['UPDATE'],
    },
  },
});
