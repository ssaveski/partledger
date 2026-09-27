import { jsonValueOf } from '@partledger/chain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertAuditSafe } from '../audit/audit-payload';
import type { AppDatabase } from '../db/tenant-transaction';
import type { JobEnqueuer } from '../jobs/job.types';
import type { NotificationRecipient } from './recipient-directory';
import { sendNotificationJob } from './send-notification.job';
import type { NotificationTemplate, TemplateParams } from './templates/template';

/**
 * What recording a notification needs: a command's context, or a job item's. The notification
 * and its send job are written in that transaction, so they commit with the change that caused
 * them, and a rolled-back command leaves neither (KTD16).
 */
export interface NotificationContext {
  readonly principal: { readonly tenantId: string };
  readonly database: AppDatabase;
  readonly jobs: JobEnqueuer;
  readonly now: Date;
}

export class RecipientKindMismatchError extends Error {
  constructor(template: string, expected: string, actual: string) {
    super(`Notification template ${template} is for ${expected}, not ${actual}`);
    this.name = 'RecipientKindMismatchError';
  }
}

const insertedRows = z.array(z.object({ id: z.uuid() }));

/**
 * Records a notification in the outbox (KTD33). An email is sent later by the
 * `notifications.send` job, enqueued here in the same transaction; an in-app notification is
 * shown in the staff shell from the commit on. The template's schema refuses any value that is
 * not an identifier, count or code. Returns the notification's id, or `null` when the
 * operational alert it delivers already reached this recipient.
 */
export async function recordNotification<Template extends NotificationTemplate>(
  context: NotificationContext,
  template: Template,
  recipient: NotificationRecipient & { readonly kind: Template['audience'] },
  params: TemplateParams<Template>,
  options: { readonly operationalAlertId?: string } = {},
): Promise<string | null> {
  if (recipient.kind !== template.audience) {
    throw new RecipientKindMismatchError(template.name, template.audience, recipient.kind);
  }
  const values = jsonValueOf(template.params.parse(params));
  assertAuditSafe(values);
  const recipientId = z.uuid().parse(recipient.id);
  const now = context.now.toISOString();
  const inApp = template.channel === 'inApp';
  const result = await context.database.execute(
    sql`insert into notifications (tenant_id, channel, template, recipient_kind, recipient_id, params,
                                   operational_alert_id, status, created_at, sent_at)
        values (${context.principal.tenantId}, ${template.channel}, ${template.name}, ${recipient.kind},
                ${recipientId}, ${JSON.stringify(values)}::jsonb, ${options.operationalAlertId ?? null},
                ${inApp ? 'sent' : 'pending'}, ${now}::timestamptz, ${inApp ? now : null}::timestamptz)
        on conflict (tenant_id, operational_alert_id, channel, recipient_kind, recipient_id) do nothing
        returning id`,
  );
  const [inserted] = insertedRows.parse(result.rows);
  if (inserted === undefined) {
    return null;
  }
  if (!inApp) {
    await context.jobs.enqueue(sendNotificationJob, { notificationId: inserted.id });
  }
  return inserted.id;
}
