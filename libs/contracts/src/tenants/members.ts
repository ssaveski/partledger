import { z } from 'zod';

import { defineCommand, defineQuery } from '../define';
import { errorCode } from '../errors';
import { tenantRoleSchema, tenantRoles } from '../principals';
import { memberDisplayNameSchema, memberEmailSchema, tenantSettingsSchema } from './tenants';

/**
 * Members and their roles (R3, KTD20). Roles are tenant rows changed only by these audited
 * commands; the identity provider knows only who belongs to the tenant's organization. Every
 * command here is administration: none of them grants business authority by itself.
 */

const tenantAdmins = { person: ['tenant_admin'] } as const;

const userIdSchema = z.uuid().describe('The member’s user id, from the identity provider.');

const memberInputSchema = z.object({ userId: userIdSchema }).strict().describe('Which member.');

const roleChangeInputSchema = z
  .object({ userId: userIdSchema, role: tenantRoleSchema.describe('The role to grant or revoke.') })
  .strict()
  .describe('A member and one role.');

const roleChangeOutputSchema = z
  .object({ userId: userIdSchema, role: tenantRoleSchema.describe('The role granted or revoked.') })
  .strict()
  .describe('The member whose roles changed.');

export const inviteMemberCommand = defineCommand({
  name: 'members.invite',
  description:
    'Invites a person: creates their account in the tenant’s organization only, and records their membership with no roles.',
  purpose: 'administration',
  input: z
    .object({ email: memberEmailSchema, displayName: memberDisplayNameSchema })
    .strict()
    .describe('The person to invite.'),
  output: z.object({ userId: userIdSchema }).strict().describe('The invited member.'),
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('Conflict', 'alreadyExists'),
    errorCode('Unavailable', 'dependencyUnavailable'),
  ],
  access: tenantAdmins,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const removeMemberCommand = defineCommand({
  name: 'members.remove',
  description: 'Removes a member from the tenant’s organization, revokes every role they hold and ends their sessions.',
  purpose: 'administration',
  input: memberInputSchema,
  output: z
    .object({
      userId: userIdSchema,
      endedSessions: z.number().int().min(0).describe('How many of the member’s sessions ended.'),
    })
    .strict()
    .describe('The removed member.'),
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'lastTenantAdmin'),
    errorCode('Unavailable', 'dependencyUnavailable'),
  ],
  access: tenantAdmins,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const grantRoleCommand = defineCommand({
  name: 'members.grantRole',
  description: 'Grants a member one role; it applies from their next request.',
  purpose: 'administration',
  input: roleChangeInputSchema,
  output: roleChangeOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('StepUpRequired', 'recentAuthentication'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'alreadyExists'),
  ],
  access: tenantAdmins,
  stepUp: true,
  impact: 'role_change',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const revokeRoleCommand = defineCommand({
  name: 'members.revokeRole',
  description: 'Revokes one role from a member; they lose it from their next request.',
  purpose: 'administration',
  input: roleChangeInputSchema,
  output: roleChangeOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('StepUpRequired', 'recentAuthentication'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'lastTenantAdmin'),
  ],
  access: tenantAdmins,
  stepUp: true,
  impact: 'role_change',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const memberSchema = z
  .object({
    userId: userIdSchema,
    email: memberEmailSchema,
    displayName: memberDisplayNameSchema,
    roles: z.array(tenantRoleSchema).describe('The roles the member holds, in the order of `tenantRoles`.'),
    invitedAt: z.iso.datetime({ offset: true }).describe('When the member was invited.'),
  })
  .strict()
  .describe('A current member of the tenant.');

export type Member = z.infer<typeof memberSchema>;

export const listMembersQuery = defineQuery({
  name: 'members.list',
  description: 'Lists the tenant’s current members and their roles, oldest first.',
  input: z.object({}).strict().describe('No input.'),
  output: z
    .object({ members: z.array(memberSchema).describe('Current members, oldest invitation first.') })
    .strict()
    .describe('The tenant’s members.'),
  errors: [errorCode('Forbidden', 'notPermitted')],
  access: tenantAdmins,
});

export const currentMemberQuery = defineQuery({
  name: 'tenants.currentMember',
  description: 'The tenant the session acts in and the signed-in member’s own roles.',
  input: z.object({}).strict().describe('No input.'),
  output: z
    .object({
      tenant: tenantSettingsSchema,
      member: z
        .object({
          userId: userIdSchema,
          displayName: memberDisplayNameSchema,
          roles: z.array(tenantRoleSchema).min(1).describe('The roles the member holds now.'),
        })
        .strict()
        .describe('The signed-in member.'),
    })
    .strict()
    .describe('Who is signed in, and where.'),
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  // Anyone holding a role; a member without one is refused and sees that no role is assigned yet.
  access: { person: tenantRoles },
});

export const memberCommands = [inviteMemberCommand, removeMemberCommand, grantRoleCommand, revokeRoleCommand] as const;
