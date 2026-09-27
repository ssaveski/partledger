import type { z } from 'zod';

import type { StaffSession } from '../auth';
import { fixtureCommand, fixtureQuery, type FixtureHandler, type FixtureResponse } from '../client/fixture-adapter';
import { errorCode } from '../errors';
import { tenantRoles, type TenantRole } from '../principals';
import {
  currentMemberQuery,
  grantRoleCommand,
  inviteMemberCommand,
  listMembersQuery,
  removeMemberCommand,
  revokeRoleCommand,
  type Member,
} from '../tenants/members';
import { fixtureId } from './rfqs';

/**
 * A synthetic tenant and its members for the preview: invented people only. The state lives in
 * the returned handlers, so an invitation or a role change in the preview shows up in the
 * member list until the page reloads, and nothing is saved.
 */

type CurrentMemberOutput = z.input<typeof currentMemberQuery.output>;

export const fixtureTenantId = fixtureId(5001);

export const fixtureSignedInUserId = fixtureId(5101);

const fixtureTenant: CurrentMemberOutput['tenant'] = {
  tenantId: fixtureTenantId,
  slug: 'maple-ridge-components',
  displayName: 'Maple Ridge Components',
  region: 'ca',
  enabledPacks: ['canada'],
  supplierListSource: 'erp',
  baseCurrency: 'CAD',
};

const initialMembers: readonly Member[] = [
  {
    userId: fixtureSignedInUserId,
    email: 'avery.lindqvist@synthetic.test',
    displayName: 'Avery Lindqvist',
    roles: ['tenant_admin', 'buyer'],
    invitedAt: '2026-05-04T13:00:00.000Z',
  },
  {
    userId: fixtureId(5102),
    email: 'rowan.achterberg@synthetic.test',
    displayName: 'Rowan Achterberg',
    roles: ['quality_engineer'],
    invitedAt: '2026-05-11T09:30:00.000Z',
  },
  {
    userId: fixtureId(5103),
    email: 'sasha.okonkwo-ruiz@synthetic.test',
    displayName: 'Sasha Okonkwo-Ruiz',
    roles: ['approver', 'auditor'],
    invitedAt: '2026-06-02T15:45:00.000Z',
  },
  {
    userId: fixtureId(5104),
    email: 'jun.halvorsen@synthetic.test',
    displayName: 'Jun Halvorsen',
    roles: [],
    invitedAt: '2026-09-20T08:15:00.000Z',
  },
];

function inRoleOrder(roles: readonly TenantRole[]): TenantRole[] {
  return tenantRoles.filter((role) => roles.includes(role));
}

export interface TenantFixtures {
  readonly queries: readonly FixtureHandler[];
  readonly commands: readonly FixtureHandler[];
  readonly session: () => StaffSession | null;
}

export function createTenantFixtures(now: () => Date = () => new Date()): TenantFixtures {
  let members: Member[] = initialMembers.map((member) => ({ ...member, roles: [...member.roles] }));
  let invitations = 0;
  const find = (userId: string) => members.find((member) => member.userId === userId);
  const admins = () => members.filter((member) => member.roles.includes('tenant_admin'));
  const replace = (userId: string, change: (member: Member) => Member) => {
    members = members.map((member) => (member.userId === userId ? change(member) : member));
  };
  // Like the API: a removed member's session has ended, and only a tenant administrator manages members.
  const signedOut = () => find(fixtureSignedInUserId) === undefined;
  const asAdministrator = <Output>(respond: () => FixtureResponse<Output>): FixtureResponse<Output> => {
    if (signedOut()) {
      return { kind: 'unauthenticated' };
    }
    return find(fixtureSignedInUserId)?.roles.includes('tenant_admin') === true
      ? respond()
      : { kind: 'refused', code: errorCode('Forbidden', 'notPermitted') };
  };

  const queries = [
    fixtureQuery(currentMemberQuery, () => {
      const signedIn = find(fixtureSignedInUserId);
      if (signedIn === undefined) {
        return { kind: 'unauthenticated' };
      }
      if (signedIn.roles.length === 0) {
        return { kind: 'refused', code: errorCode('Forbidden', 'notPermitted') };
      }
      return {
        kind: 'output',
        output: {
          tenant: fixtureTenant,
          member: { userId: signedIn.userId, displayName: signedIn.displayName, roles: signedIn.roles },
        },
      };
    }),
    fixtureQuery(listMembersQuery, () => asAdministrator(() => ({ kind: 'output', output: { members } }))),
  ];

  const commands = [
    fixtureCommand(inviteMemberCommand, (input) =>
      asAdministrator(() => {
        if (members.some((member) => member.email === input.email)) {
          return { kind: 'refused', code: errorCode('Conflict', 'alreadyExists') };
        }
        invitations += 1;
        const userId = fixtureId(5200 + invitations);
        members = [
          ...members,
          { userId, email: input.email, displayName: input.displayName, roles: [], invitedAt: now().toISOString() },
        ];
        return { kind: 'output', output: { userId } };
      }),
    ),
    fixtureCommand(removeMemberCommand, (input) =>
      asAdministrator(() => {
        const member = find(input.userId);
        if (member === undefined) {
          return { kind: 'refused', code: errorCode('NotFound', 'resource') };
        }
        if (member.roles.includes('tenant_admin') && admins().length === 1) {
          return { kind: 'refused', code: errorCode('Conflict', 'lastTenantAdmin') };
        }
        members = members.filter((candidate) => candidate.userId !== input.userId);
        return { kind: 'output', output: { userId: input.userId, endedSessions: 0 } };
      }),
    ),
    fixtureCommand(grantRoleCommand, (input) =>
      asAdministrator(() => {
        const member = find(input.userId);
        if (member === undefined) {
          return { kind: 'refused', code: errorCode('NotFound', 'resource') };
        }
        if (member.roles.includes(input.role)) {
          return { kind: 'refused', code: errorCode('Conflict', 'alreadyExists') };
        }
        replace(input.userId, (current) => ({ ...current, roles: inRoleOrder([...current.roles, input.role]) }));
        return { kind: 'output', output: input };
      }),
    ),
    fixtureCommand(revokeRoleCommand, (input) =>
      asAdministrator(() => {
        const member = find(input.userId);
        if (member?.roles.includes(input.role) !== true) {
          return { kind: 'refused', code: errorCode('NotFound', 'resource') };
        }
        if (input.role === 'tenant_admin' && admins().length === 1) {
          return { kind: 'refused', code: errorCode('Conflict', 'lastTenantAdmin') };
        }
        replace(input.userId, (current) => ({
          ...current,
          roles: current.roles.filter((role) => role !== input.role),
        }));
        return { kind: 'output', output: input };
      }),
    ),
  ];

  return {
    queries,
    commands,
    session: () => {
      if (signedOut()) {
        return null;
      }
      const current = now();
      return {
        userId: fixtureSignedInUserId,
        tenantId: fixtureTenantId,
        expiresAt: new Date(current.getTime() + 10 * 3_600_000).toISOString(),
        idleExpiresAt: new Date(current.getTime() + 30 * 60_000).toISOString(),
      };
    },
  };
}
