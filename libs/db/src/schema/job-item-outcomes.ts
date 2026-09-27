import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

export const jobItemStatuses = ['done', 'failed'] as const;

/**
 * What a background job did with each of its items (KTD16). An item is named by a domain key,
 * unique per tenant and job, and is claimed inside the transaction that applies it: a
 * redelivered job waits on the unique key while the first run applies an item and then skips
 * it, and a retry applies only the items that are not done.
 */
export const jobItemOutcomes = pgTable(
  'job_item_outcomes',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    job: text('job').notNull(),
    itemKey: text('item_key').notNull(),
    status: text('status', { enum: jobItemStatuses }).notNull(),
    attempts: integer('attempts').notNull(),
    /** A code, such as `Unavailable.scanner` or `unexpected`; never a message or a value. */
    failure: text('failure'),
    lastJobId: uuid('last_job_id').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    foreignKey({ name: 'job_item_outcomes_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    unique('job_item_outcomes_tenant_id_job_item_key_key').on(table.tenantId, table.job, table.itemKey),
    index('job_item_outcomes_status_index').on(table.tenantId, table.job, table.status),
    check('job_item_outcomes_job_check', sql`${table.job} ~ '^[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*$'`),
    check('job_item_outcomes_item_key_check', sql`${table.itemKey} ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'`),
    check('job_item_outcomes_status_check', sql`${table.status} in ('done', 'failed')`),
    check('job_item_outcomes_attempts_check', sql`${table.attempts} >= 1`),
    check(
      'job_item_outcomes_failure_check',
      sql`(${table.status} = 'done' and ${table.failure} is null)
        or (${table.status} = 'failed' and ${table.failure} ~ '^[a-zA-Z][a-zA-Z0-9._]{0,99}$')`,
    ),
  ],
);

export const jobItemOutcomesAccess = defineTableAccess({
  table: 'job_item_outcomes',
  tenantKey: 'tenant_id',
  // UPDATE turns a failed item into a done one when a retry applies it.
  grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE'] },
});
