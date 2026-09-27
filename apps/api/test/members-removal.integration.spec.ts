import { randomUUID } from 'node:crypto';

import { failure, success } from '@partledger/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { StaffSessions } from '../src/auth/staff-sessions';
import type { OperationRegistry } from '../src/commands/handlers';
import { productionRegistry } from '../src/commands/query-registry';
import type { IdentityOrganizations } from '../src/tenants/identity-organizations';
import { newIdempotencyKey, startApiHarness, type ApiHarness } from './support/api-harness';
import { internalTestRegistry } from './support/internal-test-module';

const registry: OperationRegistry = {
  commands: [...internalTestRegistry.commands, ...productionRegistry.commands],
  queries: [...internalTestRegistry.queries, ...productionRegistry.queries],
};

const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const jobRows = z.array(z.object({ state: z.string(), user_id: z.string() }));

/** Keycloak is down for member removals: every call to take someone out of an organization fails. */
const removalCalls: string[] = [];
const keycloakDown: IdentityOrganizations = {
  createOrganization: () => Promise.resolve(failure('unavailable')),
  deleteOrganization: () => Promise.resolve(),
  createMember: () => Promise.resolve(failure('unavailable')),
  findOrganization: () => Promise.resolve(success(null)),
  deleteOrganizationAndMembers: () => Promise.resolve(failure('unavailable')),
  deleteUser: () => Promise.resolve(),
  removeMember: (_organizationId, userId) => {
    removalCalls.push(userId);
    return Promise.resolve(failure('unavailable'));
  },
};

describe('removing a member without Keycloak', () => {
  let harness: ApiHarness;

  beforeAll(async () => {
    harness = await startApiHarness({
      roles: 'memberships',
      identityOrganizations: keycloakDown,
      process: { registry },
    });
    // The tenant has an organization, as a provisioned one does.
    await harness.superuser.query(`update tenants set identity_organization_id = 'synthetic-org' where id = $1`, [
      harness.tenantA,
    ]);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('a member is removed and signed out even when Keycloak is unavailable', async () => {
    const admin = await harness.issue('staff_session', harness.tenantA, { roles: ['tenant_admin'] });
    const member = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    expect((await harness.query('staff', 'tenants.currentMember', {}, member.token)).status).toBe(200);

    const removal = await harness.command(
      'staff',
      'members.remove',
      { userId: member.subjectId },
      { token: admin.token, idempotencyKey: newIdempotencyKey() },
    );
    expect(removal).toMatchObject({ status: 200, body: { userId: member.subjectId, endedSessions: 1 } });
    expect(await harness.query('staff', 'tenants.currentMember', {}, member.token)).toMatchObject({
      status: 401,
      body: uniform401,
    });
    expect(
      await harness.count('select 1 from memberships where user_id = $1 and removed_at is null', [member.subjectId]),
    ).toBe(0);
    // Keycloak is tidied later, by a job that commits with the removal and retries until Keycloak answers.
    const jobs = jobRows.parse(
      (
        await harness.superuser.query(
          `select state::text as state, data -> 'payload' ->> 'userId' as user_id from pl_jobs.job
            where name = 'members.leaveOrganization'`,
        )
      ).rows,
    );
    expect(jobs).toEqual([{ state: 'created', user_id: member.subjectId }]);
    expect(removalCalls).toEqual([]);
  });

  it('a sign-in waits for a removal in flight and is then refused', async () => {
    const member = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    const staffSessions = harness.api.app.get(StaffSessions);
    const identity = { subject: member.subjectId, tenantId: harness.tenantA, organizationId: 'synthetic-org' };
    const remover = await harness.database.connect('pl_app');
    try {
      await remover.query('begin');
      await remover.query(`select set_config('app.tenant_id', $1, true)`, [harness.tenantA]);
      // The removal holds the tenant's member lock, as members.remove does, while it ends the membership.
      await remover.query(
        `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('partledger/members:' || $1, 0))`,
        [harness.tenantA],
      );
      await remover.query(`update memberships set removed_at = now() where user_id = $1 and removed_at is null`, [
        member.subjectId,
      ]);
      let settled = false;
      const signIn = staffSessions
        .start({ identity, refreshToken: JSON.stringify(identity) }, harness.clock.now())
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
      await remover.query('commit');
      expect(await signIn).toBeNull();
    } finally {
      await remover.end();
    }
  });

  it('a person who was never a member cannot start a session', async () => {
    const identity = { subject: randomUUID(), tenantId: harness.tenantA, organizationId: 'synthetic-org' };
    expect(
      await harness.api.app
        .get(StaffSessions)
        .start({ identity, refreshToken: JSON.stringify(identity) }, harness.clock.now()),
    ).toBeNull();
  });
});
