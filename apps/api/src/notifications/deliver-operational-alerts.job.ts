import { Injectable, Logger } from '@nestjs/common';
import { operationalAlertKindSchema } from '@partledger/contracts';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditId, auditToken } from '../audit/audit-payload';
import { defineJob, type JobContext, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { recordNotification } from './notification.service';
import { alertTemplates } from './templates/index';

/** Hands a tenant's new operational alerts to its alert recipients; scheduled in `jobs/schedules/notifications.ts`. */
export const deliverOperationalAlertsJob = defineJob({
  name: 'notifications.deliverOperationalAlerts',
  description: "Emails the tenant's new operational alerts to its alert recipients, each alert once.",
  payload: {},
  retryLimit: 3,
  retryDelaySeconds: 60,
  expireInSeconds: 600,
});

/** Alerts handed over per run; a backlog drains over the following runs. */
const alertsPerRun = 100;

const alertItemPrefix = 'alert:';

const idRows = z.array(z.object({ id: z.uuid() }));
const claimedRows = z.array(z.object({ kind: z.string(), params: z.record(z.string(), z.unknown()) }));

/**
 * Operational alerts reach a person, not only a table (KTD41). Each run lists the tenant's alerts
 * not yet notified; each alert is claimed by setting its `notified_at`, the delivered marker a
 * trigger keeps from ever changing, and in the same transaction one email notification per
 * alert recipient is recorded and its send job enqueued. A redelivered run finds the marker
 * set and records nothing, and the outbox's unique key admits one notification per alert and
 * recipient. A tenant with no recipients keeps its alerts undelivered, and listed in the staff
 * shell, until someone is configured.
 */
@Injectable()
export class DeliverOperationalAlertsHandler implements JobHandler<typeof deliverOperationalAlertsJob> {
  private readonly logger = new Logger('Notifications');

  async items(
    _payload: PayloadOf<typeof deliverOperationalAlertsJob>,
    context: JobContext,
  ): Promise<readonly string[]> {
    const pending = idRows.parse(
      (
        await context.database.execute(
          sql`select id from operational_alerts where notified_at is null order by raised_at, id limit ${alertsPerRun}`,
        )
      ).rows,
    );
    if (pending.length === 0) {
      return [];
    }
    if ((await activeRecipients(context)).length === 0) {
      this.logger.warn(
        `Tenant ${context.principal.tenantId} has operational alerts to deliver and no alert recipients`,
      );
      return [];
    }
    return pending.map((alert) => `${alertItemPrefix}${alert.id}`);
  }

  async apply(
    item: string,
    _payload: PayloadOf<typeof deliverOperationalAlertsJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const alertId = z.uuid().parse(item.slice(alertItemPrefix.length));
    const recipients = await activeRecipients(context);
    if (recipients.length === 0) {
      // Every recipient was removed since the run listed its items; a later run delivers it.
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    const [claimed] = claimedRows.parse(
      (
        await context.database.execute(
          sql`update operational_alerts set notified_at = ${context.now.toISOString()}::timestamptz
               where id = ${alertId} and notified_at is null
               returning kind, params`,
        )
      ).rows,
    );
    if (claimed === undefined) {
      return success(undefined);
    }
    const kind = operationalAlertKindSchema.parse(claimed.kind);
    const template = alertTemplates[kind];
    const declared = Object.keys(template.params.shape);
    const params = template.params.parse(
      Object.fromEntries(Object.entries(claimed.params).filter(([name]) => declared.includes(name))),
    );
    let recorded = 0;
    for (const recipient of recipients) {
      const notificationId = await recordNotification(
        context,
        template,
        { kind: 'alertRecipient', id: recipient.id },
        params,
        { operationalAlertId: alertId },
      );
      recorded += notificationId === null ? 0 : 1;
    }
    await context.audit.record(auditToken('notifications.operationalAlertDelivered'), {
      operationalAlertId: auditId(alertId),
      kind: auditToken(kind),
      recipients: recorded,
    });
    return success(undefined);
  }
}

async function activeRecipients(context: JobContext): Promise<readonly { readonly id: string }[]> {
  const result = await context.database.execute(
    sql`select id from alert_recipients where removed_at is null order by added_at, id`,
  );
  return idRows.parse(result.rows);
}
