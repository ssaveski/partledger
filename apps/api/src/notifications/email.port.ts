import type { DomainErrorOf, Result } from '@partledger/domain';

/**
 * The email port (KTD33, KTD36). Callers hand it a rendered message; an adapter delivers it.
 * The local adapter writes to a dev inbox; the production provider, which processes in the
 * tenant's region, arrives with U24 and needs no change to any caller.
 */
export interface EmailMessage {
  /** The recipient's address, resolved at send time and never stored with the notification. */
  readonly to: string;
  readonly subject: string;
  /** Plain text built from message keys; links only, never RFQ content. */
  readonly text: string;
  /**
   * The notification id. A provider that is sent the same key twice, as after a crash between
   * the send and the commit, delivers the message once.
   */
  readonly idempotencyKey: string;
}

export type EmailUnavailable = DomainErrorOf<{ readonly tag: 'Unavailable'; readonly reason: 'dependencyUnavailable' }>;

export interface EmailPort {
  /** Resolves with a failure, never throws, when the message was not accepted for delivery. */
  send(message: EmailMessage): Promise<Result<void, EmailUnavailable>>;
}

export const emailPort = Symbol('EmailPort');
