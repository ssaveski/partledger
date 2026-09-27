import type { Result } from '@partledger/domain';

/**
 * The identity provider's organizations (KTD20), a port with Keycloak as its adapter. A tenant
 * is one organization whose `tenant_id` attribute names it, and a member is a user in that
 * organization and no other. The identity provider knows who belongs to a tenant; what they may
 * do is decided by the tenant's role rows, never by the identity provider.
 */
export type OrganizationRefusal = 'already_exists' | 'unavailable';

export interface NewPerson {
  readonly email: string;
  readonly displayName: string;
}

export interface IdentityOrganizations {
  /** Creates the tenant's organization; returns its id. */
  createOrganization(organization: {
    readonly alias: string;
    readonly name: string;
    readonly tenantId: string;
  }): Promise<Result<string, OrganizationRefusal>>;
  /** Removes an organization whose tenant was never committed. */
  deleteOrganization(organizationId: string): Promise<void>;
  /**
   * Creates a person's account as a member of one organization, and of no other; returns the
   * user id. An email that already has an account is refused, so a person never ends up in two
   * tenants' organizations, where every sign-in would be refused.
   */
  createMember(organizationId: string, person: NewPerson): Promise<Result<string, OrganizationRefusal>>;
  /** Removes an account whose membership was never committed. */
  deleteUser(userId: string): Promise<void>;
  /** Removes a member from the organization and ends their identity provider sessions. */
  removeMember(organizationId: string, userId: string): Promise<Result<void, 'unavailable'>>;
}

export const identityOrganizations = Symbol('IdentityOrganizations');
