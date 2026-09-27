import type { PresentedCredential } from '@partledger/db';

import { formatCredentialToken, parseCredentialToken } from '../principals/credential-token';

/**
 * The staff session cookie (KTD20). `__Host-` pins it to the staff app's origin with `Path=/`
 * and no `Domain`, so no sibling host can set or read it; HttpOnly keeps it from scripts;
 * SameSite=Strict keeps it off cross-site requests. Its value is the `staff_session`
 * credential, `pls_<id>_<secret>`, resolved through `resolve_credential`.
 */
export const sessionCookieName = '__Host-pl_session';

/**
 * The sign-in state cookie. It must survive the identity provider's cross-site redirect back
 * to the callback, so it is SameSite=Lax; it holds only encrypted, single-use sign-in state.
 */
export const signInCookieName = '__Host-pl_sign_in';

export interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly sameSite: 'Strict' | 'Lax';
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    'HttpOnly',
    'Secure',
    `SameSite=${options.sameSite}`,
  ].join('; ');
}

export function sessionCookie(credentialId: string, secret: string, maxAgeSeconds: number): string {
  return serializeCookie(sessionCookieName, formatCredentialToken('staff_session', credentialId, secret), {
    maxAgeSeconds,
    sameSite: 'Strict',
  });
}

export function expiredCookie(name: string, sameSite: CookieOptions['sameSite']): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, sameSite });
}

/** The value of one cookie in a `Cookie` header; a name sent twice is ambiguous and yields nothing. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const values = header
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  return values.length === 1 ? values[0] : undefined;
}

/** The staff session credential a request presents in its cookie, or `null`. */
export function presentedSessionCredential(cookieHeader: string | undefined): PresentedCredential | null {
  const value = readCookie(cookieHeader, sessionCookieName);
  if (value === undefined) {
    return null;
  }
  const presented = parseCredentialToken(value);
  return presented?.kind === 'staff_session' ? presented : null;
}
