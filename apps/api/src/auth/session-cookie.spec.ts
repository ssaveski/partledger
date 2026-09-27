import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { staffRequestHeader } from '@partledger/contracts';
import { generateCredentialSecret } from '@partledger/db';
import { describe, expect, it } from 'vitest';

import { formatCredentialToken } from '../principals/credential-token';
import { passesCrossSiteCheck } from './csrf.guard';
import { presentedSessionCredential, readCookie, sessionCookie, sessionCookieName } from './session-cookie';

const id = '3f6c1d2e-8a9b-4c7d-9e0f-1a2b3c4d5e6f';

describe('the staff session cookie', () => {
  it('is __Host-, HttpOnly, Secure and SameSite=Strict, with no Domain', () => {
    const secret = generateCredentialSecret();
    expect(sessionCookie(id, secret, 36_000)).toBe(
      `__Host-pl_session=pls_${id}_${secret}; Path=/; Max-Age=36000; HttpOnly; Secure; SameSite=Strict`,
    );
  });

  it('presents only a staff session credential', () => {
    const secret = generateCredentialSecret();
    const staff = `${sessionCookieName}=${formatCredentialToken('staff_session', id, secret)}`;
    expect(presentedSessionCredential(`theme=dark; ${staff}`)).toEqual({ kind: 'staff_session', id, secret });
    expect(
      presentedSessionCredential(`${sessionCookieName}=${formatCredentialToken('supplier_link', id, secret)}`),
    ).toBeNull();
    expect(presentedSessionCredential(`pl_session=${formatCredentialToken('staff_session', id, secret)}`)).toBeNull();
    expect(presentedSessionCredential(undefined)).toBeNull();
  });

  it('refuses a cookie sent twice, which could be a planted duplicate', () => {
    const one = `${sessionCookieName}=${formatCredentialToken('staff_session', id, generateCredentialSecret())}`;
    const two = `${sessionCookieName}=${formatCredentialToken('staff_session', id, generateCredentialSecret())}`;
    expect(readCookie(`${one}; ${two}`, sessionCookieName)).toBeUndefined();
    expect(presentedSessionCredential(`${one}; ${two}`)).toBeNull();
  });
});

describe('the cross-site request check', () => {
  function request(method: string, headers: Record<string, string>): IncomingMessage {
    const message = new IncomingMessage(new Socket());
    message.method = method;
    message.headers = headers;
    return message;
  }

  it('lets safe methods through without the header', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(passesCrossSiteCheck(request(method, {}), 'staff'), method).toBe(true);
    }
  });

  it('refuses a state-changing staff request without the exact staff app header', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(passesCrossSiteCheck(request(method, {}), 'staff'), method).toBe(false);
      expect(passesCrossSiteCheck(request(method, { [staffRequestHeader.name]: 'other' }), 'staff'), method).toBe(
        false,
      );
      expect(
        passesCrossSiteCheck(request(method, { [staffRequestHeader.name]: staffRequestHeader.value }), 'staff'),
        method,
      ).toBe(true);
    }
  });

  it('leaves listeners that take no browser cookies to their bearer credentials', () => {
    for (const adapter of ['portal', 'drop', 'operator'] as const) {
      expect(passesCrossSiteCheck(request('POST', {}), adapter), adapter).toBe(true);
    }
  });
});
