import { errorBodySchema, internalErrorMessageKey } from '@partledger/contracts';

import {
  resumeAfterStepUp,
  sendCommand,
  stepUpUrl,
  type CommandOutcome,
  type CommandRequest,
  type StepUpEnvironment,
} from '../../auth/step-up';

export type { CommandRequest };

/**
 * Member and role changes demand a recent step-up (KTD20). A refused change offers U29's
 * step-up: the change waits in this tab, the person confirms their identity and comes back to
 * the members screen, which then makes the change once, with the same idempotency key.
 */

/** How a refusal for step-up is offered: replaying the one refused command, or confirming and saving again. */
export type StepUpOffer =
  { readonly kind: 'replay'; readonly command: CommandRequest } | { readonly kind: 'thenSaveAgain' };

export type ResumedChange = { readonly kind: 'done' } | { readonly kind: 'failed'; readonly messageKey: string };

/** What a change that waited for a step-up came to; `null` when nothing was waiting. */
export function resumedChangeOf(outcome: CommandOutcome | null): ResumedChange | null {
  if (outcome === null || outcome.kind === 'steppingUp') {
    return null;
  }
  if (outcome.kind !== 'answered') {
    return { kind: 'failed', messageKey: outcome.messageKey };
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return { kind: 'done' };
  }
  const refusal = errorBodySchema.safeParse(outcome.body);
  return { kind: 'failed', messageKey: refusal.success ? refusal.data.message : internalErrorMessageKey };
}

function browserEnvironment(): StepUpEnvironment | null {
  try {
    return { storage: window.sessionStorage, location: window.location };
  } catch {
    return null;
  }
}

/**
 * Leaves for the step-up with the refused change: `null` while the page leaves, otherwise the
 * message key of why it could not. A change that goes through at once (the person stepped up
 * meanwhile) reloads the page to show it.
 */
export async function confirmIdentityThenRetry(command: CommandRequest): Promise<string | null> {
  const environment = browserEnvironment();
  if (environment === null) {
    return 'pl.auth.stepUpFailed';
  }
  const outcome = await sendCommand(command, environment);
  const resumed = resumedChangeOf(outcome);
  if (resumed === null) {
    return null;
  }
  if (resumed.kind === 'done') {
    window.location.reload();
    return null;
  }
  return resumed.messageKey;
}

export async function resumeCommandAfterStepUp(): Promise<ResumedChange | null> {
  const environment = browserEnvironment();
  return environment === null ? null : resumedChangeOf(await resumeAfterStepUp(environment));
}

/** Leaves for the step-up and comes back to this page with nothing kept to replay. */
export function confirmIdentityThenReturn(): void {
  window.location.assign(stepUpUrl(`${window.location.pathname}${window.location.hash}`));
}
