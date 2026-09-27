import { definePermissions } from './matrix';

/** Notifications (U34): every staff role reads the shell's alerts; tenant admins configure alert recipients. */
export default definePermissions({
  'notifications.alerts': {
    kind: 'query',
    allow: ['tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'],
  },
  'notifications.addAlertRecipient': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'standard',
    stepUp: false,
  },
  'notifications.removeAlertRecipient': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'standard',
    stepUp: false,
  },
});
