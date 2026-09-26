import type { AccessRule, TenantRole } from '@partledger/contracts';

import type { Principal } from './principal';

/**
 * Whether a principal may call an operation at all (R3). Roles are additive: a person needs
 * any one of the listed roles. Finer checks (which supplier's lines, which grant's tenant)
 * belong to the handler.
 */
export function isAllowed(access: AccessRule, principal: Principal): boolean {
  switch (principal.type) {
    case 'person': {
      const allowedRoles: readonly TenantRole[] = access.person ?? [];
      return principal.roles.some((role) => allowedRoles.includes(role));
    }
    case 'supplier_token':
      return access.supplier_token === true;
    case 'ai_agent':
      return access.ai_agent === true;
    case 'system':
      return access.system === true;
    case 'platform_operator':
      return access.platform_operator === true;
  }
}
