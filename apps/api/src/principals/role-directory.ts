import type { TenantRole } from '@partledger/contracts';

import type { AppDatabase } from '../db/tenant-transaction';

export interface PersonInTenant {
  readonly tenantId: string;
  readonly userId: string;
}

/**
 * Where a person's tenant roles come from. It is read inside the request's tenant
 * transaction on every request (KTD20), so a revoked role takes effect on the next request.
 * Production reads the tenant's membership rows (`tenants/membership-directory.ts`).
 */
export interface RoleDirectory {
  rolesOf(person: PersonInTenant, database: AppDatabase): Promise<readonly TenantRole[]>;
  /** Whether the person is a current member of the tenant; a sign-in is refused otherwise. */
  isActiveMember(person: PersonInTenant, database: AppDatabase): Promise<boolean>;
}

export const roleDirectory = Symbol('RoleDirectory');
