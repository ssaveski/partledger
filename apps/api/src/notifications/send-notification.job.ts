import { Inject, Injectable, Logger } from '@nestjs/common';
import { operationalAlertKindSchema } from '@partledger/contracts';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { raiseOperationalAlert } from '../alerts/operational-alerts';
import { auditId, auditToken } from '../audit/audit-payload';
import { defineJob, jobField, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { emailPort, type EmailMessage, type EmailPort } from './email.port';
import { recipientDirectory, type RecipientDirectory } from './recipient-directory';
import { templateNamed } from './templates/index';
import { linkOrigins, renderEmail, type LinkOrigins } from './templates/render';

/**
 * How many times an email is tried before it is given up and an operational alert raised. The
 * job's retry limit leaves room above it, so the last attempt always runs under pg-boss.
 */
export const maximumSendAttempts = 4;

export const sendNotificationJob = defineJob({
  name: 'notifications.send',
  description: 'Sends one email notification through the email port, retrying until it is sent or given up.',
  payload: { notificationId: jobField.id() },
  retryLimit: maximumSendAttempts + 2,
  retryDelaySeconds: 30,
  expireInSeconds: 300,
});

const notificationRows = z.array(
  z.object({
    channel: z.enum(['email', 'inApp']),
    template: z.string(),
    recipient_kind: z.enum(['person', 'supplierContact', 'alertRecipient']),
    recipient_id: z.uuid(),
    params: z.record(z.string(), z.unknown()),
    status: z.enum(['pending', 'sent', 'failed']),
    alert_kind: z.string().nullable(),
  }),
);
const tenantRows = z.array(z.object({ display_name: z.string() }));

type Outcome = 'sent' | 'failed';

/**
 * Sends one notification (KTD33). The item's transaction holds the claim on the notification
 * while the email is handed to the port, so a redelivered job waits and then finds it sent. A
 * failed send is retried by pg-boss; after `maximumSendAttempts` the notification is marked
 * failed and a `notificationDeliveryFailed` alert raised, unless the failed email was itself
 * such an alert, which would otherwise raise alerts without end.
 */
@Injectable()
export class SendNotificationHandler implements JobHandler<typeof sendNotificationJob> {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(emailPort) private readonly email: EmailPort,
    @Inject(recipientDirectory) private readonly recipients: RecipientDirectory,
    @Inject(linkOrigins) private readonly origins: LinkOrigins,
  ) {}

  items(payload: PayloadOf<typeof sendNotificationJob>): Promise<readonly string[]> {
    return Promise.resolve([`notification:${payload.notificationId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof sendNotificationJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const { notificationId } = payload;
    const [notification] = notificationRows.parse(
      (
        await context.database.execute(
          sql`select notification.channel, notification.template, notification.recipient_kind,
                     notification.recipient_id, notification.params, notification.status,
                     alert.kind as alert_kind
                from notifications notification
                left join operational_alerts alert
                  on alert.tenant_id = notification.tenant_id and alert.id = notification.operational_alert_id
               where notification.id = ${notificationId}`,
        )
      ).rows,
    );
    if (notification?.status !== 'pending' || notification.channel !== 'email') {
      return success(undefined);
    }
    const template = templateNamed(notification.template);
    const params = template?.params.safeParse(notification.params);
    if (template === undefined || params?.success !== true) {
      return this.finish(context, notificationId, 'failed', 'templateInvalid');
    }
    const address = await this.recipients.emailAddressOf(context.database, {
      kind: notification.recipient_kind,
      id: notification.recipient_id,
    });
    if (address === null) {
      return this.finish(context, notificationId, 'failed', 'recipientUnavailable');
    }
    const [tenant] = tenantRows.parse(
      (await context.database.execute(sql`select display_name from tenants where id = ${context.principal.tenantId}`))
        .rows,
    );
    const rendered = renderEmail(template, params.data, {
      tenantName: tenant?.display_name ?? '',
      origins: this.origins,
    });
    const sent = await this.send({ to: address, ...rendered, idempotencyKey: notificationId }, context.jobId);
    if (sent) {
      return this.finish(context, notificationId, 'sent', null);
    }
    if (context.attempt < maximumSendAttempts) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    const failureCode = 'emailUnavailable';
    const alertKind = operationalAlertKindSchema.safeParse(notification.alert_kind);
    if (!(alertKind.success && alertKind.data === 'notificationDeliveryFailed')) {
      await raiseOperationalAlert(context.database, {
        tenantId: context.principal.tenantId,
        kind: 'notificationDeliveryFailed',
        key: `notification:${notificationId}`,
        params: { notificationId, template: notification.template, attempts: context.attempt },
        raisedByJobId: context.jobId,
        now: context.now,
      });
    }
    return this.finish(context, notificationId, 'failed', failureCode);
  }

  /** An adapter that throws is treated as unavailable; its error may quote the address, so only the job id is logged. */
  private async send(message: EmailMessage, jobId: string): Promise<boolean> {
    try {
      return (await this.email.send(message)).ok;
    } catch {
      this.logger.warn(`The email port threw while sending; correlation ${jobId}`);
      return false;
    }
  }

  private async finish(
    context: JobItemContext,
    notificationId: string,
    outcome: Outcome,
    failureCode: string | null,
  ): Promise<Result<void, DomainError>> {
    const now = context.now.toISOString();
    await context.database.execute(
      outcome === 'sent'
        ? sql`update notifications set status = 'sent', attempts = ${context.attempt}, sent_at = ${now}::timestamptz
               where id = ${notificationId}`
        : sql`update notifications
                 set status = 'failed', attempts = ${context.attempt}, failure = ${failureCode},
                     failed_at = ${now}::timestamptz
               where id = ${notificationId}`,
    );
    await context.audit.record(auditToken(outcome === 'sent' ? 'notifications.sent' : 'notifications.failed'), {
      notificationId: auditId(notificationId),
      attempts: context.attempt,
      failure: failureCode === null ? null : auditToken(failureCode),
    });
    return success(undefined);
  }
}
