import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { productionRegistry } from '../src/commands/query-registry';
import { newIdempotencyKey, startApiHarness, type ApiHarness } from './support/api-harness';
import { placeholderAuthEnvironment } from './support/auth-environment';
import { internalTestRegistry } from './support/internal-test-module';
import {
  adminClientId,
  clientId,
  formOn,
  internalBaseUrl,
  linkOn,
  realmName,
  startKeycloak,
  syntheticPassword,
  type StartedKeycloak,
  type SyntheticUser,
} from './support/keycloak';
import { Authenticator, StaffBrowser, startMailCatcher, type MailCatcher, type Settled } from './support/staff-browser';

const staffAppOrigin = 'http://127.0.0.1:5173';
const refreshIntervalSeconds = 10;
const freshnessSeconds = 60;
const stepUpError = {
  error: 'StepUpRequired',
  message: 'pl.error.stepUpRequired.recentAuthentication',
  params: {},
};
const noteOutput = z.object({ noteId: z.uuid(), version: z.number().int() });
const credentialRows = z.array(z.object({ id: z.string(), type: z.string(), createdDate: z.number() }));
const flowExecutions = z.array(z.object({ providerId: z.string().optional() }));
const resetOutput = z.object({ userId: z.uuid(), endedSessions: z.number() });
const resetChanges = z.tuple([
  z.object({ kind: z.literal('secondFactorReset'), userId: z.uuid(), endedSessions: z.number(), jobId: z.uuid() }),
]);

type KeycloakUser = SyntheticUser & { readonly id: string };

async function eventually(condition: () => Promise<boolean>, timeoutMilliseconds = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('The condition did not hold in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('step-up authentication against Keycloak', () => {
  let keycloak: StartedKeycloak;
  let mail: MailCatcher;
  let harness: ApiHarness;
  let staff: string;
  let organizationA: string;
  let adminClientSecret: string;

  beforeAll(async () => {
    [keycloak, mail] = await Promise.all([
      startKeycloak([join(import.meta.dirname, 'support', 'keycloak', 'customer-idp-realm.json')]),
      startMailCatcher(),
    ]);
    const smtp = await keycloak.admin.request('PUT', `/${realmName}`, {
      smtpServer: { host: mail.smtpHost, port: mail.smtpPort, from: 'keycloak@synthetic.test' },
    });
    expect(smtp.status).toBe(204);
    adminClientSecret = await keycloak.admin.regenerateClientSecret(adminClientId);
    harness = await startApiHarness({
      identityProvider: 'keycloak',
      process: {
        registry: {
          commands: [...internalTestRegistry.commands, ...productionRegistry.commands],
          queries: [...internalTestRegistry.queries, ...productionRegistry.queries],
        },
        // The second-factor reset changes Keycloak from a job.
        workers: true,
      },
      authEnvironment: placeholderAuthEnvironment({
        STAFF_APP_ORIGIN: staffAppOrigin,
        KEYCLOAK_ISSUER: keycloak.issuer,
        KEYCLOAK_CLIENT_SECRET: await keycloak.admin.regenerateClientSecret(clientId),
        KEYCLOAK_ADMIN_CLIENT_SECRET: adminClientSecret,
        KEYCLOAK_JWKS_COOLDOWN_SECONDS: '0',
        STAFF_SESSION_REFRESH_INTERVAL_SECONDS: String(refreshIntervalSeconds),
        STEP_UP_FRESHNESS_SECONDS: String(freshnessSeconds),
      }),
    });
    staff = harness.api.listeners.urls.staff;
    organizationA = await keycloak.admin.createOrganization('tenant-a', harness.tenantA);
  });

  afterAll(async () => {
    await harness.close();
    await Promise.all([keycloak.stop(), mail.stop()]);
  });

  function browser(): StaffBrowser {
    return new StaffBrowser(staff, staffAppOrigin);
  }

  async function member(prefix: string, organizationId = organizationA): Promise<KeycloakUser> {
    const suffix = randomUUID().slice(0, 8);
    const user = {
      username: `${prefix}.${suffix}`,
      email: `${prefix}.${suffix}@synthetic.test`,
      password: syntheticPassword(),
    };
    const id = await keycloak.admin.createUser(user);
    await keycloak.admin.addMember(organizationId, id);
    return { ...user, id };
  }

  async function approver(): Promise<KeycloakUser> {
    const user = await member('synthetic.approver');
    harness.grantRoles(user.id, ['approver']);
    return user;
  }

  async function draftNote(): Promise<string> {
    // A harness session cannot refresh against Keycloak, so each note gets one that is still inside its refresh interval.
    const buyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    const created = await harness.command(
      'staff',
      'internalTest.createNote',
      { title: 'Synthetic bracket awaiting approval' },
      { token: buyer.token, idempotencyKey: newIdempotencyKey() },
    );
    return noteOutput.parse(created.body).noteId;
  }

  async function secondFactorsOf(userId: string) {
    const rows = credentialRows.parse(await keycloak.admin.json(`/${realmName}/users/${userId}/credentials`));
    return rows.filter((row) => row.type === 'otp');
  }

  function approve(session: StaffBrowser, noteId: string, idempotencyKey: string) {
    return session.command('internalTest.approveNote', { noteId, expectedVersion: 1 }, idempotencyKey);
  }

  it('a step-up command without the required acr returns the step-up error', async () => {
    const person = await approver();
    const session = browser();
    await session.signIn(person);
    const noteId = await draftNote();

    const refused = await approve(session, noteId, newIdempotencyKey());
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual(stepUpError);
    expect(
      await harness.count(`select 1 from internal_test_notes where id = $1 and status = 'approved'`, [noteId]),
    ).toBe(0);
    const recorded = await harness.superuser.query(
      'select authentication_level from staff_sessions where subject_id = $1',
      [person.id],
    );
    expect(recorded.rows).toEqual([{ authentication_level: 'sign-in' }]);
  });

  it('with a fresh step-up the command succeeds, after the first step-up enrols a second factor', async () => {
    const person = await approver();
    const session = browser();
    await session.signIn(person);
    expect(await secondFactorsOf(person.id)).toEqual([]);

    const prompt = await session.startStepUp('/notes');
    expect(prompt.kind).toBe('enrol');
    if (prompt.kind !== 'enrol') {
      return;
    }
    const authenticator = new Authenticator(prompt.secret);
    expect(await session.answerStepUp(prompt, authenticator)).toBe(`${staffAppOrigin}/notes`);
    expect(await secondFactorsOf(person.id)).toHaveLength(1);

    const approved = await approve(session, await draftNote(), newIdempotencyKey());
    expect(approved.status).toBe(200);
    expect(noteOutput.parse(approved.body).version).toBe(2);

    // A later step-up asks for a code from the enrolled factor rather than enrolling another.
    const again = await session.startStepUp('/notes');
    expect(again.kind).toBe('code');
    if (again.kind === 'code') {
      expect(await session.answerStepUp(again, authenticator)).toBe(`${staffAppOrigin}/notes`);
    }
    expect(await secondFactorsOf(person.id)).toHaveLength(1);
  });

  it('a step-up older than the freshness window is refused', async () => {
    const person = await approver();
    const session = browser();
    await session.signIn(person);
    await session.stepUp('/notes');
    const noteId = await draftNote();

    harness.clock.advance((freshnessSeconds + 1) * 1000);
    try {
      // The session refreshes against Keycloak on the way, and the refreshed tokens keep the old auth_time.
      const stale = await approve(session, noteId, newIdempotencyKey());
      expect(stale.status).toBe(401);
      expect(stale.body).toEqual(stepUpError);
      expect(await session.sessionStatus()).toBe(200);
    } finally {
      harness.clock.advance(-(freshnessSeconds + 1) * 1000);
    }
  });

  it('retrying after step-up with the same idempotency key performs the action once', async () => {
    const person = await approver();
    const session = browser();
    await session.signIn(person);
    const noteId = await draftNote();
    const idempotencyKey = newIdempotencyKey();
    const entriesBefore = await harness.count(`select 1 from audit_entries where payload->>'event' = $1`, [
      'internalTest.approveNote',
    ]);

    expect((await approve(session, noteId, idempotencyKey)).body).toEqual(stepUpError);
    expect((await session.stepUp('/notes')).location).toBe(`${staffAppOrigin}/notes`);
    const [first, second] = await Promise.all([
      approve(session, noteId, idempotencyKey),
      approve(session, noteId, idempotencyKey),
    ]);
    const third = await approve(session, noteId, idempotencyKey);

    for (const answer of [first, second, third]) {
      expect(answer.status).toBe(200);
      expect(noteOutput.parse(answer.body)).toEqual({ noteId, version: 2 });
    }
    expect(
      [first, second, third].filter((answer) => answer.headers.get('idempotent-replayed') === 'true'),
    ).toHaveLength(2);
    expect(
      await harness.count(`select 1 from internal_test_notes where id = $1 and status = 'approved' and version = 2`, [
        noteId,
      ]),
    ).toBe(1);
    expect(
      await harness.count(`select 1 from audit_entries where payload->>'event' = $1`, ['internalTest.approveNote']),
    ).toBe(entriesBefore + 1);
  });

  let identityProviderReady: Promise<void> | undefined;

  /** The customer realm as an identity provider, set up as the runbook requires. */
  function customerIdentityProvider(): Promise<void> {
    identityProviderReady ??= (async () => {
      const brokerSecret = await keycloak.admin.regenerateClientSecret('partledger-broker', 'customer-idp');
      const created = await keycloak.admin.request('POST', `/${realmName}/identity-provider/instances`, {
        alias: 'customer-idp',
        providerId: 'oidc',
        enabled: true,
        trustEmail: false,
        firstBrokerLoginFlowAlias: 'first broker login',
        postBrokerLoginFlowAlias: 'partledger post broker login',
        config: {
          clientId: 'partledger-broker',
          clientSecret: brokerSecret,
          clientAuthMethod: 'client_secret_post',
          authorizationUrl: `${keycloak.baseUrl}/realms/customer-idp/protocol/openid-connect/auth`,
          tokenUrl: `${internalBaseUrl}/realms/customer-idp/protocol/openid-connect/token`,
          disableUserInfo: 'true',
          validateSignature: 'false',
          defaultScope: 'openid email profile',
          syncMode: 'IMPORT',
        },
      });
      expect(created.status).toBe(201);
    })();
    return identityProviderReady;
  }

  /** A customer's user, and the linked Partledger account a tenant admin invited (U8): no password, no factor. */
  async function brokeredApprover(): Promise<{ readonly customerUser: SyntheticUser; readonly id: string }> {
    await customerIdentityProvider();
    const suffix = randomUUID().slice(0, 8);
    const customerUser = {
      username: `synthetic.sso.${suffix}`,
      email: `synthetic.sso.${suffix}@customer.synthetic.test`,
      password: syntheticPassword(),
    };
    const customerUserId = await keycloak.admin.createUser(customerUser, 'customer-idp');
    const invited = await keycloak.admin.request('POST', `/${realmName}/users`, {
      username: customerUser.username,
      email: customerUser.email,
      firstName: 'Synthetic',
      lastName: 'Person',
      enabled: true,
      emailVerified: true,
    });
    const id = invited.headers.get('location')?.split('/').pop() ?? '';
    const linked = await keycloak.admin.request('POST', `/${realmName}/users/${id}/federated-identity/customer-idp`, {
      identityProvider: 'customer-idp',
      userId: customerUserId,
      userName: customerUser.username,
    });
    expect(linked.status).toBe(204);
    await keycloak.admin.addMember(organizationA, id);
    harness.grantRoles(id, ['approver']);
    return { customerUser, id };
  }

  async function credentialsOf(userId: string) {
    return credentialRows.parse(await keycloak.admin.json(`/${realmName}/users/${userId}/credentials`));
  }

  /**
   * Runs the realm's forgot-password flow for `username` with forgot-password switched on for
   * the test, as someone who controls the mailbox would, up to the page the e-mailed link opens.
   */
  async function forgotPassword(session: StaffBrowser, username: string, email: string): Promise<Settled> {
    const enabled = await keycloak.admin.request('PUT', `/${realmName}`, { resetPasswordAllowed: true });
    expect(enabled.status).toBe(204);
    try {
      const identify = await session.startSignIn();
      const passwordPage = await session.submit(
        await identify.response.text(),
        /login-actions\/authenticate/,
        { username },
        identify.url,
      );
      const forgot = linkOn(await passwordPage.response.text(), /login-actions\/reset-credentials/);
      expect(forgot).not.toBeNull();
      const resetUrl = new URL(forgot ?? '', passwordPage.url).toString();
      const resetForm = await session.settle(await session.browser.get(resetUrl), resetUrl);
      await session.submit(await resetForm.response.text(), /reset-credentials/, { username }, resetUrl);
      const link = /(http\S+action-token\S+)/.exec(await mail.latestTextTo(email))?.[1] ?? '';
      return await session.settle(await session.browser.get(link), link);
    } finally {
      await keycloak.admin.request('PUT', `/${realmName}`, { resetPasswordAllowed: false });
    }
  }

  it('a brokered SSO user is asked to enrol a factor before the first step-up succeeds', async () => {
    const { customerUser, id: brokeredId } = await brokeredApprover();
    expect(await credentialsOf(brokeredId)).toEqual([]);

    const session = browser();
    await session.signInThroughBroker(customerUser, 'customer-idp');
    const noteId = await draftNote();
    expect((await approve(session, noteId, newIdempotencyKey())).body).toEqual(stepUpError);

    const prompt = await session.startStepUp('/notes');
    expect(prompt.kind).toBe('enrol');
    if (prompt.kind !== 'enrol') {
      return;
    }
    expect(await session.answerStepUp(prompt, new Authenticator(prompt.secret))).toBe(`${staffAppOrigin}/notes`);
    expect(await secondFactorsOf(brokeredId)).toHaveLength(1);
    expect((await approve(session, noteId, newIdempotencyKey())).status).toBe(200);
  });

  it('the sign-in pages offer no forgot-password, and the reset flow has no second-factor reset', async () => {
    const person = await approver();
    const session = browser();
    const identify = await session.startSignIn();
    const identifyHtml = await identify.response.text();
    expect(linkOn(identifyHtml, /reset-credentials/)).toBeNull();
    const passwordPage = await session.submit(
      identifyHtml,
      /login-actions\/authenticate/,
      { username: person.username },
      identify.url,
    );
    const passwordHtml = await passwordPage.response.text();
    expect(formOn(passwordHtml, /login-actions\/authenticate/)?.fields).toHaveProperty('password');
    expect(linkOn(passwordHtml, /reset-credentials/)).toBeNull();
    const direct = await session.browser.get(
      `${keycloak.issuer}/login-actions/reset-credentials?client_id=${clientId}`,
    );
    expect(await direct.text()).not.toContain('name="username"');

    const realm = z
      .object({ resetPasswordAllowed: z.boolean(), resetCredentialsFlow: z.string() })
      .parse(await keycloak.admin.json(`/${realmName}`));
    expect(realm).toEqual({ resetPasswordAllowed: false, resetCredentialsFlow: 'partledger reset credentials' });
    const executions = flowExecutions.parse(
      await keycloak.admin.json(`/${realmName}/authentication/flows/partledger%20reset%20credentials/executions`),
    );
    const providers = executions.map((execution) => execution.providerId);
    expect(providers).not.toContain('reset-otp');
    expect(providers).toEqual(
      expect.arrayContaining(['reset-credentials-choose-user', 'reset-credential-email', 'reset-password']),
    );
  });

  it('a brokered user cannot obtain a Keycloak password through the reset flow, even with forgot-password on', async () => {
    const { customerUser, id: brokeredId } = await brokeredApprover();
    const attacker = browser();
    const landing = await forgotPassword(attacker, customerUser.username, customerUser.email);
    // The e-mailed link ends in Keycloak's access-denied page instead of the new-password form.
    expect(landing.response.status).toBe(401);
    const page = await landing.response.text();
    expect(page).toContain('data-page-id="login-error"');
    expect(formOn(page, /required-action/)?.fields['password-new']).toBeUndefined();
    expect(landing.url.startsWith(staffAppOrigin)).toBe(false);
    expect(await credentialsOf(brokeredId)).toEqual([]);
    expect(attacker.sessionCookie()).toBeUndefined();
  });

  it('the forgot-password flow cannot remove or replace a second factor', async () => {
    const person = await approver();
    const first = browser();
    await first.signIn(person);
    const { authenticator } = await first.stepUp('/notes');
    const factorsBefore = await secondFactorsOf(person.id);
    expect(factorsBefore).toHaveLength(1);
    // A local account, invited with the password-account role (U8).
    await keycloak.admin.grantRealmRole(person.id, 'password-account');

    // Someone who controls the mailbox resets the password, were forgot-password switched on.
    const other = browser();
    const update = await forgotPassword(other, person.username, person.email);
    const newPassword = syntheticPassword();
    const afterReset = await other.submit(
      await update.response.text(),
      /required-action/,
      { 'password-new': newPassword, 'password-confirm': newPassword },
      update.url,
    );
    expect(await other.deliverCallback(afterReset)).not.toBeNull();

    // The password changed; the second factor did not, and the new session holds no step-up.
    expect(await secondFactorsOf(person.id)).toEqual(factorsBefore);
    const noteId = await draftNote();
    expect((await approve(other, noteId, newIdempotencyKey())).body).toEqual(stepUpError);
    // The reset counts for no level, so Keycloak asks for the new password, then a code from the old factor.
    const passwordPrompt = await other.startStepUp('/notes');
    expect(passwordPrompt.kind).toBe('password');
    if (passwordPrompt.kind === 'refused') {
      return;
    }
    const prompt = await other.answerPassword(passwordPrompt, newPassword);
    expect(prompt.kind).toBe('code');
    if (prompt.kind === 'code') {
      expect(await other.answerStepUp(prompt, authenticator)).toBe(`${staffAppOrigin}/notes`);
    }
    expect(await secondFactorsOf(person.id)).toEqual(factorsBefore);
    expect((await approve(other, noteId, newIdempotencyKey())).status).toBe(200);
  });

  it("a second-factor reset writes an audit entry naming the admin and ends the user's sessions", async () => {
    const person = await approver();
    const personSession = browser();
    await personSession.signIn(person);
    await personSession.stepUp('/notes');
    expect(await secondFactorsOf(person.id)).toHaveLength(1);
    expect(await keycloak.admin.userSessionCount(person.id)).toBeGreaterThan(0);

    const admin = await member('synthetic.admin');
    harness.grantRoles(admin.id, ['tenant_admin']);
    const adminSession = browser();
    await adminSession.signIn(admin);
    const idempotencyKey = newIdempotencyKey();
    const withoutStepUp = await adminSession.command('auth.resetSecondFactor', { userId: person.id }, idempotencyKey);
    expect(withoutStepUp.body).toEqual(stepUpError);
    await adminSession.stepUp('/admin/users');

    const reset = await adminSession.command('auth.resetSecondFactor', { userId: person.id }, idempotencyKey);
    expect(reset.status).toBe(200);
    expect(resetOutput.parse(reset.body)).toEqual({ userId: person.id, endedSessions: 1 });

    // The staff session ends with the command; Keycloak changes when the job it enqueued runs.
    expect(await personSession.sessionStatus()).toBe(401);
    const sessions = await harness.superuser.query('select end_reason from staff_sessions where subject_id = $1', [
      person.id,
    ]);
    expect(sessions.rows).toEqual([{ end_reason: 'second_factor_reset' }]);
    await eventually(async () => (await secondFactorsOf(person.id)).length === 0);
    await eventually(async () => (await keycloak.admin.userSessionCount(person.id)) === 0);

    const commandEntries = await harness.superuser.query(
      `select actor_type, actor_id, payload->'data'->'changes' as changes
         from audit_entries where payload->>'event' = 'auth.resetSecondFactor'`,
    );
    const [commandEntry] = z
      .tuple([z.object({ actor_type: z.string(), actor_id: z.string(), changes: resetChanges })])
      .parse(commandEntries.rows);
    expect(commandEntry).toMatchObject({ actor_type: 'person', actor_id: admin.id });
    const [change] = commandEntry.changes;
    expect(change).toMatchObject({ kind: 'secondFactorReset', userId: person.id, endedSessions: 1 });
    await eventually(
      async () =>
        (await harness.count(`select 1 from audit_entries where payload->>'event' = 'auth.secondFactorRemoved'`)) === 1,
    );
    const jobEntries = await harness.superuser.query(
      `select actor_type, acted_under->>'jobId' as job_id, payload->'data' as data
         from audit_entries where payload->>'event' = 'auth.secondFactorRemoved'`,
    );
    expect(jobEntries.rows).toEqual([
      { actor_type: 'system', job_id: change.jobId, data: { userId: person.id, removedFactors: 1 } },
    ]);

    // The user signs in again and enrols a new factor at their next step-up.
    const again = browser();
    await again.signIn(person);
    expect((await again.startStepUp('/notes')).kind).toBe('enrol');
  });

  it("a second-factor reset refuses the admin's own factor, users outside the admin's tenant and users of several tenants", async () => {
    const admin = await member('synthetic.admin');
    harness.grantRoles(admin.id, ['tenant_admin']);
    const adminSession = browser();
    await adminSession.signIn(admin);
    await adminSession.stepUp('/admin/users');

    const own = await adminSession.command('auth.resetSecondFactor', { userId: admin.id }, newIdempotencyKey());
    expect(own.status).toBe(403);
    const organizationB = await keycloak.admin.createOrganization('tenant-b', harness.tenantB);

    // A user of this tenant who also belongs to another keeps their sessions there, so the reset is refused.
    const shared = await approver();
    await browser().signIn(shared);
    await keycloak.admin.addMember(organizationB, shared.id);
    const refusedShared = await adminSession.command(
      'auth.resetSecondFactor',
      { userId: shared.id },
      newIdempotencyKey(),
    );
    expect(refusedShared.status).toBe(403);
    expect(refusedShared.body).toEqual({
      error: 'Forbidden',
      message: 'pl.error.forbidden.notPermitted',
      params: { resource: 'user' },
    });
    expect(
      await harness.count('select 1 from staff_sessions where subject_id = $1 and ended_at is not null', [shared.id]),
    ).toBe(0);

    const stranger = await member('synthetic.stranger', organizationB);
    const elsewhere = await adminSession.command(
      'auth.resetSecondFactor',
      { userId: stranger.id },
      newIdempotencyKey(),
    );
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body).toEqual({
      error: 'NotFound',
      message: 'pl.error.notFound.resource',
      params: { resource: 'user' },
    });
    expect(
      await harness.count(
        `select 1 from audit_entries where payload->>'event' = 'auth.resetSecondFactor' and actor_id = $1`,
        [admin.id],
      ),
    ).toBe(0);
  });

  it("the API's service account can reset second factors but cannot change the realm, its clients or organizations", async () => {
    const tokenResponse = await fetch(`${keycloak.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${adminClientId}:${adminClientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const serviceToken = z.object({ access_token: z.string() }).parse(await tokenResponse.json()).access_token;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${keycloak.baseUrl}/admin/realms/${realmName}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${serviceToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? null : JSON.stringify(body),
      });
    const person = await approver();

    // What the second-factor reset uses.
    expect((await call('GET', `/users/${person.id}/credentials`)).status).toBe(200);
    expect((await call('POST', `/users/${person.id}/logout`)).status).toBe(204);
    expect((await call('GET', `/organizations/members/${person.id}/organizations`)).status).toBe(200);

    // Beyond users: the realm, its flows, clients, identity providers, roles and organizations.
    expect((await call('PUT', '', { resetPasswordAllowed: true })).status).toBe(403);
    expect((await call('GET', '/authentication/flows')).status).toBe(403);
    expect((await call('GET', '/clients')).status).toBe(403);
    expect((await call('GET', '/identity-provider/instances')).status).toBe(403);
    expect((await call('POST', '/roles', { name: 'synthetic-role' })).status).toBe(403);
    expect((await call('POST', `/organizations/${organizationA}/members`, person.id)).status).toBe(403);
    expect((await call('POST', '/organizations', { name: 'Synthetic', alias: 'synthetic-rogue' })).status).toBe(403);
    expect((await call('POST', `/users/${person.id}/impersonation`)).ok).toBe(false);
    expect(await keycloak.admin.userSessionCount(person.id)).toBe(0);
  });

  it('a step-up of a session that has ended is refused without re-authenticating', async () => {
    const person = await approver();
    const session = browser();
    await session.signIn(person);
    const cookie = session.sessionCookie() ?? '';
    const signedOut = await fetch(`${staff}/api/v1/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: `__Host-pl_session=${cookie}`, 'x-partledger-request': 'staff-app' },
    });
    expect(signedOut.status).toBe(204);
    const prompt = await session.startStepUp('/notes?tab=approval');
    expect(prompt).toEqual({ kind: 'refused', location: `${staffAppOrigin}/notes?tab=approval&stepUp=failed` });
  });
});
