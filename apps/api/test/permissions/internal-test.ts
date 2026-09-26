import { definePermissions } from './matrix';

/** The test-only module's expected access; business modules add their own file beside this one. */
export default definePermissions({
  'internalTest.createNote': ['buyer', 'quality_engineer', 'supplier_token', 'system'],
  'internalTest.createNoteThenRefuse': ['buyer'],
  'internalTest.renameNote': ['buyer', 'quality_engineer'],
  'internalTest.approveNote': ['approver'],
  'internalTest.setRetention': ['tenant_admin'],
  'internalTest.getNote': ['buyer', 'quality_engineer', 'approver', 'auditor', 'platform_operator'],
  'internalTest.touchNoteInQuery': ['buyer'],
});
