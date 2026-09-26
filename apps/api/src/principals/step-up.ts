import type { Principal } from './principal';

/**
 * How recent a step-up must be for a command marked `stepUp` (KTD20). U29 sets the level from
 * the configured `acr` and fills `PersonPrincipal.stepUp` from the session; until then no
 * principal carries a step-up, so every step-up command is refused.
 */
export const stepUpFreshnessMilliseconds = 5 * 60 * 1000;

export function hasRecentStepUp(principal: Principal, now: Date): boolean {
  if (principal.type !== 'person' || principal.stepUp === null) {
    return false;
  }
  const age = now.getTime() - principal.stepUp.authenticatedAt.getTime();
  return age >= 0 && age <= stepUpFreshnessMilliseconds;
}
