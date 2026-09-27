import { jsonValueOf } from '@partledger/chain';
import { operationalAlertKindSchema, type OperationalAlertKind } from '@partledger/contracts';
import { sql } from 'drizzle-orm';

import { assertAuditSafe } from '../audit/audit-payload';
import type { AuditDatabase } from '../audit/audit-writer';
import { alertTemplates, type OperationalAlertParams } from '../notifications/templates/index';

export interface OperationalAlert<Kind extends OperationalAlertKind> {
  readonly tenantId: string;
  readonly kind: Kind;
  /** Deduplicates: the same kind and key for a tenant is recorded once. */
  readonly key: string;
  /** Exactly what the kind's email template declares: identifiers, numbers and codes. */
  readonly params: OperationalAlertParams<Kind>;
  readonly raisedByJobId: string | null;
  readonly now: Date;
}

/**
 * Records an operational alert in the caller's tenant transaction (R27, KTD41). The scheduled
 * `notifications.deliverOperationalAlerts` job hands it to the tenant's alert recipients by
 * email, and the staff shell lists it. The kind and params are checked here, so an alert the
 * delivery cannot read is a bug caught where it is raised. Returns whether this call recorded it.
 */
export async function raiseOperationalAlert<Kind extends OperationalAlertKind>(
  database: AuditDatabase,
  alert: OperationalAlert<Kind>,
): Promise<boolean> {
  const kind = operationalAlertKindSchema.parse(alert.kind);
  const params = jsonValueOf(alertTemplates[kind].params.parse(alert.params));
  assertAuditSafe(params);
  const result = await database.execute(
    sql`insert into operational_alerts (tenant_id, kind, key, params, raised_by_job_id, raised_at)
        values (${alert.tenantId}, ${kind}, ${alert.key}, ${JSON.stringify(params)}::jsonb,
                ${alert.raisedByJobId}, ${alert.now.toISOString()}::timestamptz)
        on conflict (tenant_id, kind, key) do nothing
        returning id`,
  );
  return result.rows.length === 1;
}
