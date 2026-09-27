import type { OperationalAlertKind } from '@partledger/contracts';

import { defineTemplate, templateField, type NotificationTemplate } from './template';

/**
 * Every notification template. The modules that raise these (RFQ amendments in U16, evidence
 * expiry in U15, export drops in U13, scanning in U14) record them through `recordNotification`.
 */

/** Suppliers invited to an RFQ learn that it changed (R16); the link opens the portal. */
export const rfqAmendedTemplate = defineTemplate({
  name: 'rfqAmended',
  channel: 'email',
  audience: 'supplierContact',
  params: { rfqId: templateField.id(), version: templateField.count() },
  link: ({ rfqId }) => ({ app: 'portal', path: `/rfqs/${rfqId}` }),
});

/** Staff learn that supplier evidence expires soon (R14). */
export const evidenceExpiringTemplate = defineTemplate({
  name: 'evidenceExpiring',
  channel: 'inApp',
  audience: 'person',
  params: { evidenceId: templateField.id(), daysLeft: templateField.count() },
  link: () => null,
});

const staffHome = { app: 'staff', path: '/' } as const;

/** Operational alerts reach the tenant's alert recipients by email (R6, R27, KTD41). */
export const alertTemplates = {
  chainVerificationFailed: defineTemplate({
    name: 'alertChainVerificationFailed',
    channel: 'email',
    audience: 'alertRecipient',
    params: { firstFailingSeq: templateField.count() },
    link: () => staffHome,
  }),
  dropMissed: defineTemplate({
    name: 'alertDropMissed',
    channel: 'email',
    audience: 'alertRecipient',
    params: {},
    link: () => staffHome,
  }),
  scannerUnavailable: defineTemplate({
    name: 'alertScannerUnavailable',
    channel: 'email',
    audience: 'alertRecipient',
    params: {},
    link: () => staffHome,
  }),
  notificationDeliveryFailed: defineTemplate({
    name: 'alertNotificationDeliveryFailed',
    channel: 'email',
    audience: 'alertRecipient',
    params: { attempts: templateField.count() },
    link: () => staffHome,
  }),
} as const satisfies Record<OperationalAlertKind, NotificationTemplate>;

export const notificationTemplates: readonly NotificationTemplate[] = [
  rfqAmendedTemplate,
  evidenceExpiringTemplate,
  ...Object.values(alertTemplates),
];

const templatesByName = new Map(notificationTemplates.map((template) => [template.name, template]));

export function templateNamed(name: string): NotificationTemplate | undefined {
  return templatesByName.get(name);
}
