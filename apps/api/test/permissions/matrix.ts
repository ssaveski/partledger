import { tenantRoles, type CommandImpact, type CommandPurpose, type TenantRole } from '@partledger/contracts';

import type { Principal } from '../../src/principals/principal';

/**
 * The principals every command and query is checked against (KTD38): a person holding each
 * single tenant role, a person holding none, and each non-person principal type, with a
 * system principal once as a background job and once as an ERP drop credential.
 */
export const matrixPrincipals = [
  ...tenantRoles,
  'person_without_roles',
  'supplier_token',
  'system_job',
  'system_drop_credential',
  'ai_agent',
  'platform_operator',
] as const;

export type MatrixPrincipal = (typeof matrixPrincipals)[number];

/**
 * A command's reviewed expectation. Besides who may call it, it pins the properties the
 * declaration's author could otherwise set to dodge the registry rules: its purpose (the
 * tenant-admin rule), its KTD20 impact and its step-up flag.
 */
export interface CommandExpectation {
  readonly kind: 'command';
  readonly allow: readonly MatrixPrincipal[];
  readonly purpose: CommandPurpose;
  readonly impact: CommandImpact;
  readonly stepUp: boolean;
}

export interface QueryExpectation {
  readonly kind: 'query';
  readonly allow: readonly MatrixPrincipal[];
}

/** Per module: each operation name with its expectation; every principal not allowed is denied. */
export type ModulePermissions = Readonly<Record<string, CommandExpectation | QueryExpectation>>;

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
    case 'system_job':
      return { ...base, type: 'system', actedUnder: { grant: 'job', jobId: actorId }, adapter: 'jobs' };
    case 'system_drop_credential':
      return {
        ...base,
        type: 'system',
        actedUnder: { grant: 'drop_credential', credentialId },
        adapter: 'drop',
      };
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
