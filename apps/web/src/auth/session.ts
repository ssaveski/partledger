import {
  returnToSchema,
  signInFailedParameter,
  staffAuthPaths,
  staffRequestHeader,
  staffSessionSchema,
  type StaffSession,
} from '@partledger/contracts';

/**
 * The staff app's view of its session (KTD20). The session cookie is HttpOnly, so the app
 * never sees a token: it learns whether it is signed in by asking the API, signs in by a
 * top-level navigation to the API, and signs out with a request that carries the staff app's
 * request header. Every outcome a screen shows is a translation key.
 */

export type SessionState =
  | { readonly kind: 'signedIn'; readonly session: StaffSession }
  | { readonly kind: 'signedOut'; readonly messageKey: 'pl.auth.sessionEnded' }
  | { readonly kind: 'unavailable'; readonly messageKey: 'pl.auth.sessionUnavailable' };

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Headers every state-changing request to the API carries; the U3 client adds them to each command. */
export const stateChangingRequestHeaders: Readonly<Record<string, string>> = {
  [staffRequestHeader.name]: staffRequestHeader.value,
};

/** The API URL that starts a sign-in and returns to `returnTo`, a path on this app. */
export function signInUrl(returnTo: string): string {
  const parsed = returnToSchema.safeParse(returnTo);
  const path = parsed.success ? parsed.data : '/';
  return `${staffAuthPaths.signIn}?${new URLSearchParams({ returnTo: path }).toString()}`;
}

/** Leaves the app for the identity provider, to come back to where the person was. */
export function redirectToSignIn(location: Pick<Location, 'assign' | 'pathname' | 'search' | 'hash'>): void {
  location.assign(signInUrl(`${location.pathname}${location.search}${location.hash}`));
}

/** The message to show when the API sent the person back from a sign-in that did not complete. */
export function signInFailureMessageKey(search: string): 'pl.auth.signInFailed' | null {
  return new URLSearchParams(search).get(signInFailedParameter.name) === signInFailedParameter.value
    ? 'pl.auth.signInFailed'
    : null;
}

export async function readSession(fetcher: Fetcher = fetch): Promise<SessionState> {
  let response: Response;
  try {
    response = await fetcher(staffAuthPaths.session, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' };
  }
  if (response.status === 401) {
    return { kind: 'signedOut', messageKey: 'pl.auth.sessionEnded' };
  }
  if (!response.ok) {
    return { kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' };
  }
  const session = staffSessionSchema.safeParse(await response.json());
  return session.success
    ? { kind: 'signedIn', session: session.data }
    : { kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' };
}

/** Ends the session; `unavailable` when the API could not be reached and the session may still stand. */
export async function signOut(fetcher: Fetcher = fetch): Promise<'signedOut' | 'unavailable'> {
  try {
    const response = await fetcher(staffAuthPaths.signOut, {
      method: 'POST',
      credentials: 'same-origin',
      headers: stateChangingRequestHeaders,
    });
    return response.ok ? 'signedOut' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
