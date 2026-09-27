import type { StaffSession, TenantRole, TenantSettings } from '@partledger/contracts';
import type { ClientFailure, ClientResult } from '@partledger/contracts/client';

import { signInFailureMessageKey } from '../auth/session';

/** The signed-in person as every screen sees them: the session, the tenant and their own roles. */
export interface SignedIn {
  readonly session: StaffSession;
  readonly tenant: TenantSettings;
  readonly member: { readonly userId: string; readonly displayName: string; readonly roles: readonly TenantRole[] };
}

/**
 * What the shell shows for the session and the member read (KTD20, R3). A person without a
 * session is sent to sign in, unless a sign-in just failed, which would loop; a signed-in
 * person without a role sees that no role is assigned yet rather than an empty app.
 */
export type SessionView =
  | { readonly kind: 'checking' }
  | { readonly kind: 'redirecting' }
  | { readonly kind: 'signInFailed' }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'noRole' }
  | { readonly kind: 'unavailable'; readonly failure: ClientFailure }
  | { readonly kind: 'signedIn'; readonly signedIn: SignedIn };

export function sessionViewOf({
  session,
  member,
  signedOut,
  search,
}: {
  session: ClientResult<StaffSession> | undefined;
  member: ClientResult<Omit<SignedIn, 'session'>> | undefined;
  /** The person signed out in this page; they sign in again only when they choose to. */
  signedOut: boolean;
  search: string;
}): SessionView {
  if (signedOut) {
    return { kind: 'signedOut' };
  }
  if (session === undefined) {
    return { kind: 'checking' };
  }
  if (!session.ok) {
    return signInNeeded(session.failure, search);
  }
  if (member === undefined) {
    return { kind: 'checking' };
  }
  if (!member.ok) {
    if (member.failure.kind === 'refused' && member.failure.error === 'Forbidden') {
      return { kind: 'noRole' };
    }
    return signInNeeded(member.failure, search);
  }
  return { kind: 'signedIn', signedIn: { session: session.value, ...member.value } };
}

function signInNeeded(failure: ClientFailure, search: string): SessionView {
  if (failure.kind !== 'unauthenticated') {
    return { kind: 'unavailable', failure };
  }
  return signInFailureMessageKey(search) === null ? { kind: 'redirecting' } : { kind: 'signInFailed' };
}

export function holdsRole(signedIn: SignedIn, role: TenantRole): boolean {
  return signedIn.member.roles.includes(role);
}

/** Message keys cannot hold underscores, so role keys are camelCase. */
export function roleMessageKey(role: TenantRole, suffix = ''): string {
  const camel = role.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return `pl.tenants.role.${camel}${suffix}`;
}

/** A session that cannot be read names the session as the screen that failed, not a loading message. */
export const sessionErrorTitle = { key: 'pl.web.stateTitle.error', screenKey: 'pl.tenants.session.screen' } as const;
