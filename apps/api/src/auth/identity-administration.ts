import type { Result } from '@partledger/domain';

/**
 * What the API changes in the staff identity provider through its admin API (KTD20), a port
 * with Keycloak as its adapter. The API's service account may manage users; it cannot change
 * the realm. U8 adds organization membership here.
 */
export interface IdentityAdministration {
  /** The tenants the user belongs to through their organizations; empty for an unknown user. */
  tenantsOf(userId: string): Promise<Result<readonly string[], 'unavailable'>>;
  /**
   * Removes every one-time-code credential of the user and ends all their identity-provider
   * sessions, so their next step-up enrols a new second factor. Repeating it is harmless.
   */
  resetSecondFactor(userId: string): Promise<Result<{ readonly removedFactors: number }, 'unavailable'>>;
}

export const identityAdministration = Symbol('IdentityAdministration');
