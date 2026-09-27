import { tenantRoles, type TenantRole } from '@partledger/contracts';
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
