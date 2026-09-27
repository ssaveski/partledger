import { z } from 'zod';

import { defineCommand, defineQuery } from '../define';
import { errorCode, messageKeySchema } from '../errors';

/**
 * Notifications (U34): the in-app alerts of the staff shell, and the people a tenant configures
 * to receive its operational alerts by email (R6, R27, KTD41).
 */

/**
 * What an operational alert can be about. Each kind has an in-app title and description
 * (`pl.notifications.alert.<kind>.*`) and an email template for the tenant's alert recipients.
 */
export const operationalAlertKinds = [
  'chainVerificationFailed',
  'dropMissed',
  'scannerUnavailable',
  'notificationDeliveryFailed',
] as const;

export const operationalAlertKindSchema = z.enum(operationalAlertKinds);

export type OperationalAlertKind = z.infer<typeof operationalAlertKindSchema>;

export const staffAlertSources = ['operational', 'notification'] as const;

/** A path inside the staff app, such as `/rfqs/<id>`; never a URL to another origin. */
export const staffPathSchema = z
  .string()
  .regex(/^\/(?:[a-zA-Z0-9-]+(?:\/[a-zA-Z0-9-]+)*)?$/)
  .describe('A path inside the staff app to open for this alert.');

export const staffAlertSchema = z
  .object({
    alertId: z.uuid().describe('The operational alert or in-app notification.'),
    source: z
      .enum(staffAlertSources)
      .describe('An operational alert of the tenant, or a notification addressed to the reader.'),
    titleKey: messageKeySchema.describe('The translation key of the alert title.'),
    descriptionKey: messageKeySchema.describe('The translation key of the alert description.'),
    params: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .describe('Values for the title and description: identifiers, counts and codes only.'),
    keyParams: z
      .record(z.string(), messageKeySchema)
      .describe('Values that are themselves messages, such as the name of a template: translate each first.'),
    raisedAt: z.iso.datetime().describe('When the alert was raised, in UTC.'),
    path: staffPathSchema.nullable(),
  })
  .strict()
  .describe('One alert shown in the staff shell.');

export type StaffAlert = z.infer<typeof staffAlertSchema>;

/** How far back the shell looks, and how many alerts it shows at most. */
export const staffAlertWindowDays = 30;
export const staffAlertLimit = 50;

export const staffAlertsSchema = z
  .object({
    alerts: z.array(staffAlertSchema).max(staffAlertLimit).describe('The alerts, newest first.'),
  })
  .strict()
  .describe("The tenant's recent operational alerts and the reader's in-app notifications.");

export type StaffAlerts = z.infer<typeof staffAlertsSchema>;

export const staffAlertsQuery = defineQuery({
  name: 'notifications.alerts',
  description:
    "Read the tenant's operational alerts and the reader's in-app notifications from the last 30 days, newest first.",
  input: z.object({}).strict().describe('Nothing: the tenant and the reader come from the session.'),
  output: staffAlertsSchema,
  errors: [errorCode('Forbidden', 'notPermitted')],
  access: { person: ['tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'] },
});

const alertRecipientIdSchema = z.uuid().describe('The alert recipient.');

export const addAlertRecipientCommand = defineCommand({
  name: 'notifications.addAlertRecipient',
  description: "Add an email address that receives the tenant's operational alerts.",
  purpose: 'administration',
  input: z
    .object({
      emailAddress: z
        .email()
        .max(254)
        .transform((address) => address.toLowerCase())
        .describe('Where the alerts are sent; stored in lower case.'),
    })
    .strict()
    .describe('The address to add.'),
  output: z.object({ alertRecipientId: alertRecipientIdSchema }).strict().describe('The added recipient.'),
  errors: [errorCode('Conflict', 'alreadyExists')],
  access: { person: ['tenant_admin'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const removeAlertRecipientCommand = defineCommand({
  name: 'notifications.removeAlertRecipient',
  description: "Stop sending the tenant's operational alerts to a recipient.",
  purpose: 'administration',
  input: z.object({ alertRecipientId: alertRecipientIdSchema }).strict().describe('The recipient to remove.'),
  output: z.object({ alertRecipientId: alertRecipientIdSchema }).strict().describe('The removed recipient.'),
  errors: [errorCode('NotFound', 'resource')],
  access: { person: ['tenant_admin'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});
