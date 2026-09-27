import { definePermissions } from './matrix';

/** The test-only module's expected access; business modules add their own file beside this one. */
export default definePermissions({
  'internalTest.createNote': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer', 'supplier_token', 'system_drop_credential'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'internalTest.createNoteThenRefuse': {
    kind: 'command',
    allow: ['buyer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'internalTest.renameNote': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'internalTest.approveNote': {
    kind: 'command',
    allow: ['approver'],
    purpose: 'business',
    impact: 'approval',
    stepUp: true,
  },
  'internalTest.setRetention': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'standard',
    stepUp: false,
  },
  'internalTest.recordJobRun': {
    kind: 'command',
    allow: ['system_job'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'internalTest.getNote': {
    kind: 'query',
    allow: ['buyer', 'quality_engineer', 'approver', 'auditor', 'platform_operator'],
  },
  'internalTest.touchNoteInQuery': { kind: 'query', allow: ['buyer'] },
});
