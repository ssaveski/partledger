import { translate } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import {
  readSession,
  redirectToSignIn,
  signInFailureMessageKey,
  signInUrl,
  signOut,
  stateChangingRequestHeaders,
  type Fetcher,
} from './session';

const session = {
  userId: '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  tenantId: '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01',
  expiresAt: '2026-09-27T22:00:00.000Z',
  idleExpiresAt: '2026-09-27T12:30:00.000Z',
};

function answering(
  status: number,
  body: unknown = null,
): { fetcher: Fetcher; calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  return {
    calls,
    fetcher: (input, init) => {
      calls.push([input, init]);
      return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
    },
  };
}

describe('staff session helpers', () => {
  it('sign in through the API and come back to a path on this app only', () => {
    expect(signInUrl('/rfqs/42?tab=quotes')).toBe('/api/v1/auth/sign-in?returnTo=%2Frfqs%2F42%3Ftab%3Dquotes');
    expect(signInUrl('https://attacker.example/')).toBe('/api/v1/auth/sign-in?returnTo=%2F');
    expect(signInUrl('//attacker.example')).toBe('/api/v1/auth/sign-in?returnTo=%2F');
  });

  it('redirect to sign-in from the current location', () => {
    const assigned: string[] = [];
    redirectToSignIn({
      pathname: '/suppliers',
      search: '?page=2',
      hash: '',
      assign: (url: string | URL) => {
        assigned.push(String(url));
      },
    });
    expect(assigned).toEqual(['/api/v1/auth/sign-in?returnTo=%2Fsuppliers%3Fpage%3D2']);
  });

  it('read a signed-in session', async () => {
    const { fetcher, calls } = answering(200, session);
    expect(await readSession(fetcher)).toEqual({ kind: 'signedIn', session });
    expect(calls[0]?.[0]).toBe('/api/v1/auth/session');
  });

  it('read a refused session as signed out, and anything else as unavailable, with translated messages', async () => {
    const signedOut = await readSession(answering(401, { error: 'Unauthenticated' }).fetcher);
    expect(signedOut).toEqual({ kind: 'signedOut', messageKey: 'pl.auth.sessionEnded' });
    for (const outcome of [answering(503).fetcher, answering(200, { userId: 'not-a-session' }).fetcher]) {
      expect(await readSession(outcome)).toEqual({ kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' });
    }
    const unreachable: Fetcher = () => Promise.reject(new TypeError('network'));
    expect((await readSession(unreachable)).kind).toBe('unavailable');
    expect(translate('pl.auth.sessionEnded')).not.toBe('');
    expect(translate('pl.auth.sessionUnavailable')).not.toBe('');
  });

  it('read a 200 whose body is not JSON, such as a proxy error page, as unavailable', async () => {
    const htmlPage: Fetcher = () =>
      Promise.resolve(new Response('<html>proxy</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await readSession(htmlPage)).toEqual({ kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' });
  });

  it('read a 503 from an identity provider outage as unavailable, not signed out', async () => {
    const outage = answering(503, {
      error: 'Unavailable',
      message: 'pl.error.unavailable.dependencyUnavailable',
      params: {},
    });
    expect(await readSession(outage.fetcher)).toEqual({
      kind: 'unavailable',
      messageKey: 'pl.auth.sessionUnavailable',
    });
  });

  it('sign out with the staff request header', async () => {
    const { fetcher, calls } = answering(204);
    expect(await signOut(fetcher)).toBe('signedOut');
    expect(calls[0]?.[0]).toBe('/api/v1/auth/sign-out');
    expect(calls[0]?.[1]).toMatchObject({ method: 'POST', headers: stateChangingRequestHeaders });
    expect(stateChangingRequestHeaders).toEqual({ 'x-partledger-request': 'staff-app' });
    expect(await signOut(answering(403).fetcher)).toBe('unavailable');
  });

  it('show a translated message after a sign-in that did not complete', () => {
    expect(signInFailureMessageKey('?signIn=failed')).toBe('pl.auth.signInFailed');
    expect(translate('pl.auth.signInFailed')).toMatch(/could not sign you in/);
    expect(signInFailureMessageKey('?signIn=ok')).toBeNull();
    expect(signInFailureMessageKey('')).toBeNull();
  });
});
