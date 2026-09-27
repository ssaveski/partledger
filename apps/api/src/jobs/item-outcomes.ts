import { sql } from 'drizzle-orm';

import type { AuditDatabase } from '../audit/audit-writer';

export interface ItemReference {
  readonly tenantId: string;
  readonly job: string;
  readonly itemKey: string;
  readonly jobId: string;
  readonly now: Date;
}

/**
 * Claims an item inside the transaction that applies it (KTD16). A new item, or one a
 * previous run failed, is claimed as done; an item already done is not. A concurrent run
 * that claims the same item waits on the unique key until this transaction ends, then finds
 * the item done (after a commit) or claims it itself (after a rollback), so no item is
 * applied twice.
 */
export async function claimItem(database: AuditDatabase, item: ItemReference): Promise<boolean> {
  const result = await database.execute(
    sql`insert into job_item_outcomes (tenant_id, job, item_key, status, attempts, last_job_id, updated_at)
        values (${item.tenantId}, ${item.job}, ${item.itemKey}, 'done', 1, ${item.jobId},
                ${item.now.toISOString()}::timestamptz)
        on conflict (tenant_id, job, item_key) do update
          set status = 'done', failure = null, attempts = job_item_outcomes.attempts + 1,
              last_job_id = excluded.last_job_id, updated_at = excluded.updated_at
          where job_item_outcomes.status = 'failed'
        returning id`,
  );
  return result.rows.length === 1;
}

/** Records a failed item after its transaction rolled back; an item another run finished stays done. */
export async function recordItemFailure(
  database: AuditDatabase,
  item: ItemReference & { readonly failure: string },
): Promise<void> {
  await database.execute(
    sql`insert into job_item_outcomes (tenant_id, job, item_key, status, attempts, failure, last_job_id, updated_at)
        values (${item.tenantId}, ${item.job}, ${item.itemKey}, 'failed', 1, ${item.failure}, ${item.jobId},
                ${item.now.toISOString()}::timestamptz)
        on conflict (tenant_id, job, item_key) do update
          set failure = excluded.failure, attempts = job_item_outcomes.attempts + 1,
              last_job_id = excluded.last_job_id, updated_at = excluded.updated_at
          where job_item_outcomes.status = 'failed'`,
  );
}
