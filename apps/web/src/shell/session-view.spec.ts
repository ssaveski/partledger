import { formatMessage, type StaffSession } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { roleMessageKey, sessionErrorTitle, sessionViewOf, type SignedIn } from './session-view';

const session: StaffSession = {
  userId: '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  tenantId: '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01',
  expiresAt: '2026-09-27T22:00:00.000Z',
  idleExpiresAt: '2026-09-27T12:30:00.000Z',
};

const member: Omit<SignedIn, 'session'> = {
  tenant: {
    tenantId: session.tenantId,
    slug: 'maple-ridge-components',
    displayName: 'Maple Ridge Components',
    region: 'ca',
    enabledPacks: ['canada'],
    supplierListSource: 'erp',
    baseCurrency: 'CAD',
  },
  member: { userId: session.userId, displayName: 'Avery Lindqvist', roles: ['buyer'] },
};

const signedIn = { ok: true, value: session } as const;
const unauthenticated = { ok: false, failure: { kind: 'unauthenticated' } } as const;

describe('the session the shell shows', () => {
  it('is signed in once both the session and the member have arrived', () => {
    expect(
      sessionViewOf({ session: signedIn, member: { ok: true, value: member }, signedOut: false, search: '' }),
    ).toEqual({ kind: 'signedIn', signedIn: { session, ...member } });
  });

  it('waits for the session, then for the member', () => {
    expect(sessionViewOf({ session: undefined, member: undefined, signedOut: false, search: '' }).kind).toBe(
      'checking',
    );
    expect(sessionViewOf({ session: signedIn, member: undefined, signedOut: false, search: '' }).kind).toBe('checking');
  });

  it('sends a person without a session to sign in, unless a sign-in has just failed', () => {
    expect(sessionViewOf({ session: unauthenticated, member: undefined, signedOut: false, search: '' }).kind).toBe(
      'redirecting',
    );
    expect(
      sessionViewOf({ session: unauthenticated, member: undefined, signedOut: false, search: '?signIn=failed' }).kind,
    ).toBe('signInFailed');
  });

  it('sends a member whose session ended since, such as a removed member, to sign in again', () => {
    expect(sessionViewOf({ session: signedIn, member: unauthenticated, signedOut: false, search: '' }).kind).toBe(
      'redirecting',
    );
  });

  it('tells a member who holds no role that none is assigned yet', () => {
    const forbidden = {
      ok: false,
      failure: { kind: 'refused', error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: {} },
    } as const;
    expect(sessionViewOf({ session: signedIn, member: forbidden, signedOut: false, search: '' }).kind).toBe('noRole');
  });

  it('shows an outage as unavailable rather than signing the person out', () => {
    expect(
      sessionViewOf({
        session: { ok: false, failure: { kind: 'unavailable' } },
        member: undefined,
        signedOut: false,
        search: '',
      }),
    ).toEqual({ kind: 'unavailable', failure: { kind: 'unavailable' } });
  });

  it('stays signed out after the person signs out, whatever the reads say', () => {
    expect(
      sessionViewOf({ session: signedIn, member: { ok: true, value: member }, signedOut: true, search: '' }).kind,
    ).toBe('signedOut');
  });

  it('names roles with message keys that have no underscores', () => {
    expect(roleMessageKey('quality_engineer')).toBe('pl.tenants.role.qualityEngineer');
    expect(roleMessageKey('tenant_admin', '.description')).toBe('pl.tenants.role.tenantAdmin.description');
  });

  it('titles a session that cannot be read after the session, not after a loading message', () => {
    const screen = formatMessage(sessionErrorTitle.screenKey);
    expect(formatMessage('pl.web.documentTitle', { page: formatMessage(sessionErrorTitle.key, { screen }) })).toBe(
      'Something went wrong: Your session · Partledger',
    );
  });
});
