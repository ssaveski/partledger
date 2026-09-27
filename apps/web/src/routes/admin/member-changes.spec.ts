import { describe, expect, it } from 'vitest';

import { inviteFormSchema, roleChanges } from './member-changes';

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
