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
   * Makes a person a member of one organization, and of no other; returns the user id and
   * whether the account was created now. An account that already exists is adopted when it
   * belongs to no organization or already to this one, such as a removed member invited again
   * or an invitation retried after a failure; one that belongs to another organization is
   * refused, since a person in two organizations could never sign in.
   */
  createMember(
    organizationId: string,
    person: NewPerson,
  ): Promise<Result<{ readonly userId: string; readonly created: boolean }, OrganizationRefusal>>;
  /** The organization with this alias, and the tenant its attribute names, if there is one. */
  findOrganization(
    alias: string,
  ): Promise<Result<{ readonly id: string; readonly tenantId: string | null } | null, 'unavailable'>>;
  /** Removes an organization left behind by a provisioning that never committed, with its members' accounts. */
  deleteOrganizationAndMembers(organizationId: string): Promise<Result<void, 'unavailable'>>;
  /** Removes an account whose membership was never committed. */
  deleteUser(userId: string): Promise<void>;
  /** Removes a member from the organization and ends their identity provider sessions. */
  removeMember(organizationId: string, userId: string): Promise<Result<void, 'unavailable'>>;
}

export const identityOrganizations = Symbol('IdentityOrganizations');
