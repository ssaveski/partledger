import { describe, expect, it } from 'vitest';

import { translate } from '@partledger/contracts';

import { createIdempotencyKeys, inviteFormSchema, refusalMessageKey, roleChanges } from './member-changes';

describe('changing a member’s roles', () => {
  it('grants the added roles before revoking the removed ones, one command per role', () => {
    expect(roleChanges(['buyer', 'auditor'], ['approver', 'auditor', 'quality_engineer'])).toEqual([
      { role: 'quality_engineer', change: 'grant' },
      { role: 'approver', change: 'grant' },
      { role: 'buyer', change: 'revoke' },
    ]);
  });

  it('asks for nothing when the chosen roles are the held ones', () => {
    expect(roleChanges(['buyer'], ['buyer'])).toEqual([]);
  });
});

describe('the invitation form', () => {
  it('lowercases and trims the email address and trims the name', () => {
    expect(inviteFormSchema.parse({ email: '  Rowan.A@Synthetic.Test ', displayName: ' Rowan A ' })).toEqual({
      email: 'rowan.a@synthetic.test',
      displayName: 'Rowan A',
    });
  });

  it('explains a missing name or a malformed email with translation keys', () => {
    const result = inviteFormSchema.safeParse({ email: 'not an email', displayName: ' ' });
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message).sort()).toEqual([
      'pl.tenants.members.inviteDialog.displayNameRequired',
      'pl.tenants.members.inviteDialog.emailInvalid',
    ]);
  });
});

describe('idempotency keys on the members screen', () => {
  /** The API's idempotency: a key replays its first request, and a reused key with another body is refused. */
  function fakeApi() {
    const seen = new Map<string, string>();
    return (key: string, body: string): 'done' | 'replayed' | 'keyReused' => {
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, body);
        return 'done';
      }
      return first === body ? 'replayed' : 'keyReused';
    };
  }

  it('a lost removal response does not stop the next member’s removal', () => {
    const api = fakeApi();
    let serial = 0;
    const keys = createIdempotencyKeys(() => `key-${String((serial += 1)).padStart(16, '0')}`);
    // The first member's removal lands but its response is lost, so it is never settled.
    expect(api(keys.keyFor('remove:first'), 'first')).toBe('done');
    expect(api(keys.keyFor('remove:second'), 'second')).toBe('done');
    // Retrying the first removal replays it instead of acting twice.
    expect(api(keys.keyFor('remove:first'), 'first')).toBe('replayed');
  });

  it('a settled change gets a new key the next time', () => {
    const keys = createIdempotencyKeys();
    const first = keys.keyFor('grant:member:buyer');
    keys.settle('grant:member:buyer');
    expect(keys.keyFor('grant:member:buyer')).not.toBe(first);
  });
});

describe('a refused member change', () => {
  it('asks the administrator to confirm their identity before the change is made', () => {
    const key = refusalMessageKey({
      kind: 'refused',
      error: 'StepUpRequired',
      message: 'pl.error.stepUpRequired.recentAuthentication',
      params: {},
    });
    expect(translate(key)).toBe('This change needs you to confirm your identity again. Nothing has changed yet.');
    expect(
      refusalMessageKey({
        kind: 'refused',
        error: 'Conflict',
        message: 'pl.error.conflict.lastTenantAdmin',
        params: {},
      }),
    ).toBe('pl.error.conflict.lastTenantAdmin');
  });
});
