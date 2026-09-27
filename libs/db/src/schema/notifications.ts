import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { operationalAlerts } from './operational-alerts.ts';
import { tenants } from './tenants.ts';

/** How a notification reaches its recipient: an email with a link, or an alert in the staff shell. */
export const notificationChannels = ['email', 'inApp'] as const;

/**
 * Who a notification is for. Only the kind and id are stored; an email address is resolved when
 * the notification is sent, so the outbox never holds one (R39, KTD16).
 */
export const notificationRecipientKinds = ['person', 'supplierContact', 'alertRecipient'] as const;

export const notificationStatuses = ['pending', 'sent', 'failed'] as const;

/**
 * The notification outbox (KTD33, KTD16). A command records a notification in its own
 * transaction, so one recorded by a rolled-back command never exists; a job sends it through
 * the email port. Parameters hold identifiers, counts, dates and codes, never RFQ content or
 * personal data. Once sent or failed, a notification never changes again.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    channel: text('channel', { enum: notificationChannels }).notNull(),
    template: text('template').notNull(),
    recipientKind: text('recipient_kind', { enum: notificationRecipientKinds }).notNull(),
    recipientId: uuid('recipient_id').notNull(),
    params: jsonb('params').notNull(),
    /** The operational alert this notification delivers, if any. */
    operationalAlertId: uuid('operational_alert_id'),
    status: text('status', { enum: notificationStatuses }).notNull(),
    /** Send attempts so far; in-app notifications are never sent, so theirs stays 0. */
    attempts: integer('attempts').notNull().default(0),
    /** A code, such as `Unavailable.dependencyUnavailable`; never a message or a value. */
    failure: text('failure'),
    createdAt: timestamptz('created_at').notNull(),
    sentAt: timestamptz('sent_at'),
    failedAt: timestamptz('failed_at'),
  },
  (table) => [
    foreignKey({ name: 'notifications_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'notifications_operational_alert_fkey',
      columns: [table.tenantId, table.operationalAlertId],
      foreignColumns: [operationalAlerts.tenantId, operationalAlerts.id],
    }),
    // Each operational alert reaches each recipient once, however often its delivery runs.
    unique('notifications_alert_recipient_key').on(
      table.tenantId,
      table.operationalAlertId,
      table.channel,
      table.recipientKind,
      table.recipientId,
    ),
    index('notifications_recipient_index').on(table.tenantId, table.recipientKind, table.recipientId, table.createdAt),
    check('notifications_channel_check', sql`${table.channel} in ('email', 'inApp')`),
    check('notifications_template_check', sql`${table.template} ~ '^[a-z][a-zA-Z0-9]{0,99}$'`),
    check(
      'notifications_recipient_kind_check',
      sql`${table.recipientKind} in ('person', 'supplierContact', 'alertRecipient')`,
    ),
    check('notifications_params_check', sql`jsonb_typeof(${table.params}) = 'object'`),
    check('notifications_status_check', sql`${table.status} in ('pending', 'sent', 'failed')`),
    check('notifications_attempts_check', sql`${table.attempts} >= 0`),
    check('notifications_sent_check', sql`(${table.status} = 'sent') = (${table.sentAt} is not null)`),
    check(
      'notifications_failed_check',
      sql`(${table.status} = 'failed') = (${table.failedAt} is not null)
        and (${table.status} = 'failed') = (${table.failure} is not null)`,
    ),
    check('notifications_failure_check', sql`${table.failure} ~ '^[a-zA-Z][a-zA-Z0-9._]{0,99}$'`),
    check(
      'notifications_in_app_check',
      sql`${table.channel} <> 'inApp' or (${table.recipientKind} = 'person' and ${table.status} = 'sent')`,
    ),
  ],
);

export const notificationsAccess = defineTableAccess({
  table: 'notifications',
  tenantKey: 'tenant_id',
  // Only the delivery state moves, and a trigger freezes it once the notification is sent or failed.
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      status: ['UPDATE'],
      attempts: ['UPDATE'],
      failure: ['UPDATE'],
      sent_at: ['UPDATE'],
      failed_at: ['UPDATE'],
    },
  },
});

/**
 * The people a tenant has configured to receive its operational alerts by email (R6, R27,
 * KTD41). An address is personal data: it lives here, under row-level security, and is erased
 * with the recipient; the outbox and the audit chain refer to the recipient by id only.
 */
export const alertRecipients = pgTable(
  'alert_recipients',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    emailAddress: text('email_address').notNull(),
    addedAt: timestamptz('added_at').notNull(),
    removedAt: timestamptz('removed_at'),
  },
  (table) => [
    foreignKey({ name: 'alert_recipients_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    uniqueIndex('alert_recipients_active_address_key')
      .on(table.tenantId, table.emailAddress)
      .where(sql`${table.removedAt} is null`),
    check(
      'alert_recipients_email_address_check',
      sql`length(${table.emailAddress}) <= 254 and ${table.emailAddress} = lower(${table.emailAddress})
        and ${table.emailAddress} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
  ],
);

export const alertRecipientsAccess = defineTableAccess({
  table: 'alert_recipients',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: { pl_app: { removed_at: ['UPDATE'] } },
});
