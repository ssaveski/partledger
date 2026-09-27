import { randomUUID } from 'node:crypto';

import {
  directoryPath,
  listMembersQuery,
  operatorPaths,
  provisionTenantOutputSchema,
  staffRequestHeader,
  type ProvisionTenantInput,
  type TenantRole,
} from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { StaffSessions } from '../src/auth/staff-sessions';
import type { OperationRegistry } from '../src/commands/handlers';
import { OperationExecutor } from '../src/commands/operation-executor';
import { productionRegistry } from '../src/commands/query-registry';
import type { AuthenticatedPrincipal } from '../src/principals/principal';
import {
  defaultStepUpLevel,
  newIdempotencyKey,
  startApiHarness,
  type ApiHarness,
  type IssuedToken,
} from './support/api-harness';
import { placeholderAuthEnvironment } from './support/auth-environment';
import { internalTestRegistry } from './support/internal-test-module';
import {
  clientId,
  organizationsClientId,
  realmName,
  startKeycloak,
  syntheticPassword,
  type StartedKeycloak,
} from './support/keycloak';
import {
  createOperator,
  operatorIssuer,
  operatorRealmFile,
  operatorRealmName,
  signInOperator,
} from './support/operator-realm';

const registry: OperationRegistry = {
  commands: [...internalTestRegistry.commands, ...productionRegistry.commands],
  queries: [...internalTestRegistry.queries, ...productionRegistry.queries],
};

const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const organizationRows = z.array(z.object({ id: z.string(), alias: z.string() }));
const organizationDetail = z.object({ id: z.string(), attributes: z.record(z.string(), z.array(z.string())) });
const auditRows = z.array(
  z.object({
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    acted_under: z.record(z.string(), z.unknown()),
    payload: z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }),
    canonical: z.instanceof(Buffer),
  }),
);
const createdNote = z.object({ noteId: z.uuid() });
const invited = z.object({ userId: z.uuid() });
const sessionEnds = z.array(z.object({ end_reason: z.string().nullable() }));

function provisioningRequest(slug: string, overrides: Partial<ProvisionTenantInput> = {}): ProvisionTenantInput {
  return {
    slug,
    displayName: `Synthetic ${slug}`,
    region: 'ca',
    enabledPacks: ['canada'],
    supplierListSource: 'erp',
    baseCurrency: 'CAD',
    aiPolicy: { provider: 'platform_default', keyReference: null, regionRestricted: false },
    firstAdmin: { email: `admin.${slug}@synthetic.test`, displayName: 'Synthetic Administrator' },
    ...overrides,
  };
}

describe('tenants, roles, users and the directory', () => {
  let keycloak: StartedKeycloak;
  let harness: ApiHarness;
  let executor: OperationExecutor;
  let organizationsSecret: string;

  beforeAll(async () => {
    keycloak = await startKeycloak([operatorRealmFile]);
    organizationsSecret = await keycloak.admin.regenerateClientSecret(organizationsClientId);
    harness = await startApiHarness({
      roles: 'memberships',
      process: { registry, workers: true },
      authEnvironment: placeholderAuthEnvironment({
        KEYCLOAK_ISSUER: keycloak.issuer,
        KEYCLOAK_CLIENT_ID: clientId,
        KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET: organizationsSecret,
        OPERATOR_KEYCLOAK_ISSUER: operatorIssuer(keycloak),
        STAFF_SESSION_IDLE_TIMEOUT_MINUTES: '10080',
      }),
    });
    executor = harness.api.app.get(OperationExecutor);
    // Two realms in one Keycloak, beside the other suites' containers.
  }, 300_000);

  afterAll(async () => {
    await harness.close();
    await keycloak.stop();
  });

  async function operatorToken(): Promise<string> {
    const signedIn = await signInOperator(keycloak, await createOperator(keycloak));
    if (signedIn.accessToken === null) {
      throw new Error('The operator did not complete the sign-in');
    }
    return signedIn.accessToken;
  }

  async function provision(body: unknown, token: string | undefined, listener: 'operator' | 'staff' = 'operator') {
    const response = await fetch(`${harness.api.listeners.urls[listener]}${operatorPaths.tenants}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        // On the staff listener the request gets past the cross-site check, to show the route is absent there.
        ...(listener === 'staff' ? { [staffRequestHeader.name]: staffRequestHeader.value } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : z.unknown().parse(JSON.parse(text)) };
  }

  async function provisioned(slug: string) {
    const response = await provision(provisioningRequest(slug), await operatorToken());
    expect(response.status).toBe(201);
    return provisionTenantOutputSchema.parse(response.body);
  }

  async function eventually(check: () => Promise<boolean>, timeoutMilliseconds = 60_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      if (await check()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return check();
  }

  async function usersWithEmail(email: string) {
    return z
      .array(z.object({ id: z.string() }))
      .parse(await keycloak.admin.json(`/${realmName}/users?email=${encodeURIComponent(email)}&exact=true`));
  }

  async function organizationsOf(userId: string) {
    return organizationRows.parse(
      await keycloak.admin.json(`/${realmName}/organizations/members/${userId}/organizations`),
    );
  }

  /** The latest entry of one event; the enrolment job appends to a new tenant's chain at its own pace. */
  async function lastAuditEntry(tenantId: string, event: string) {
    const result = await harness.superuser.query(
      `select actor_type, actor_id, acted_under, payload, canonical from audit_entries
        where tenant_id = $1 and payload ->> 'event' = $2 order by seq desc limit 1`,
      [tenantId, event],
    );
    const [entry] = auditRows.parse(result.rows);
    if (entry === undefined) {
      throw new Error('No audit entry');
    }
    return entry;
  }

  /** A person who stepped up just now, run through the executor directly. */
  function steppedUp(tenantId: string, session: IssuedToken): AuthenticatedPrincipal {
    return {
      type: 'person',
      tenantId,
      userId: session.subjectId,
      stepUp: { level: defaultStepUpLevel, authenticatedAt: harness.clock.now() },
      actedUnder: { grant: 'staff_session', credentialId: session.credentialId },
      adapter: 'staff',
      correlationId: randomUUID(),
    };
  }

  function changeRole(
    name: 'members.grantRole' | 'members.revokeRole',
    tenantId: string,
    admin: IssuedToken,
    userId: string,
    role: TenantRole,
  ) {
    return executor.runCommand(steppedUp(tenantId, admin), name, { userId, role }, newIdempotencyKey());
  }

  describe('provisioning', () => {
    it('an operator who signs in with a password and a one-time code provisions a tenant pinned to this region', async () => {
      const created = await provisioned('synthetic-provisioned');
      const [tenant] = z
        .array(z.object({ region: z.string(), identity_organization_id: z.string(), base_currency: z.string() }))
        .parse(
          (
            await harness.superuser.query(
              'select region, identity_organization_id, base_currency from tenants where id = $1',
              [created.tenantId],
            )
          ).rows,
        );
      expect(tenant).toEqual({ region: 'ca', identity_organization_id: created.organizationId, base_currency: 'CAD' });
      const organization = organizationDetail.parse(
        await keycloak.admin.json(`/${realmName}/organizations/${created.organizationId}`),
      );
      expect(organization.attributes['tenant_id']).toEqual([created.tenantId]);
      expect(await organizationsOf(created.firstAdminUserId)).toEqual([
        expect.objectContaining({ id: created.organizationId }),
      ]);
      expect(
        await harness.count(
          `select 1 from role_assignments role join memberships membership on membership.id = role.membership_id
            where role.tenant_id = $1 and membership.user_id = $2 and role.role = 'tenant_admin'`,
          [created.tenantId, created.firstAdminUserId],
        ),
      ).toBe(1);
      const genesis = await lastAuditEntry(created.tenantId, 'tenants.provision');
      expect(genesis.actor_type).toBe('platform_operator');
      expect(
        await harness.count(
          `select 1 from audit_entries where tenant_id = $1 and seq = 1 and payload ->> 'event' = 'tenants.provision'`,
          [created.tenantId],
        ),
      ).toBe(1);
      expect(genesis.acted_under).toEqual({ grant: 'operator_sign_in' });
      expect(genesis.payload.event).toBe('tenants.provision');
      // Names and emails reach the chain only as commitments.
      expect(genesis.canonical.toString('utf8')).not.toContain('synthetic.test');
      expect(genesis.canonical.toString('utf8')).not.toContain('Synthetic');
    });

    it('a provisioned tenant ends up enrolled in the scheduled jobs', async () => {
      const created = await provisioned('synthetic-enrolled');
      const deadline = Date.now() + 60_000;
      let enrolled = 0;
      while (enrolled === 0 && Date.now() < deadline) {
        enrolled = await harness.count('select 1 from pl_jobs.tenant_enrolment where tenant_id = $1', [
          created.tenantId,
        ]);
        if (enrolled === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      expect(enrolled).toBe(1);
    });

    it('the operator realm demands a second factor: a password alone does not complete the sign-in', async () => {
      const signedIn = await signInOperator(keycloak, await createOperator(keycloak), { withCode: false });
      expect(signedIn.accessToken).toBeNull();
      expect(signedIn.page).toMatch(/name="otp"/);
      const realm = z
        .object({ browserFlow: z.string(), registrationAllowed: z.boolean(), bruteForceProtected: z.boolean() })
        .parse(await keycloak.admin.json(`/${operatorRealmName}`));
      expect(realm).toEqual({
        browserFlow: 'operator browser',
        registrationAllowed: false,
        bruteForceProtected: true,
      });
      const executions = z
        .array(z.object({ providerId: z.string().optional(), requirement: z.string() }))
        .parse(await keycloak.admin.json(`/${operatorRealmName}/authentication/flows/operator%20browser/executions`));
      expect(executions).toContainEqual(
        expect.objectContaining({ providerId: 'auth-otp-form', requirement: 'REQUIRED' }),
      );
    });

    it('provisioning is refused without an operator token, with a staff session, on another listener and for another region', async () => {
      const request = provisioningRequest('synthetic-refused');
      expect(await provision(request, undefined)).toEqual({ status: 401, body: uniform401 });
      const staff = await harness.issue('staff_session', harness.tenantA, { roles: ['tenant_admin'] });
      expect(await provision(request, staff.token)).toEqual({ status: 401, body: uniform401 });
      const token = await operatorToken();
      expect((await provision(request, token, 'staff')).status).toBe(404);
      expect(await provision(provisioningRequest('synthetic-refused', { region: 'eu' }), token)).toEqual({
        status: 422,
        body: { error: 'Unprocessable', message: 'pl.error.unprocessable.regionNotServed', params: {} },
      });
      expect(await harness.count(`select 1 from directory_entries where slug = 'synthetic-refused'`)).toBe(0);
    });

    it('a slug that is taken is refused and leaves no second organization behind', async () => {
      await provisioned('synthetic-taken');
      const again = await provision(
        provisioningRequest('synthetic-taken', {
          firstAdmin: { email: 'other.admin@synthetic.test', displayName: 'Synthetic Other' },
        }),
        await operatorToken(),
      );
      expect(again.status).toBe(409);
      const organizations = organizationRows.parse(
        await keycloak.admin.json(`/${realmName}/organizations?search=synthetic-taken`),
      );
      expect(organizations).toHaveLength(1);
      const users = z
        .array(z.unknown())
        .parse(await keycloak.admin.json(`/${realmName}/users?email=other.admin@synthetic.test`));
      expect(users).toEqual([]);
    });
  });

  it('a leftover organization from an interrupted provisioning does not block provisioning that slug again', async () => {
    const slug = 'synthetic-leftover';
    const email = `admin.${slug}@synthetic.test`;
    // What a provisioning that stopped before its commit leaves: the organization and its first administrator.
    const leftover = await keycloak.admin.createOrganization(slug, randomUUID());
    const stranded = await keycloak.admin.createUser({ username: email, email, password: syntheticPassword() });
    await keycloak.admin.addMember(leftover, stranded);

    const created = await provisioned(slug);
    const organizations = organizationRows
      .parse(await keycloak.admin.json(`/${realmName}/organizations?max=1000`))
      .filter((organization) => organization.alias === slug);
    expect(organizations).toEqual([expect.objectContaining({ id: created.organizationId })]);
    expect(await usersWithEmail(email)).toEqual([{ id: created.firstAdminUserId }]);
  });

  it('the organizations account can manage organizations and their members but cannot create clients or impersonate', async () => {
    const tokenResponse = await fetch(`${keycloak.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${organizationsClientId}:${organizationsSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const token = z.object({ access_token: z.string() }).parse(await tokenResponse.json()).access_token;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${keycloak.baseUrl}/admin/realms/${realmName}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? null : JSON.stringify(body),
      });
    const alias = 'synthetic-account-scope';
    const organization = await call('POST', '/organizations', {
      name: alias,
      alias,
      enabled: true,
      domains: [{ name: `${alias}.tenants.partledger.invalid` }],
    });
    expect(organization.status).toBe(201);
    const organizationId = organization.headers.get('location')?.split('/').pop() ?? '';
    const email = `${alias}@synthetic.test`;
    const user = await call('POST', '/users', { username: email, email, enabled: true });
    expect(user.status).toBe(201);
    const userId = user.headers.get('location')?.split('/').pop() ?? '';
    expect((await call('POST', `/organizations/${organizationId}/members`, userId)).status).toBe(201);
    expect((await call('DELETE', `/organizations/${organizationId}/members/${userId}`)).status).toBe(204);

    // Keycloak enforces these limits: no client changes, and impersonation is off in the server.
    expect((await call('POST', '/clients', { clientId: 'synthetic-rogue-client' })).status).toBe(403);
    // Keycloak 26.4 answers 501 Not Implemented for a feature switched off in the server.
    expect((await call('POST', `/users/${userId}/impersonation`)).status).toBe(501);

    expect((await call('DELETE', `/users/${userId}`)).status).toBe(204);
    expect((await call('DELETE', `/organizations/${organizationId}`)).status).toBe(204);
  });

  describe('members and roles', () => {
    let tenant: z.infer<typeof provisionTenantOutputSchema>;
    let admin: IssuedToken;

    beforeAll(async () => {
      tenant = await provisioned('synthetic-members');
      admin = await harness.issue('staff_session', tenant.tenantId, { subjectId: tenant.firstAdminUserId });
    });

    /** Removes a member as the first administrator, stepped up just now unless told otherwise. */
    async function remove(userId: string, { steppedUp: fresh = true }: { readonly steppedUp?: boolean } = {}) {
      const remover = fresh
        ? await harness.issue('staff_session', tenant.tenantId, {
            subjectId: tenant.firstAdminUserId,
            steppedUpAt: harness.clock.now(),
          })
        : admin;
      return harness.command(
        'staff',
        'members.remove',
        { userId },
        { token: remover.token, idempotencyKey: newIdempotencyKey() },
      );
    }

    async function invite(email: string): Promise<string> {
      const response = await harness.command(
        'staff',
        'members.invite',
        { email, displayName: 'Synthetic Invitee' },
        { token: admin.token, idempotencyKey: newIdempotencyKey() },
      );
      expect(response.status).toBe(200);
      return invited.parse(response.body).userId;
    }

    it('an invited user exists only in the tenant’s organization', async () => {
      await provisioned('synthetic-neighbour');
      const userId = await invite('Invited.Person@Synthetic.Test');
      expect(await organizationsOf(userId)).toEqual([expect.objectContaining({ id: tenant.organizationId })]);
      const [member] = z
        .array(z.object({ email: z.string(), removed_at: z.date().nullable() }))
        .parse(
          (
            await harness.superuser.query(
              'select email, removed_at from memberships where tenant_id = $1 and user_id = $2',
              [tenant.tenantId, userId],
            )
          ).rows,
        );
      expect(member).toEqual({ email: 'invited.person@synthetic.test', removed_at: null });
      const entry = await lastAuditEntry(tenant.tenantId, 'members.invite');
      expect(entry.actor_id).toBe(tenant.firstAdminUserId);
      expect(entry.canonical.toString('utf8')).not.toContain('invited.person');
      const listed = await harness.query('staff', 'members.list', {}, admin.token);
      expect(listed.status).toBe(200);
      const { members } = listMembersQuery.output.parse(listed.body);
      expect(members.find((member) => member.userId === tenant.firstAdminUserId)?.roles).toEqual(['tenant_admin']);
      expect(members.find((member) => member.userId === userId)).toMatchObject({
        email: 'invited.person@synthetic.test',
        roles: [],
      });
      expect(await harness.query('staff', 'tenants.currentMember', {}, admin.token)).toMatchObject({
        status: 200,
        body: {
          tenant: { tenantId: tenant.tenantId, slug: 'synthetic-members', region: 'ca', supplierListSource: 'erp' },
          member: { userId: tenant.firstAdminUserId, displayName: 'Synthetic Administrator', roles: ['tenant_admin'] },
        },
      });
      const again = await harness.command(
        'staff',
        'members.invite',
        { email: 'invited.person@synthetic.test', displayName: 'Synthetic Invitee' },
        { token: admin.token, idempotencyKey: newIdempotencyKey() },
      );
      expect(again.status).toBe(409);
    });

    it('granting or revoking a role writes an audit entry naming the admin who did it', async () => {
      const userId = await invite('role.holder@synthetic.test');
      expect(await changeRole('members.grantRole', tenant.tenantId, admin, userId, 'approver')).toMatchObject({
        kind: 'success',
      });
      const granted = await lastAuditEntry(tenant.tenantId, 'members.grantRole');
      expect(granted).toMatchObject({ actor_type: 'person', actor_id: tenant.firstAdminUserId });
      expect(granted.payload).toMatchObject({
        event: 'members.grantRole',
        data: { changes: [{ member: userId, grantedRole: 'approver' }] },
      });
      expect(await changeRole('members.revokeRole', tenant.tenantId, admin, userId, 'approver')).toMatchObject({
        kind: 'success',
      });
      const revoked = await lastAuditEntry(tenant.tenantId, 'members.revokeRole');
      expect(revoked).toMatchObject({ actor_type: 'person', actor_id: tenant.firstAdminUserId });
      expect(revoked.payload).toMatchObject({
        event: 'members.revokeRole',
        data: { changes: [{ member: userId, revokedRole: 'approver' }] },
      });
    });

    it('a role change without a recent step-up is refused and changes nothing', async () => {
      const userId = await invite('no.step.up@synthetic.test');
      const grants = `select 1 from audit_entries where tenant_id = $1 and payload ->> 'event' = 'members.grantRole'`;
      const before = await harness.count(grants, [tenant.tenantId]);
      const response = await harness.command(
        'staff',
        'members.grantRole',
        { userId, role: 'buyer' },
        { token: admin.token, idempotencyKey: newIdempotencyKey() },
      );
      expect(response).toMatchObject({
        status: 401,
        body: { error: 'StepUpRequired', message: 'pl.error.stepUpRequired.recentAuthentication' },
      });
      expect(
        await harness.count(
          `select 1 from role_assignments role join memberships membership on membership.id = role.membership_id
            where membership.user_id = $1`,
          [userId],
        ),
      ).toBe(0);
      expect(await harness.count(grants, [tenant.tenantId])).toBe(before);
    });

    it('the last tenant administrator can neither be removed nor lose the role', async () => {
      const removal = await remove(tenant.firstAdminUserId);
      expect(removal).toMatchObject({ status: 409, body: { message: 'pl.error.conflict.lastTenantAdmin' } });
      expect(
        await changeRole('members.revokeRole', tenant.tenantId, admin, tenant.firstAdminUserId, 'tenant_admin'),
      ).toMatchObject({ kind: 'failure', error: { _tag: 'Conflict', reason: 'lastTenantAdmin' } });
    });

    it('removing a member without a recent step-up is refused and changes nothing', async () => {
      const userId = await invite('kept.member@synthetic.test');
      await harness.makeMember(tenant.tenantId, userId, ['buyer']);
      const session = await harness.issue('staff_session', tenant.tenantId, { subjectId: userId });
      const removal = await remove(userId, { steppedUp: false });
      expect(removal).toMatchObject({
        status: 401,
        body: { error: 'StepUpRequired', message: 'pl.error.stepUpRequired.recentAuthentication' },
      });
      expect((await harness.query('staff', 'tenants.currentMember', {}, session.token)).status).toBe(200);
      expect(await harness.count('select 1 from memberships where user_id = $1 and removed_at is null', [userId])).toBe(
        1,
      );
      expect(
        await harness.count(
          `select 1 from pl_jobs.job where name = 'members.leaveOrganization' and data -> 'payload' ->> 'userId' = $1`,
          [userId],
        ),
      ).toBe(0);
      expect(await organizationsOf(userId)).toEqual([expect.objectContaining({ id: tenant.organizationId })]);
    });

    it('an invited local account holds the password-account role', async () => {
      const userId = await invite('password.account@synthetic.test');
      const roles = z
        .array(z.object({ name: z.string() }))
        .parse(await keycloak.admin.json(`/${realmName}/users/${userId}/role-mappings/realm`))
        .map((role) => role.name);
      expect(roles).toContain('password-account');
    });

    it('a member removed after a fresh step-up is refused on their next request, loses their organization and cannot sign in again', async () => {
      const userId = await invite('removed.member@synthetic.test');
      await harness.makeMember(tenant.tenantId, userId, ['buyer']);
      const session = await harness.issue('staff_session', tenant.tenantId, { subjectId: userId });
      expect((await harness.query('staff', 'tenants.currentMember', {}, session.token)).status).toBe(200);

      const removal = await remove(userId);
      expect(removal).toMatchObject({ status: 200, body: { userId, endedSessions: 1 } });
      const entry = await lastAuditEntry(tenant.tenantId, 'members.remove');
      expect(entry).toMatchObject({ actor_type: 'person', actor_id: tenant.firstAdminUserId });
      expect(await harness.query('staff', 'tenants.currentMember', {}, session.token)).toEqual(
        expect.objectContaining({ status: 401, body: uniform401 }),
      );
      const ended = sessionEnds.parse(
        (await harness.superuser.query('select end_reason from staff_sessions where subject_id = $1', [userId])).rows,
      );
      expect(ended).toEqual([{ end_reason: 'membership_removed' }]);
      // The organization is left by a job that commits with the removal.
      expect(await eventually(async () => (await organizationsOf(userId)).length === 0)).toBe(true);
      const staffSessions = harness.api.app.get(StaffSessions);
      const identity = {
        subject: userId,
        tenantId: tenant.tenantId,
        organizationId: tenant.organizationId,
        authenticationLevel: null,
        authenticatedAt: null,
      };
      expect(
        await staffSessions.start({ identity, refreshToken: JSON.stringify(identity) }, harness.clock.now()),
      ).toBeNull();
    });

    it('a removed member can be invited again and signs in with their roles granted afresh', async () => {
      const email = 'returning.member@synthetic.test';
      const userId = await invite(email);
      expect(await changeRole('members.grantRole', tenant.tenantId, admin, userId, 'approver')).toMatchObject({
        kind: 'success',
      });
      expect((await remove(userId)).status).toBe(200);
      expect(await eventually(async () => (await organizationsOf(userId)).length === 0)).toBe(true);

      expect(await invite(email)).toBe(userId);
      expect(await organizationsOf(userId)).toEqual([expect.objectContaining({ id: tenant.organizationId })]);
      expect(await usersWithEmail(email)).toHaveLength(1);
      const session = await harness.issue('staff_session', tenant.tenantId, { subjectId: userId });
      // The earlier approver role stayed with the old membership.
      expect((await harness.query('staff', 'tenants.currentMember', {}, session.token)).status).toBe(403);
      expect(await changeRole('members.grantRole', tenant.tenantId, admin, userId, 'buyer')).toMatchObject({
        kind: 'success',
      });
      expect(await harness.query('staff', 'tenants.currentMember', {}, session.token)).toMatchObject({
        status: 200,
        body: { member: { userId, roles: ['buyer'] } },
      });
      expect(
        await harness.count('select 1 from memberships where tenant_id = $1 and user_id = $2', [
          tenant.tenantId,
          userId,
        ]),
      ).toBe(2);
    });

    it('an invitation retried after a failure that followed the account’s creation succeeds with exactly one account', async () => {
      const email = 'retried.invitation@synthetic.test';
      // The invitation's audit entry fails once, after Keycloak has created the account.
      await harness.superuser.query(`
        create sequence synthetic_invite_failures;
        grant usage on sequence synthetic_invite_failures to pl_app;
        create function public.synthetic_fail_first_invite() returns trigger language plpgsql as $$
        begin
          if new.payload ->> 'event' = 'members.invite' and nextval('synthetic_invite_failures') = 1 then
            raise exception 'synthetic failure after the account was created';
          end if;
          return new;
        end $$;
        create trigger synthetic_fail_first_invite before insert on audit_entries
          for each row execute function public.synthetic_fail_first_invite();
      `);
      const idempotencyKey = newIdempotencyKey();
      const body = { email, displayName: 'Synthetic Retry' };
      try {
        const first = await harness.command('staff', 'members.invite', body, { token: admin.token, idempotencyKey });
        expect(first.status).toBe(500);
        expect(await usersWithEmail(email)).toHaveLength(1);
        const retried = await harness.command('staff', 'members.invite', body, { token: admin.token, idempotencyKey });
        expect(retried.status).toBe(200);
        const { userId } = invited.parse(retried.body);
        expect(await usersWithEmail(email)).toEqual([{ id: userId }]);
        expect(await organizationsOf(userId)).toEqual([expect.objectContaining({ id: tenant.organizationId })]);
      } finally {
        await harness.superuser.query(`
          drop trigger synthetic_fail_first_invite on audit_entries;
          drop function public.synthetic_fail_first_invite();
          drop sequence synthetic_invite_failures;
        `);
      }
    });

    it('a user whose approver role was revoked is refused on their next request', async () => {
      const userId = await invite('revoked.approver@synthetic.test');
      await harness.makeMember(tenant.tenantId, userId, ['approver']);
      const approver = await harness.issue('staff_session', tenant.tenantId, { subjectId: userId });
      const buyer = await harness.issue('staff_session', tenant.tenantId, { roles: ['buyer'] });
      const note = createdNote.parse(
        (
          await harness.command(
            'staff',
            'internalTest.createNote',
            { title: 'Synthetic bracket' },
            { token: buyer.token, idempotencyKey: newIdempotencyKey() },
          )
        ).body,
      );
      expect(
        (await harness.query('staff', 'internalTest.getNote', { noteId: note.noteId }, approver.token)).status,
      ).toBe(200);

      expect(await changeRole('members.revokeRole', tenant.tenantId, admin, userId, 'approver')).toMatchObject({
        kind: 'success',
      });
      expect(
        await harness.query('staff', 'internalTest.getNote', { noteId: note.noteId }, approver.token),
      ).toMatchObject({ status: 403, body: { message: 'pl.error.forbidden.notPermitted' } });
      expect(
        await executor.runCommand(
          steppedUp(tenant.tenantId, approver),
          'internalTest.approveNote',
          { noteId: note.noteId, expectedVersion: 1 },
          newIdempotencyKey(),
        ),
      ).toMatchObject({ kind: 'failure', error: { _tag: 'Forbidden', reason: 'notPermitted' } });
    });

    it('deleting a user referenced by audit entries fails', async () => {
      const migrator = await harness.database.connect('pl_migrator');
      try {
        await migrator.query('begin');
        await migrator.query(`select set_config('app.tenant_id', $1, true)`, [tenant.tenantId]);
        await expect(
          migrator.query('delete from memberships where user_id = $1', [tenant.firstAdminUserId]),
        ).rejects.toThrow(/pl\.tenants\.member_referenced/);
      } finally {
        await migrator.query('rollback');
        await migrator.end();
      }
    });
  });

  describe('isolation between tenants', () => {
    it('a user who is an approver in tenant A cannot approve in tenant B', async () => {
      const approver = await harness.issue('staff_session', harness.tenantA, { roles: ['approver'] });
      const buyerA = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
      const buyerB = await harness.issue('staff_session', harness.tenantB, { roles: ['buyer'] });
      const noteIn = async (buyer: IssuedToken) =>
        createdNote.parse(
          (
            await harness.command(
              'staff',
              'internalTest.createNote',
              { title: 'Synthetic flange' },
              { token: buyer.token, idempotencyKey: newIdempotencyKey() },
            )
          ).body,
        ).noteId;
      const noteA = await noteIn(buyerA);
      const noteB = await noteIn(buyerB);

      // The same person, stepped up, acting in tenant B: their roles are read from B's rows, where they hold none.
      const inB: AuthenticatedPrincipal = { ...steppedUp(harness.tenantA, approver), tenantId: harness.tenantB };
      expect(
        await executor.runCommand(
          inB,
          'internalTest.approveNote',
          { noteId: noteB, expectedVersion: 1 },
          newIdempotencyKey(),
        ),
      ).toMatchObject({ kind: 'failure', error: { _tag: 'Forbidden', reason: 'notPermitted' } });
      // Nor can they sign in to tenant B, where they are not a member.
      const identity = {
        subject: approver.subjectId,
        tenantId: harness.tenantB,
        organizationId: 'tenant-b',
        authenticationLevel: null,
        authenticatedAt: null,
      };
      expect(
        await harness.api.app
          .get(StaffSessions)
          .start({ identity, refreshToken: JSON.stringify(identity) }, harness.clock.now()),
      ).toBeNull();
      // In their own tenant the same approval succeeds.
      expect(
        await executor.runCommand(
          steppedUp(harness.tenantA, approver),
          'internalTest.approveNote',
          { noteId: noteA, expectedVersion: 1 },
          newIdempotencyKey(),
        ),
      ).toMatchObject({ kind: 'success' });
    });
  });

  describe('the directory', () => {
    it('a directory lookup returns only the region URL', async () => {
      await provisioned('synthetic-directory');
      const staff = harness.api.listeners.urls.staff;
      const found = await fetch(`${staff}${directoryPath('synthetic-directory')}`);
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({ regionUrl: 'http://127.0.0.1:5173' });
      for (const slug of ['synthetic-unknown', 'Not A Slug']) {
        const missing = await fetch(`${staff}${directoryPath(slug)}`);
        expect(missing.status).toBe(404);
      }
      const elsewhere = await fetch(`${harness.api.listeners.urls.portal}${directoryPath('synthetic-directory')}`);
      expect(elsewhere.status).toBe(404);
    });
  });
});
