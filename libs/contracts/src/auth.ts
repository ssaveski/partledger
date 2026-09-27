import { z } from 'zod';

import { apiBasePath } from './define';

/**
 * Staff sign-in (KTD20). The API completes the OpenID Connect code flow and keeps every token
 * server-side; the browser holds only an HttpOnly session cookie it cannot read, so it learns
 * about its session through `session` and changes it only through these endpoints.
 */
export const staffAuthPaths = {
  /** GET, a top-level navigation: starts the sign-in and redirects to the identity provider. */
  signIn: `${apiBasePath}/auth/sign-in`,
  /** GET, reached only by the identity provider's redirect. */
  callback: `${apiBasePath}/auth/callback`,
  /** GET: the current session, or the uniform 401. */
  session: `${apiBasePath}/auth/session`,
  /** POST, with the request header below: ends the session. */
  signOut: `${apiBasePath}/auth/sign-out`,
  /**
   * GET, a top-level navigation with a session: re-authenticates at the step-up level (KTD20)
   * and returns to `returnTo`, with the parameter below when the step-up did not complete.
   */
  stepUp: `${apiBasePath}/auth/step-up`,
} as const;

/**
 * Every state-changing request on the staff listener carries this header. A cross-site form
 * cannot set a header, and a cross-site script cannot send one without a CORS preflight that
 * the API never grants, so its presence shows that the request came from the staff app itself.
 */
export const staffRequestHeader = { name: 'x-partledger-request', value: 'staff-app' } as const;

/** Where to return after sign-in: a path on the staff app's own origin, never another origin. */
export const returnToSchema = z
  .string()
  .max(2048)
  .regex(/^\/(?![/\\])[^\\\s]*$/)
  .describe('A path on the staff app, such as /rfqs; never an absolute or protocol-relative URL.');

export const signInQuerySchema = z.object({ returnTo: returnToSchema.optional() }).describe('Starts a staff sign-in.');

export const stepUpQuerySchema = z
  .object({ returnTo: returnToSchema.optional() })
  .describe('Starts a step-up re-authentication for the current session.');

/** The query parameter the API adds to the return path when a step-up did not complete. */
export const stepUpFailedParameter = { name: 'stepUp', value: 'failed' } as const;

/** The query parameter the API adds to the staff app's URL when a sign-in did not complete. */
export const signInFailedParameter = { name: 'signIn', value: 'failed' } as const;

export const staffSessionSchema = z
  .object({
    userId: z.uuid().describe("The identity provider's id for the signed-in person."),
    tenantId: z.uuid().describe('The tenant the session acts in, from its one organization.'),
    expiresAt: z.iso.datetime({ offset: true }).describe('When the session ends regardless of activity.'),
    idleExpiresAt: z.iso.datetime({ offset: true }).describe('When the session ends if no request arrives first.'),
  })
  .strict()
  .describe('The signed-in staff session; it carries no token and no personal data.');

export type StaffSession = z.infer<typeof staffSessionSchema>;
