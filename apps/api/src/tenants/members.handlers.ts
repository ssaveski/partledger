import { Inject, Injectable } from '@nestjs/common';
import {
  currentMemberQuery,
  grantRoleCommand,
  inviteMemberCommand,
  listMembersQuery,
  removeMemberCommand,
  revokeRoleCommand,
  type InputOf,
} from '@partledger/contracts';
import { refuse, success } from '@partledger/domain';

import { auditId, auditToken } from '../audit/audit-payload';
import type {
  CommandContext,
  CommandHandler,
  HandlerResult,
  OperationContext,
  QueryHandler,
} from '../commands/handlers';
import { identityOrganizations, type IdentityOrganizations } from './identity-organizations';
import { membershipStore } from './membership-store';

/**
 * Members and roles (R3, KTD20). Every change runs in the administrator's tenant transaction
 * and lands in that command's audit entry, which names the administrator as its actor. A
 * person's name and email enter the chain only as commitments.
 */

@Injectable()
export class InviteMemberHandler implements CommandHandler<typeof inviteMemberCommand> {
  constructor(@Inject(identityOrganizations) private readonly organizations: IdentityOrganizations) {}

  async execute(
    input: InputOf<typeof inviteMemberCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof inviteMemberCommand>> {
    const { tenantId } = principal;
    await membershipStore.lockTenantMembers(database, tenantId);
    if (await membershipStore.emailInUse(database, tenantId, input.email)) {
      return refuse('Conflict', 'alreadyExists');
    }
    const organizationId = (await membershipStore.tenantOf(database, tenantId))?.identityOrganizationId ?? null;
    if (organizationId === null) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    const created = await this.organizations.createMember(organizationId, input);
    if (!created.ok) {
      return created.error === 'already_exists'
        ? refuse('Conflict', 'alreadyExists')
        : refuse('Unavailable', 'dependencyUnavailable');
    }
    const userId = created.value;
    try {
      await membershipStore.insertMember(database, { tenantId, userId, ...input, invitedAt: now });
      audit.record({
        member: auditId(userId),
        email: await audit.commit(input.email),
        displayName: await audit.commit(input.displayName),
      });
    } catch (error) {
      await this.organizations.deleteUser(userId);
      throw error;
    }
    return success({ userId });
  }
}

@Injectable()
export class RemoveMemberHandler implements CommandHandler<typeof removeMemberCommand> {
  constructor(@Inject(identityOrganizations) private readonly organizations: IdentityOrganizations) {}

  async execute(
    input: InputOf<typeof removeMemberCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof removeMemberCommand>> {
    const { tenantId } = principal;
    await membershipStore.lockTenantMembers(database, tenantId);
    const member = await membershipStore.findActive(database, tenantId, input.userId);
    if (member === undefined) {
      return refuse('NotFound', 'resource');
    }
    if (member.roles.includes('tenant_admin') && (await membershipStore.countActiveAdmins(database, tenantId)) <= 1) {
      return refuse('Conflict', 'lastTenantAdmin');
    }
    const endedSessions = await membershipStore.removeMember(database, tenantId, input.userId, now);
    const organizationId = (await membershipStore.tenantOf(database, tenantId))?.identityOrganizationId ?? null;
    if (organizationId !== null) {
      // Last, so a refusal here rolls back everything above.
      const removed = await this.organizations.removeMember(organizationId, input.userId);
      if (!removed.ok) {
        return refuse('Unavailable', 'dependencyUnavailable');
      }
    }
    audit.record({
      member: auditId(input.userId),
      revokedRoles: member.roles.map((role) => auditToken(role)),
      endedSessions,
    });
    return success({ userId: input.userId, endedSessions });
  }
}

@Injectable()
export class GrantRoleHandler implements CommandHandler<typeof grantRoleCommand> {
  async execute(
    input: InputOf<typeof grantRoleCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof grantRoleCommand>> {
    const { tenantId } = principal;
    await membershipStore.lockTenantMembers(database, tenantId);
    if ((await membershipStore.findActive(database, tenantId, input.userId)) === undefined) {
      return refuse('NotFound', 'resource');
    }
    if (!(await membershipStore.grantRole(database, { tenantId, ...input, grantedAt: now }))) {
      return refuse('Conflict', 'alreadyExists');
    }
    audit.record({ member: auditId(input.userId), grantedRole: auditToken(input.role) });
    return success(input);
  }
}

@Injectable()
export class RevokeRoleHandler implements CommandHandler<typeof revokeRoleCommand> {
  async execute(
    input: InputOf<typeof revokeRoleCommand>,
    { principal, database, audit }: CommandContext,
  ): Promise<HandlerResult<typeof revokeRoleCommand>> {
    const { tenantId } = principal;
    await membershipStore.lockTenantMembers(database, tenantId);
    const member = await membershipStore.findActive(database, tenantId, input.userId);
    if (member?.roles.includes(input.role) !== true) {
      return refuse('NotFound', 'resource');
    }
    if (input.role === 'tenant_admin' && (await membershipStore.countActiveAdmins(database, tenantId)) <= 1) {
      return refuse('Conflict', 'lastTenantAdmin');
    }
    await membershipStore.revokeRole(database, tenantId, input.userId, input.role);
    audit.record({ member: auditId(input.userId), revokedRole: auditToken(input.role) });
    return success(input);
  }
}

@Injectable()
export class ListMembersHandler implements QueryHandler<typeof listMembersQuery> {
  async execute(
    _input: InputOf<typeof listMembersQuery>,
    { principal, database }: OperationContext,
  ): Promise<HandlerResult<typeof listMembersQuery>> {
    const members = await membershipStore.listActive(database, principal.tenantId);
    return success({
      members: members.map((member) => ({
        ...member,
        roles: [...member.roles],
        invitedAt: member.invitedAt.toISOString(),
      })),
    });
  }
}

@Injectable()
export class CurrentMemberHandler implements QueryHandler<typeof currentMemberQuery> {
  async execute(
    _input: InputOf<typeof currentMemberQuery>,
    { principal, database }: OperationContext,
  ): Promise<HandlerResult<typeof currentMemberQuery>> {
    if (principal.type !== 'person') {
      return refuse('Forbidden', 'notPermitted');
    }
    const tenant = await membershipStore.tenantOf(database, principal.tenantId);
    const member = await membershipStore.findActive(database, principal.tenantId, principal.userId);
    if (tenant === undefined || member === undefined) {
      return refuse('NotFound', 'resource');
    }
    return success({
      tenant: {
        tenantId: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        region: tenant.region,
        enabledPacks: tenant.enabledPacks,
        supplierListSource: tenant.supplierListSource,
        baseCurrency: tenant.baseCurrency,
      },
      member: { userId: member.userId, displayName: member.displayName, roles: [...principal.roles] },
    });
  }
}
