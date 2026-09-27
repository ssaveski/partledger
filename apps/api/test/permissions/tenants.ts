import { definePermissions } from './matrix';

/**
 * Members and roles (U8): administration only, for tenant administrators only. Role grants and
 * revocations are KTD20 high-impact commands and demand a recent step-up.
 */
export default definePermissions({
  'members.invite': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'standard',
    stepUp: false,
  },
  'members.remove': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'standard',
    stepUp: false,
  },
  'members.grantRole': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'role_change',
    stepUp: true,
  },
  'members.revokeRole': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'role_change',
    stepUp: true,
  },
  'members.list': { kind: 'query', allow: ['tenant_admin'] },
  'tenants.currentMember': {
    kind: 'query',
    allow: ['tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'],
  },
});
