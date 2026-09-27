import { Inject, Injectable, Logger } from '@nestjs/common';
import { operationalAlertKindSchema } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditId, auditToken } from '../audit/audit-payload';
import { defineJob, type JobContext, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { recordNotification } from './notification.service';
import { operatorFallback, type NotificationRecipient, type OperatorFallback } from './recipient-directory';
import { alertTemplates, alertUnreadableTemplate } from './templates/index';
import type { NotificationTemplate } from './templates/template';

/** Hands a tenant's new operational alerts to a person; scheduled in `jobs/schedules/notifications.ts`. */
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
const claimedRows = z.array(z.object({ kind: z.string(), params: z.unknown() }));

type AlertAudience = NotificationRecipient & { readonly kind: 'alertRecipient' | 'operator' };

/** An alert as its email will describe it: its own template, or the unreadable one. */
function readAlert(
  kind: string,
  params: unknown,
): { readonly template: NotificationTemplate; readonly params: Readonly<Record<string, unknown>> } {
  const knownKind = operationalAlertKindSchema.safeParse(kind);
  if (knownKind.success) {
    const template = alertTemplates[knownKind.data];
    const parsed = template.params.safeParse(params);
    if (parsed.success) {
      return { template, params: parsed.data };
    }
  }
  return { template: alertUnreadableTemplate, params: {} };
}

/**
 * Operational alerts reach a person, not only a table (KTD41). Each run lists the tenant's alerts
 * not yet notified; each alert is claimed by setting its `notified_at`, the delivered marker a
 * trigger keeps from ever changing, and in the same transaction one email per alert recipient is
 * recorded and its send job enqueued. A tenant with no recipient has its alerts sent to the
 * platform operator's fallback address instead. A redelivered run finds the marker set and
 * records nothing, and the outbox's unique key admits one notification per alert and recipient.
 * An alert whose kind or params cannot be read is still claimed and sent, in the unreadable
 * template's words, so it never holds back the alerts after it.
 */
@Injectable()
export class DeliverOperationalAlertsHandler implements JobHandler<typeof deliverOperationalAlertsJob> {
  private readonly logger = new Logger('Notifications');

  constructor(@Inject(operatorFallback) private readonly fallback: OperatorFallback) {}

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
    if ((await this.recipients(context)).length === 0) {
      this.logger.warn(
        `Tenant ${context.principal.tenantId} has operational alerts to deliver, no alert recipients and no operator fallback`,
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
    const recipients = await this.recipients(context);
    if (recipients.length === 0) {
      // The fallback is configuration, so this is every recipient removed since the run listed its items.
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
    const alert = readAlert(claimed.kind, claimed.params);
    let recorded = 0;
    for (const recipient of recipients) {
      const notificationId = await recordNotification(context, alert.template, recipient, alert.params, {
        operationalAlertId: alertId,
      });
      recorded += notificationId === null ? 0 : 1;
    }
    await context.audit.record(auditToken('notifications.operationalAlertDelivered'), {
      operationalAlertId: auditId(alertId),
      template: auditToken(alert.template.name),
      outcome: alert.template === alertUnreadableTemplate ? auditToken('unreadable') : auditToken('delivered'),
      recipients: recorded,
      toOperator: recipients.some((recipient) => recipient.kind === 'operator'),
    });
    return success(undefined);
  }

  private async recipients(context: JobContext): Promise<readonly AlertAudience[]> {
    const result = await context.database.execute(
      sql`select id from alert_recipients where removed_at is null order by added_at, id`,
    );
    const configured = idRows.parse(result.rows).map((row): AlertAudience => ({ kind: 'alertRecipient', id: row.id }));
    if (configured.length > 0 || this.fallback.address === null) {
      return configured;
    }
    return [{ kind: 'operator', id: schema.operatorRecipientId }];
  }
}
