import { Injectable } from '@nestjs/common';
import { defineCommand, errorCode, type InputOf } from '@partledger/contracts';
import { refuse, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import {
  registerCommand,
  type CommandContext,
  type CommandHandler,
  type HandlerResult,
  type OperationRegistry,
} from '../../src/commands/handlers';
import { productionRegistry } from '../../src/commands/query-registry';
import type { EmailMessage, EmailPort, EmailUnavailable } from '../../src/notifications/email.port';
import { LocalEmailAdapter } from '../../src/notifications/local-email.adapter';
import { recordNotification } from '../../src/notifications/notification.service';
import { storedRecipientDirectory, type RecipientDirectory } from '../../src/notifications/recipient-directory';
import { evidenceExpiringTemplate, rfqAmendedTemplate } from '../../src/notifications/templates/index';

/**
 * Stand-ins for the modules that will record notifications (U15, U16) and for the supplier
 * contacts U10 adds, never part of the production registries.
 */

/** Synthetic RFQ content that the commands below hold and must never reach an email. */
export const syntheticRfqContent = {
  partNumber: 'PN-48213-A',
  description: 'Synthetic titanium mounting bracket, anodised',
  unitPrice: '1250.75',
} as const;

export const amendRfq = defineCommand({
  name: 'notificationsTest.amendRfq',
  description: 'Stands in for amending an RFQ: notifies the invited supplier contacts; optionally refuses afterwards.',
  purpose: 'business',
  input: z
    .object({
      rfqId: z.uuid().describe('The RFQ.'),
      version: z.number().int().min(1).describe('The version published.'),
      contactIds: z.array(z.uuid()).min(1).max(10).describe('The invited supplier contacts.'),
      partNumber: z.string().describe('A line part number, which the notification must not carry.'),
      description: z.string().describe('A line description, which the notification must not carry.'),
      unitPrice: z.string().describe('A quoted price, which the notification must not carry.'),
      refuseAfterRecording: z.boolean().default(false).describe('Refuses after recording, rolling back.'),
    })
    .describe('The amendment.'),
  output: z
    .object({ notificationIds: z.array(z.uuid()).describe('The recorded notifications.') })
    .describe('The notifications.'),
  errors: [errorCode('Conflict', 'transitionNotAllowed')],
  access: { person: ['buyer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

@Injectable()
export class AmendRfqHandler implements CommandHandler<typeof amendRfq> {
  async execute(input: InputOf<typeof amendRfq>, context: CommandContext): Promise<HandlerResult<typeof amendRfq>> {
    const notificationIds: string[] = [];
    for (const contactId of input.contactIds) {
      const notificationId = await recordNotification(
        context,
        rfqAmendedTemplate,
        { kind: 'supplierContact', id: contactId },
        { rfqId: input.rfqId, version: input.version },
      );
      if (notificationId !== null) {
        notificationIds.push(notificationId);
      }
    }
    if (input.refuseAfterRecording) {
      return refuse('Conflict', 'transitionNotAllowed');
    }
    return success({ notificationIds });
  }
}

export const flagExpiringEvidence = defineCommand({
  name: 'notificationsTest.flagExpiringEvidence',
  description: 'Stands in for the evidence expiry check: tells a person in the staff shell.',
  purpose: 'business',
  input: z
    .object({
      evidenceId: z.uuid().describe('The evidence.'),
      daysLeft: z.number().int().min(0).describe('Days until it expires.'),
      personId: z.uuid().describe('Who to tell.'),
    })
    .describe('The evidence and the person.'),
  output: z.object({ notificationId: z.uuid().describe('The in-app notification.') }).describe('The notification.'),
  errors: [errorCode('Conflict', 'alreadyExists')],
  access: { person: ['quality_engineer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

@Injectable()
export class FlagExpiringEvidenceHandler implements CommandHandler<typeof flagExpiringEvidence> {
  async execute(
    input: InputOf<typeof flagExpiringEvidence>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof flagExpiringEvidence>> {
    const notificationId = await recordNotification(
      context,
      evidenceExpiringTemplate,
      { kind: 'person', id: input.personId },
      { evidenceId: input.evidenceId, daysLeft: input.daysLeft },
    );
    return notificationId === null ? refuse('Conflict', 'alreadyExists') : success({ notificationId });
  }
}

export const notificationsTestRegistry: OperationRegistry = {
  commands: [
    ...productionRegistry.commands,
    registerCommand(amendRfq, AmendRfqHandler),
    registerCommand(flagExpiringEvidence, FlagExpiringEvidenceHandler),
  ],
  queries: productionRegistry.queries,
};

/** Supplier contacts, until U10 stores them: their addresses by id, beside the shipped directory. */
export function testRecipientDirectory(contacts: ReadonlyMap<string, string>): RecipientDirectory {
  return {
    emailAddressOf(database, recipient) {
      if (recipient.kind === 'supplierContact') {
        return Promise.resolve(contacts.get(recipient.id) ?? null);
      }
      return storedRecipientDirectory.emailAddressOf(database, recipient);
    },
  };
}

/**
 * The local adapter, counting every attempt and failing the ones the test asks it to: every
 * send to an address in `failingAddresses`, or an adapter that throws for one in `throwingAddresses`.
 */
export class ObservedEmailPort implements EmailPort {
  readonly attempts: EmailMessage[] = [];
  readonly failingAddresses = new Set<string>();
  readonly throwingAddresses = new Set<string>();
  /** Holds each send open, to overlap two runs of the same job. */
  delayMilliseconds = 0;
  private readonly local: LocalEmailAdapter;

  constructor(readonly inboxDirectory: string) {
    this.local = new LocalEmailAdapter(inboxDirectory, 'notifications@partledger.invalid');
  }

  async send(message: EmailMessage): Promise<Result<void, EmailUnavailable>> {
    this.attempts.push(message);
    if (this.delayMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMilliseconds));
    }
    if (this.throwingAddresses.has(message.to)) {
      throw new Error(`Synthetic transport failure for ${message.to}`);
    }
    if (this.failingAddresses.has(message.to)) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    return this.local.send(message);
  }

  attemptsFor(notificationId: string): number {
    return this.attempts.filter((message) => message.idempotencyKey === notificationId).length;
  }
}
