import type { ApprovalStatus, ExpiryStatus, PartCategory, SupplierApproval } from '@partledger/contracts';

/** R14: a dated record ending within this many days is expiring soon. */
export const expiringSoonDays = 60;

/** The calendar date of an instant in UTC, which every expiry is evaluated on (KTD12). */
export function calendarDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return calendarDateOf(moved);
}

/** How an approval ending on `expiresOn` (its last valid day) stands on `asOf`. */
export function expiryOf(expiresOn: string | null, asOf: string): ExpiryStatus {
  if (expiresOn === null) {
    return 'noExpiry';
  }
  if (expiresOn < asOf) {
    return 'expired';
  }
  return expiresOn <= addDays(asOf, expiringSoonDays) ? 'expiringSoon' : 'current';
}

export interface StoredApproval {
  readonly status: ApprovalStatus;
  readonly scope: readonly PartCategory[];
  readonly expiresOn: string | null;
}

/** A supplier without an entry is not on the list. */
export const notOnTheList: StoredApproval = { status: 'notApproved', scope: [], expiresOn: null };

export function approvalRead(approval: StoredApproval, asOf: string): SupplierApproval {
  return {
    status: approval.status,
    scope: [...approval.scope],
    expiresOn: approval.expiresOn,
    expiry: expiryOf(approval.expiresOn, asOf),
  };
}

const activeStatuses: ReadonlySet<ApprovalStatus> = new Set(['approved', 'conditional']);

/** Whether an approval lets the supplier be invited for a part of `category` on `asOf`. */
export function approvalCovers(approval: StoredApproval, category: PartCategory, asOf: string): boolean {
  return (
    activeStatuses.has(approval.status) &&
    expiryOf(approval.expiresOn, asOf) !== 'expired' &&
    approval.scope.includes(category)
  );
}
