import {
  commandPath,
  errorBodySchema,
  idempotencyKeyHeader,
  returnToSchema,
  staffAuthPaths,
  stepUpFailedParameter,
} from '@partledger/contracts';
import { z } from 'zod';

import { stateChangingRequestHeaders, type Fetcher } from './session';

/**
 * Step-up in the staff app (KTD20). A command marked step-up that meets a stale or missing
 * step-up is refused with the typed `StepUpRequired` error; the app then keeps the command in
 * the tab's session storage, leaves for the API's step-up (which re-authenticates with
 * `acr_values` at the step-up level and comes back), and retries the command once with the
 * same idempotency key, so the action happens once however often the person is asked.
 */

/** A command waiting for a step-up; it stays in this tab only and only for as long as a step-up may take. */
const pendingCommandSchema = z
  .object({
    name: z.string().min(1),
    body: z.unknown(),
    idempotencyKey: z.string().min(16),
    savedAt: z.number().int(),
  })
  .strict();

export type PendingCommand = z.infer<typeof pendingCommandSchema>;

/** The API's sign-in state lasts ten minutes; a pending command older than that is dropped, never replayed. */
export const pendingCommandLifetimeMilliseconds = 10 * 60 * 1000;

export const pendingCommandStorageKey = 'partledger.stepUp.pendingCommand';

export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type Navigation = Pick<Location, 'assign' | 'pathname' | 'search' | 'hash'>;

export interface CommandRequest {
  readonly name: string;
  readonly body: unknown;
  /** Chosen once per user action and reused by every retry of it. */
  readonly idempotencyKey: string;
}

export type CommandOutcome =
  | { readonly kind: 'answered'; readonly status: number; readonly body: unknown }
  /** The page is leaving for the step-up; the command runs again when it returns. */
  | { readonly kind: 'steppingUp' }
  | { readonly kind: 'stepUpFailed'; readonly messageKey: 'pl.auth.stepUpFailed' }
  | { readonly kind: 'unavailable'; readonly messageKey: 'pl.auth.sessionUnavailable' };

export interface StepUpEnvironment {
  readonly fetcher?: Fetcher;
  readonly storage: PendingStorage;
  readonly location: Navigation;
  readonly now?: () => number;
}

const stepUpFailed: CommandOutcome = { kind: 'stepUpFailed', messageKey: 'pl.auth.stepUpFailed' };
const unavailable: CommandOutcome = { kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' };

/** The API URL that starts a step-up and returns to `returnTo`, a path on this app. */
export function stepUpUrl(returnTo: string): string {
  const parsed = returnToSchema.safeParse(returnTo);
  const path = parsed.success ? parsed.data : '/';
  return `${staffAuthPaths.stepUp}?${new URLSearchParams({ returnTo: path }).toString()}`;
}

/** Whether an answer is the typed step-up error rather than the uniform 401 of a refused session. */
export function isStepUpRequired(status: number, body: unknown): boolean {
  const error = errorBodySchema.safeParse(body);
  return status === 401 && error.success && error.data.error === 'StepUpRequired';
}

async function post(fetcher: Fetcher, command: CommandRequest): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetcher(commandPath(command.name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...stateChangingRequestHeaders,
        'content-type': 'application/json',
        [idempotencyKeyHeader]: command.idempotencyKey,
      },
      body: JSON.stringify(command.body),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/**
 * Sends a command. When it needs a step-up, keeps it and leaves for the step-up, returning
 * `steppingUp`; `resumeAfterStepUp` sends it again when the page comes back.
 */
export async function sendCommand(command: CommandRequest, environment: StepUpEnvironment): Promise<CommandOutcome> {
  const answer = await post(environment.fetcher ?? fetch, command);
  if (answer === null) {
    return unavailable;
  }
  if (!isStepUpRequired(answer.status, answer.body)) {
    return { kind: 'answered', ...answer };
  }
  const { location } = environment;
  const pending: PendingCommand = {
    name: command.name,
    body: command.body,
    idempotencyKey: command.idempotencyKey,
    savedAt: (environment.now ?? Date.now)(),
  };
  try {
    environment.storage.setItem(pendingCommandStorageKey, JSON.stringify(pending));
  } catch {
    // Without storage the command cannot survive the redirect; the person repeats it after the step-up.
  }
  location.assign(stepUpUrl(`${location.pathname}${withoutStepUpParameter(location.search)}${location.hash}`));
  return { kind: 'steppingUp' };
}

/**
 * Called when a page loads: sends the command that was waiting for a step-up, once, with its
 * idempotency key. `null` when nothing was waiting. A step-up that did not complete, a
 * pending command that is too old, or a second step-up error ends the attempt with a
 * translated message instead of another redirect.
 */
export async function resumeAfterStepUp(environment: StepUpEnvironment): Promise<CommandOutcome | null> {
  const pending = takePendingCommand(environment.storage);
  if (pending === null) {
    return null;
  }
  const age = (environment.now ?? Date.now)() - pending.savedAt;
  const failed =
    new URLSearchParams(environment.location.search).get(stepUpFailedParameter.name) === stepUpFailedParameter.value;
  if (failed || age < 0 || age > pendingCommandLifetimeMilliseconds) {
    return stepUpFailed;
  }
  const answer = await post(environment.fetcher ?? fetch, pending);
  if (answer === null) {
    return unavailable;
  }
  return isStepUpRequired(answer.status, answer.body) ? stepUpFailed : { kind: 'answered', ...answer };
}

function takePendingCommand(storage: PendingStorage): PendingCommand | null {
  let stored: string | null;
  try {
    stored = storage.getItem(pendingCommandStorageKey);
    storage.removeItem(pendingCommandStorageKey);
  } catch {
    return null;
  }
  if (stored === null) {
    return null;
  }
  try {
    const pending = pendingCommandSchema.safeParse(JSON.parse(stored));
    return pending.success ? pending.data : null;
  } catch {
    return null;
  }
}

function withoutStepUpParameter(search: string): string {
  const parameters = new URLSearchParams(search);
  parameters.delete(stepUpFailedParameter.name);
  const rest = parameters.toString();
  return rest === '' ? '' : `?${rest}`;
}
