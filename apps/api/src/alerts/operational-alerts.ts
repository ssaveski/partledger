import type { JsonObject } from '@partledger/chain';
import type { OperationalAlertKind } from '@partledger/contracts';
import { sql } from 'drizzle-orm';

import { assertAuditSafe } from '../audit/audit-payload';
import type { AuditDatabase } from '../audit/audit-writer';

export interface OperationalAlert {
  readonly tenantId: string;
  readonly kind: OperationalAlertKind;
  /** Deduplicates: the same kind and key for a tenant is recorded once. */
  readonly key: string;
  /** Identifiers, codes and numbers only, like an audit payload. */
  readonly params: JsonObject;
  readonly raisedByJobId: string | null;
  readonly now: Date;
}

/**
 * Records an operational alert in the caller's tenant transaction (R27, KTD41). The scheduled
 * `notifications.deliverOperationalAlerts` job hands it to the tenant's alert recipients by
 * email, and the staff shell lists it. Returns whether this call recorded it.
 */
export async function raiseOperationalAlert(database: AuditDatabase, alert: OperationalAlert): Promise<boolean> {
  assertAuditSafe(alert.params);
  const result = await database.execute(
    sql`insert into operational_alerts (tenant_id, kind, key, params, raised_by_job_id, raised_at)
        values (${alert.tenantId}, ${alert.kind}, ${alert.key}, ${JSON.stringify(alert.params)}::jsonb,
                ${alert.raisedByJobId}, ${alert.now.toISOString()}::timestamptz)
        on conflict (tenant_id, kind, key) do nothing
        returning id`,
  );
  return result.rows.length === 1;
}
