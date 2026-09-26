import { tenantRoles, type TenantRole } from '@partledger/contracts';

import type { Principal } from '../../src/principals/principal';

/**
 * The principals every command and query is checked against (KTD38): a person holding each
 * single tenant role, a person holding none, and each non-person principal type.
 */
export const matrixPrincipals = [
  ...tenantRoles,
  'person_without_roles',
  'supplier_token',
  'system',
  'ai_agent',
  'platform_operator',
] as const;

export type MatrixPrincipal = (typeof matrixPrincipals)[number];

/** Per module: each operation name with the principals allowed to call it; every other principal is denied. */
export type ModulePermissions = Readonly<Record<string, readonly MatrixPrincipal[]>>;

export function definePermissions(permissions: ModulePermissions): ModulePermissions {
  return permissions;
}

const tenantId = '7d0f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01';
const correlationId = '2c9a7e14-8f6b-4d2a-b5c3-9e1f0a7d6b02';
const credentialId = '5e3b9c2d-1a4f-4e8b-8c7d-3f2a1b0c9d03';
const actorId = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c04';

function isTenantRole(principal: MatrixPrincipal): principal is TenantRole {
  const roles: readonly string[] = tenantRoles;
  return roles.includes(principal);
}

export function principalFor(principal: MatrixPrincipal): Principal {
  const base = { tenantId, correlationId };
  if (isTenantRole(principal) || principal === 'person_without_roles') {
    return {
      ...base,
      type: 'person',
      userId: actorId,
      roles: isTenantRole(principal) ? [principal] : [],
      stepUp: null,
      actedUnder: { grant: 'staff_session', credentialId },
      adapter: 'staff',
    };
  }
  switch (principal) {
    case 'supplier_token':
      return {
        ...base,
        type: 'supplier_token',
        supplierId: actorId,
        actedUnder: { grant: 'supplier_link', credentialId },
        adapter: 'portal',
      };
    case 'system':
      return { ...base, type: 'system', actedUnder: { grant: 'job', jobId: actorId }, adapter: 'jobs' };
    case 'ai_agent':
      return {
        ...base,
        type: 'ai_agent',
        agentId: actorId,
        actedUnder: { grant: 'job', jobId: actorId },
        adapter: 'jobs',
      };
    case 'platform_operator':
      return {
        ...base,
        type: 'platform_operator',
        operatorId: actorId,
        actedUnder: { grant: 'platform_operator', credentialId },
        adapter: 'operator',
      };
  }
}
