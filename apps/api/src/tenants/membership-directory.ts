import type { RoleDirectory } from '../principals/role-directory';
import { membershipStore } from './membership-store';

/**
 * Roles from the tenant's rows (R3, KTD20), read in the request's own tenant transaction on
 * every request: a revoked role or a removed membership applies to the very next request.
 */
export const membershipDirectory: RoleDirectory = {
  rolesOf: (person, database) => membershipStore.activeRoles(database, person.tenantId, person.userId),
  async isActiveMember(person, database) {
    return (await membershipStore.findActive(database, person.tenantId, person.userId)) !== undefined;
  },
};
