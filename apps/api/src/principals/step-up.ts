import type { Principal } from './principal';

/**
 * What a command marked `stepUp` demands (KTD20): the session's latest authentication at the
 * configured `acr`, with an `auth_time` inside the freshness window.
 */
export interface StepUpPolicy {
  readonly level: string;
  readonly freshnessMilliseconds: number;
}

export const stepUpPolicy = Symbol('StepUpPolicy');

/** The identity provider's clock may run slightly ahead of ours; the same tolerance as token validation. */
const clockToleranceMilliseconds = 5000;

export function hasRecentStepUp(principal: Principal, now: Date, policy: StepUpPolicy): boolean {
  if (principal.type !== 'person' || principal.stepUp === null || principal.stepUp.level !== policy.level) {
    return false;
  }
  const age = now.getTime() - principal.stepUp.authenticatedAt.getTime();
  return age >= -clockToleranceMilliseconds && age <= policy.freshnessMilliseconds;
}
