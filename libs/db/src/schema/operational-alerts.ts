import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/**
 * Operational alerts (R27, KTD41): something a tenant's configured people or an operator must
 * act on, such as a chain that fails its nightly verification. Raising one only records it;
 * notifications (U34) deliver it to the tenant's alert recipients and set `notified_at`, the
 * marker that makes each alert delivered once. Parameters hold identifiers, numbers and codes,
 * never personal data or free text.
 */
export const operationalAlerts = pgTable(
  'operational_alerts',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    kind: text('kind').notNull(),
    /** The same alert raised twice (a redelivered job) is recorded once. */
    key: text('key').notNull(),
    params: jsonb('params').notNull(),
    raisedByJobId: uuid('raised_by_job_id'),
    raisedAt: timestamptz('raised_at').notNull(),
    /** When the alert was handed to its recipients; set once, by the delivery job. */
    notifiedAt: timestamptz('notified_at'),
  },
  (table) => [
    foreignKey({ name: 'operational_alerts_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    // The target of composite foreign keys from tenant-owned tables (KTD11).
    unique('operational_alerts_tenant_id_id_key').on(table.tenantId, table.id),
    unique('operational_alerts_tenant_id_kind_key_key').on(table.tenantId, table.kind, table.key),
    check('operational_alerts_kind_check', sql`${table.kind} ~ '^[a-z][a-zA-Z0-9]{0,99}$'`),
    check('operational_alerts_key_check', sql`${table.key} ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'`),
    check('operational_alerts_params_check', sql`jsonb_typeof(${table.params}) = 'object'`),
  ],
);

export const operationalAlertsAccess = defineTableAccess({
  table: 'operational_alerts',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: { pl_app: { notified_at: ['UPDATE'] } },
});
