import type { TenantRole } from '@partledger/contracts';

import type { AppDatabase } from '../db/tenant-transaction';

/**
 * Where a person's tenant roles come from. It is read inside the request's tenant
 * transaction on every request (KTD20), so a revoked role takes effect on the next request.
 */
export interface RoleDirectory {
  rolesOf(
    person: { readonly tenantId: string; readonly userId: string },
    database: AppDatabase,
  ): Promise<readonly TenantRole[]>;
}

export const roleDirectory = Symbol('RoleDirectory');

/**
 * Until memberships exist, nobody holds a role, so every role-gated operation is refused.
 * U8 replaces this with a lookup in the tenant's membership rows.
 */
export const noRoleAssignments: RoleDirectory = {
  rolesOf() {
    return Promise.resolve([]);
  },
};
