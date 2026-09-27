import { definePermissions } from './matrix';

/** Staff authentication (U29): only a tenant admin, with a fresh step-up, resets a second factor. */
export default definePermissions({
  'auth.resetSecondFactor': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'second_factor_reset',
    stepUp: true,
  },
});
