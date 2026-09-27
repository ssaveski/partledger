import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { returnToSchema } from '@partledger/contracts';
import { z } from 'zod';

import type { TokenCipher } from './token-cipher';

/**
 * The state of one sign-in between the redirect to the identity provider and its callback:
 * the OAuth `state`, the OpenID `nonce`, the PKCE code verifier and where to return. It lives
 * in an encrypted cookie, since no tenant is known before the callback, and it is used once.
 */
export interface SignInState {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly startedAt: number;
  /**
   * Set when this is a step-up of an existing session (KTD20). The callback cannot read the
   * SameSite=Strict session cookie on the identity provider's cross-site redirect, so the
   * session it steps up travels here, sealed, from the step-up request that carried it.
   */
  readonly stepUpOf?: SteppedUpSession;
}

export interface SteppedUpSession {
  readonly tenantId: string;
  readonly credentialId: string;
}

export const signInStateLifetimeSeconds = 600;

const associatedData = 'partledger/staff-sign-in/v1';

const signInStateSchema = z.object({
  state: z.string().min(43),
  nonce: z.string().min(43),
  codeVerifier: z.string().min(43),
  returnTo: returnToSchema,
  startedAt: z.number().int(),
  stepUpOf: z.object({ tenantId: z.uuid(), credentialId: z.uuid() }).strict().optional(),
});

function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

export function newSignInState(returnTo: string, now: Date, stepUpOf?: SteppedUpSession): SignInState {
  const signIn = {
    state: randomValue(),
    nonce: randomValue(),
    codeVerifier: randomValue(),
    returnTo,
    startedAt: now.getTime(),
  };
  return stepUpOf === undefined ? signIn : { ...signIn, stepUpOf };
}

/** RFC 7636 S256. */
export function codeChallengeOf(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

export function sealSignInState(cipher: TokenCipher, signIn: SignInState): string {
  return cipher.encrypt(JSON.stringify(signIn), associatedData).toString('base64url');
}

/**
 * Opens the cookie and checks it against the callback's `state`; `null` when the cookie is
 * missing, tampered with, expired or for another sign-in.
 */
export function openSignInState(
  cipher: TokenCipher,
  sealed: string | undefined,
  returnedState: string | undefined,
  now: Date,
): SignInState | null {
  if (sealed === undefined || returnedState === undefined || !/^[A-Za-z0-9_-]+$/.test(sealed)) {
    return null;
  }
  const plaintext = cipher.decrypt(Buffer.from(sealed, 'base64url'), associatedData);
  if (plaintext === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const signIn = signInStateSchema.safeParse(parsed);
  if (!signIn.success) {
    return null;
  }
  const age = now.getTime() - signIn.data.startedAt;
  if (age < 0 || age > signInStateLifetimeSeconds * 1000) {
    return null;
  }
  const expected = Buffer.from(signIn.data.state, 'utf8');
  const returned = Buffer.from(returnedState, 'utf8');
  if (expected.length !== returned.length || !timingSafeEqual(expected, returned)) {
    return null;
  }
  return signIn.data;
}
