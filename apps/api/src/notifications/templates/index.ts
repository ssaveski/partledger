import type { OperationalAlertKind } from '@partledger/contracts';
import { schema } from '@partledger/db';

import { defineTemplate, templateField, type NotificationTemplate, type TemplateParams } from './template';

/**
 * Every notification template. The modules that raise these (RFQ amendments in U16, evidence
 * expiry in U15, export drops in U13, scanning in U14) record them through `recordNotification`.
 */

/** Every template's name, so an alert about a failed email can name which one failed. */
export const templateNames = [
  'rfqAmended',
  'evidenceExpiring',
  'alertChainVerificationFailed',
  'alertDropMissed',
  'alertScannerUnavailable',
  'alertNotificationDeliveryFailed',
  'alertUnreadable',
] as const;

/** Suppliers invited to an RFQ learn that it changed (R16); the link opens the portal. */
export const rfqAmendedTemplate = defineTemplate({
  name: 'rfqAmended',
  channel: 'email',
  audiences: ['supplierContact'],
  params: { rfqId: templateField.id(), version: templateField.count() },
  link: ({ rfqId }) => ({ app: 'portal', path: `/rfqs/${rfqId}` }),
});

/**
 * Staff learn that supplier evidence expires soon (R14). The ids let the shell name the document
 * and supplier once their tables exist (U10, U15); the link opens evidence review (U27).
 */
export const evidenceExpiringTemplate = defineTemplate({
  name: 'evidenceExpiring',
  channel: 'inApp',
  audiences: ['person'],
  params: { evidenceId: templateField.id(), supplierId: templateField.id(), daysLeft: templateField.count() },
  countParam: 'daysLeft',
  link: () => ({ app: 'staff', path: '/evidence' }),
});

const staffHome = { app: 'staff', path: '/' } as const;

/** Alert emails go to the tenant's alert recipients, or to the platform operator when it has none. */
const alertAudiences = ['alertRecipient', 'operator'] as const;

/**
 * Operational alerts reach a person by email (R6, R27, KTD41). A template's params are exactly
 * what its alert carries: `raiseOperationalAlert` checks them against it.
 */
export const alertTemplates = {
  chainVerificationFailed: defineTemplate({
    name: 'alertChainVerificationFailed',
    channel: 'email',
    audiences: alertAudiences,
    params: { firstFailingSeq: templateField.count(), reason: templateField.code() },
    link: () => staffHome,
  }),
  dropMissed: defineTemplate({
    name: 'alertDropMissed',
    channel: 'email',
    audiences: alertAudiences,
    params: {},
    link: () => staffHome,
  }),
  scannerUnavailable: defineTemplate({
    name: 'alertScannerUnavailable',
    channel: 'email',
    audiences: alertAudiences,
    params: {},
    link: () => staffHome,
  }),
  notificationDeliveryFailed: defineTemplate({
    name: 'alertNotificationDeliveryFailed',
    channel: 'email',
    audiences: alertAudiences,
    params: {
      notificationId: templateField.id(),
      template: templateField.oneOf(templateNames),
      recipientKind: templateField.oneOf(schema.notificationRecipientKinds),
      attempts: templateField.count(),
    },
    countParam: 'attempts',
    keyParams: { template: 'pl.notifications.templateName', recipientKind: 'pl.notifications.recipientKind' },
    link: () => staffHome,
  }),
} as const satisfies Record<OperationalAlertKind, NotificationTemplate>;

/** What an alert of each kind carries. */
export type OperationalAlertParams<Kind extends OperationalAlertKind> = TemplateParams<(typeof alertTemplates)[Kind]>;

/**
 * Sent instead when a stored alert's kind or params cannot be read, so a person still hears of
 * it and the alerts after it are not held back.
 */
export const alertUnreadableTemplate = defineTemplate({
  name: 'alertUnreadable',
  channel: 'email',
  audiences: alertAudiences,
  params: {},
  link: () => staffHome,
});

export const notificationTemplates: readonly NotificationTemplate[] = [
  rfqAmendedTemplate,
  evidenceExpiringTemplate,
  ...Object.values(alertTemplates),
  alertUnreadableTemplate,
];

const templatesByName = new Map(notificationTemplates.map((template) => [template.name, template]));

export function templateNamed(name: string): NotificationTemplate | undefined {
  return templatesByName.get(name);
}
