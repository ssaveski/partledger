import { tenantRoles, type TenantRole } from '@partledger/contracts';
import { failureMessageKey, type ClientFailure } from '@partledger/contracts/client';
import { z } from 'zod';

/** The invitation form; messages are translation keys. */
export const inviteFormSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('pl.tenants.members.inviteDialog.emailInvalid')),
  displayName: z
    .string()
    .trim()
    .min(1, 'pl.tenants.members.inviteDialog.displayNameRequired')
    .max(200, 'pl.tenants.members.inviteDialog.displayNameRequired'),
});

export type InviteForm = z.infer<typeof inviteFormSchema>;

export interface RoleChange {
  readonly role: TenantRole;
  readonly change: 'grant' | 'revoke';
}

/**
 * The commands that take a member from the roles they hold to the chosen ones, one role each,
 * grants first so a member moving between roles is never left without one in between.
 */
export function roleChanges(held: readonly TenantRole[], chosen: readonly TenantRole[]): RoleChange[] {
  const grants = tenantRoles.filter((role) => chosen.includes(role) && !held.includes(role));
  const revokes = tenantRoles.filter((role) => held.includes(role) && !chosen.includes(role));
  return [
    ...grants.map((role) => ({ role, change: 'grant' as const })),
    ...revokes.map((role) => ({ role, change: 'revoke' as const })),
  ];
}

/**
 * Idempotency keys for the members screen (R33), one per change: the same change retried after
 * a response that never arrived reuses its key, so it acts once; another change, such as
 * removing a different member, never borrows it, which the API would refuse as a reused key.
 */
export interface IdempotencyKeys {
  keyFor(change: string): string;
  /** Forgets a change that the server confirmed, so doing it again later is a new request. */
  settle(change: string): void;
}

export function createIdempotencyKeys(newKey: () => string = () => crypto.randomUUID()): IdempotencyKeys {
  const keys = new Map<string, string>();
  return {
    keyFor(change) {
      const existing = keys.get(change);
      if (existing !== undefined) {
        return existing;
      }
      const created = newKey();
      keys.set(change, created);
      return created;
    },
    settle(change) {
      keys.delete(change);
    },
  };
}

/**
 * The message for a refused change. Until step-up exists (U29) a role change cannot confirm the
 * administrator's identity, so its refusal says that rather than asking for a confirmation the
 * app cannot offer.
 */
export function refusalMessageKey(failure: ClientFailure): string {
  return failure.kind === 'refused' && failure.error === 'StepUpRequired'
    ? 'pl.tenants.members.stepUpUnavailable'
    : failureMessageKey(failure);
}
