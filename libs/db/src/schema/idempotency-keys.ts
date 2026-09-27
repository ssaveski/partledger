import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { credentials } from './credentials.ts';
import { tenants } from './tenants.ts';

/**
 * Idempotency keys (KTD14, R33). A command inserts its key first, inside its own transaction,
 * so a concurrent retry waits on the unique key and then replays the committed result, and a
 * failed command leaves no key behind. A key belongs to one credential: another credential
 * reusing it acts independently and never sees this result. The result is the command's
 * output, which holds identifiers only, and expires with the key.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    credentialId: uuid('credential_id').notNull(),
    command: text('command').notNull(),
    key: text('key').notNull(),
    /** SHA-256 of the canonical JSON of the parsed input; a reused key with another body is refused. */
    fingerprint: bytea('fingerprint').notNull(),
    result: jsonb('result'),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    foreignKey({ name: 'idempotency_keys_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'idempotency_keys_credential_fkey',
      columns: [table.tenantId, table.credentialId],
      foreignColumns: [credentials.tenantId, credentials.id],
    }),
    unique('idempotency_keys_tenant_id_credential_id_command_key_key').on(
      table.tenantId,
      table.credentialId,
      table.command,
      table.key,
    ),
    index('idempotency_keys_expires_at_index').on(table.tenantId, table.expiresAt),
    check('idempotency_keys_key_check', sql`${table.key} ~ '^[A-Za-z0-9_-]{16,128}$'`),
    check('idempotency_keys_command_check', sql`${table.command} ~ '^[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*$'`),
    check('idempotency_keys_fingerprint_check', sql`octet_length(${table.fingerprint}) = 32`),
    check('idempotency_keys_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const idempotencyKeysAccess = defineTableAccess({
  table: 'idempotency_keys',
  tenantKey: 'tenant_id',
  // UPDATE records the result and takes over an expired key; DELETE purges expired keys.
  grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
});
