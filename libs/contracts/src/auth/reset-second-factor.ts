import { z } from 'zod';

import { defineCommand } from '../define';
import { errorCode } from '../errors';

/**
 * A lost second factor is reset only by this audited tenant-admin command (KTD20): it ends the
 * user's sessions at once and has a job remove the user's Keycloak-held one-time-code
 * credentials and Keycloak sessions, so the next step-up enrols a new factor. Forgot-password
 * never touches a second factor.
 */
export const resetSecondFactor = defineCommand({
  name: 'auth.resetSecondFactor',
  description:
    "Removes a staff user's second factor and ends their sessions; they enrol a new one at their next step-up.",
  purpose: 'administration',
  input: z
    .object({
      userId: z.uuid().describe("The identity provider's id for the staff user whose second factor is reset."),
    })
    .describe('The user whose second factor is reset.'),
  output: z
    .object({
      userId: z.uuid().describe('The user whose second factor was reset.'),
      endedSessions: z.number().int().min(0).describe("How many of the user's staff sessions were ended."),
    })
    .describe('The reset.'),
  errors: [
    errorCode('NotFound', 'resource'),
    errorCode('Forbidden', 'notPermitted'),
    errorCode('Unavailable', 'dependencyUnavailable'),
  ],
  access: { person: ['tenant_admin'] },
  stepUp: true,
  impact: 'second_factor_reset',
  idempotencyKey: 'required',
  expectedVersion: false,
});
