import { definePermissions } from './matrix';

const supplierMaintenance = {
  kind: 'command',
  allow: ['buyer', 'quality_engineer'],
  purpose: 'business',
  impact: 'standard',
  stepUp: false,
} as const;

/**
 * Suppliers (U10): buyers and quality engineers maintain suppliers and contacts and ask for
 * identity checks; only a quality engineer changes the approved-supplier list (R9). Every staff
 * role but the administrator reads them.
 */
export default definePermissions({
  'suppliers.create': supplierMaintenance,
  'suppliers.update': supplierMaintenance,
  'suppliers.setStatus': supplierMaintenance,
  'suppliers.addContact': supplierMaintenance,
  'suppliers.removeContact': supplierMaintenance,
  'suppliers.checkIdentity': supplierMaintenance,
  'suppliers.setApproval': {
    kind: 'command',
    allow: ['quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'suppliers.list': { kind: 'query', allow: ['buyer', 'quality_engineer', 'approver', 'auditor'] },
  'suppliers.detail': { kind: 'query', allow: ['buyer', 'quality_engineer', 'approver', 'auditor'] },
});
