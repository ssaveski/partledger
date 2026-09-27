import { describe, expect, it } from 'vitest';

import { addDays, approvalCovers, approvalRead, calendarDateOf, expiryOf, notOnTheList } from './approval-standing';

const asOf = '2026-09-27';

describe('approval expiry', () => {
  it('is noExpiry without an end date', () => {
    expect(expiryOf(null, asOf)).toBe('noExpiry');
  });

  it('is expired only after the last valid day', () => {
    expect(expiryOf('2026-09-26', asOf)).toBe('expired');
    expect(expiryOf(asOf, asOf)).toBe('expiringSoon');
  });

  it('is expiring soon up to and including 60 days ahead, and current beyond', () => {
    expect(expiryOf(addDays(asOf, 60), asOf)).toBe('expiringSoon');
    expect(expiryOf(addDays(asOf, 61), asOf)).toBe('current');
  });

  it('counts days across month and year ends in UTC', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(calendarDateOf(new Date('2026-09-27T23:59:59.999Z'))).toBe('2026-09-27');
  });
});

describe('approval coverage', () => {
  const approved = { status: 'approved', scope: ['castings'], expiresOn: null } as const;

  it('covers a category in the scope of an approved or conditional approval', () => {
    expect(approvalCovers(approved, 'castings', asOf)).toBe(true);
    expect(approvalCovers({ ...approved, status: 'conditional' }, 'castings', asOf)).toBe(true);
  });

  it('does not cover a category outside the scope', () => {
    expect(approvalCovers(approved, 'seals', asOf)).toBe(false);
  });

  it('does not cover anything once suspended, expired or off the list', () => {
    expect(approvalCovers({ ...approved, status: 'suspended' }, 'castings', asOf)).toBe(false);
    expect(approvalCovers({ ...approved, expiresOn: '2026-09-26' }, 'castings', asOf)).toBe(false);
    expect(approvalCovers(notOnTheList, 'castings', asOf)).toBe(false);
  });

  it('reads a supplier off the list as not approved with no scope', () => {
    expect(approvalRead(notOnTheList, asOf)).toEqual({
      status: 'notApproved',
      scope: [],
      expiresOn: null,
      expiry: 'noExpiry',
    });
  });
});
