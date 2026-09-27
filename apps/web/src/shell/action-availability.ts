import type { ErrorParams, MessageParams } from '@partledger/contracts';

import { messageParams } from './format';

/** A transition a read reports on (R32): allowed now, or blocked with a message key. */
export interface TransitionRead<Transition extends string> {
  readonly allowedTransitions: readonly Transition[];
  readonly blockingReasons: readonly {
    readonly transition: Transition;
    readonly message: string;
    readonly params: ErrorParams;
  }[];
}

export type ActionAvailability =
  | { readonly kind: 'available' }
  /** The server said no, with its reason. */
  | { readonly kind: 'blocked'; readonly messageKey: string; readonly params: MessageParams }
  /** The server allows it, but the command does not exist yet, so only the fixture preview performs it. */
  | { readonly kind: 'notYetAvailable'; readonly messageKey: string }
  /** Neither allowed nor explained, so the action is not offered. */
  | { readonly kind: 'hidden' };

/**
 * Whether a screen offers an action, from what the read says and whether a preview write exists.
 * The screen never re-derives the lifecycle; it shows the server's reason when blocked.
 */
export function actionAvailability<Transition extends string>(
  read: TransitionRead<Transition>,
  transition: Transition,
  canWrite: boolean,
  notYetAvailableKey: string,
): ActionAvailability {
  if (!read.allowedTransitions.includes(transition)) {
    const reason = read.blockingReasons.find((blocking) => blocking.transition === transition);
    return reason === undefined
      ? { kind: 'hidden' }
      : { kind: 'blocked', messageKey: reason.message, params: messageParams(reason.params) };
  }
  return canWrite ? { kind: 'available' } : { kind: 'notYetAvailable', messageKey: notYetAvailableKey };
}
