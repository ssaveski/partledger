import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { commandPath, staffAuthPaths, staffRequestHeader, staffSessionSchema } from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sessionCookieName, signInCookieName } from '../src/auth/session-cookie';
import { newIdempotencyKey, startApiHarness, type ApiHarness } from './support/api-harness';
import { placeholderAuthEnvironment } from './support/auth-environment';
import {
  clientId,
  formOn,
  internalBaseUrl,
  linkOn,
  realmName,
  startKeycloak,
  syntheticPassword,
  TestBrowser,
  type StartedKeycloak,
  type SyntheticUser,
} from './support/keycloak';

const staffAppOrigin = 'http://127.0.0.1:5173';
const refreshIntervalSeconds = 10;
const uniform401 = { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} };
const signInFailedUrl = `${staffAppOrigin}/?signIn=failed`;
const createdNote = z.object({ noteId: z.uuid(), version: z.number().int() });
const endedSessions = z.array(z.object({ end_reason: z.string().nullable() }));
const componentRows = z.array(
  z.object({ id: z.string(), name: z.string(), providerId: z.string(), config: z.record(z.string(), z.unknown()) }),
);
const keySet = z.object({ keys: z.array(z.object({ kid: z.string(), use: z.string().optional() })) });

interface SignedIn {
  readonly browser: TestBrowser;
  /** The callback's response, or `null` when Keycloak never redirected back. */
  readonly callback: Response | null;
  /** The last Keycloak page when it never redirected back. */
  readonly page: string;
}

describe('staff sign-in and sessions against Keycloak', () => {
  let keycloak: StartedKeycloak;
  let harness: ApiHarness;
  let staff: string;
  let organizationA: string;
  let buyer: SyntheticUser & { readonly id: string };

  beforeAll(async () => {
    keycloak = await startKeycloak([join(import.meta.dirname, 'support', 'keycloak', 'customer-idp-realm.json')]);
    const clientSecret = await keycloak.admin.regenerateClientSecret(clientId);
    harness = await startApiHarness({
      identityProvider: 'keycloak',
      authEnvironment: placeholderAuthEnvironment({
        STAFF_APP_ORIGIN: staffAppOrigin,
        KEYCLOAK_ISSUER: keycloak.issuer,
        KEYCLOAK_CLIENT_SECRET: clientSecret,
        KEYCLOAK_JWKS_COOLDOWN_SECONDS: '0',
        STAFF_SESSION_REFRESH_INTERVAL_SECONDS: String(refreshIntervalSeconds),
      }),
    });
    staff = harness.api.listeners.urls.staff;
    organizationA = await keycloak.admin.createOrganization('tenant-a', harness.tenantA);
    buyer = await memberOf(organizationA, 'synthetic.buyer');
    harness.grantRoles(buyer.id, ['buyer']);
  });

  afterAll(async () => {
    await harness.close();
    await keycloak.stop();
  });

  async function syntheticUser(prefix: string, enabled = true): Promise<SyntheticUser & { readonly id: string }> {
    const suffix = randomUUID().slice(0, 8);
    const user = {
      username: `${prefix}.${suffix}`,
      email: `${prefix}.${suffix}@synthetic.test`,
      password: syntheticPassword(),
      enabled,
    };
    return { ...user, id: await keycloak.admin.createUser(user) };
  }

  async function memberOf(organizationId: string, prefix: string): Promise<SyntheticUser & { readonly id: string }> {
    const user = await syntheticUser(prefix);
    await keycloak.admin.addMember(organizationId, user.id);
    return user;
  }

  /** Follows Keycloak's redirects until it answers with a page or redirects to the staff app. */
  async function settle(
    browser: TestBrowser,
    first: Response,
    url: string,
  ): Promise<{ response: Response; url: string }> {
    let response = first;
    let current = url;
    for (let hops = 0; hops < 10; hops += 1) {
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || location === null) {
        return { response, url: current };
      }
      current = new URL(location, current).toString();
      if (current.startsWith(staffAppOrigin)) {
        return { response, url: current };
      }
      response = await browser.get(current);
    }
    throw new Error('Too many redirects');
  }

  async function startSignIn(browser: TestBrowser, returnTo = '/rfqs'): Promise<string> {
    const start = await browser.get(`${staff}${staffAuthPaths.signIn}?returnTo=${encodeURIComponent(returnTo)}`);
    expect(start.status).toBe(303);
    const location = start.headers.get('location') ?? '';
    expect(location.startsWith(`${keycloak.issuer}/protocol/openid-connect/auth?`)).toBe(true);
    return location;
  }

  async function submitLogin(browser: TestBrowser, page: string, user: SyntheticUser, url: string) {
    const form = formOn(page, /login-actions\/authenticate/);
    if (form === null) {
      throw new Error('No login form on the page');
    }
    const submitted = await browser.post(form.action, {
      ...form.fields,
      username: user.username,
      password: user.password,
    });
    const settled = await settle(browser, submitted, url);
    if (!('username' in form.fields) || settled.response.status !== 200) {
      return settled;
    }
    // With organizations enabled, Keycloak identifies the user first and asks for the password on a second page.
    const nextPage = await settled.response.text();
    const passwordForm = formOn(nextPage, /login-actions\/authenticate/);
    if (passwordForm === null || 'username' in passwordForm.fields || !('password' in passwordForm.fields)) {
      return { response: new Response(nextPage, { status: 200 }), url: settled.url };
    }
    return settle(
      browser,
      await browser.post(passwordForm.action, { ...passwordForm.fields, password: user.password }),
      url,
    );
  }

  async function completeAtCallback(
    browser: TestBrowser,
    settled: { response: Response; url: string },
  ): Promise<SignedIn> {
    if (!settled.url.startsWith(`${staffAppOrigin}${staffAuthPaths.callback}`)) {
      return { browser, callback: null, page: await settled.response.text() };
    }
    // Keycloak sends the browser to the staff app's origin, whose /api proxy reaches this listener.
    const callback = await browser.get(settled.url.replace(staffAppOrigin, staff));
    return { browser, callback, page: '' };
  }

  async function signIn(user: SyntheticUser, returnTo = '/rfqs'): Promise<SignedIn> {
    const browser = new TestBrowser();
    const authorizationUrl = await startSignIn(browser, returnTo);
    const loginPage = await browser.get(authorizationUrl);
    return completeAtCallback(browser, await submitLogin(browser, await loginPage.text(), user, authorizationUrl));
  }

  function sessionCookieOf(signedIn: SignedIn): string {
    const value = signedIn.browser.cookie(`${staff}/`, sessionCookieName);
    if (value === undefined) {
      throw new Error('No session cookie');
    }
    return value;
  }

  function readSession(cookie: string | undefined) {
    return fetch(`${staff}${staffAuthPaths.session}`, {
      headers: cookie === undefined ? {} : { cookie: `${sessionCookieName}=${cookie}` },
    });
  }

  function createNote(cookie: string, title: string, headers: Record<string, string> = {}) {
    return fetch(`${staff}${commandPath('internalTest.createNote')}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${sessionCookieName}=${cookie}`,
        'idempotency-key': newIdempotencyKey(),
        ...headers,
      },
      body: JSON.stringify({ title }),
    });
  }

  function signOut(cookie: string, headers: Record<string, string>) {
    return fetch(`${staff}${staffAuthPaths.signOut}`, {
      method: 'POST',
      headers: { cookie: `${sessionCookieName}=${cookie}`, ...headers },
    });
  }

  const staffHeader = { [staffRequestHeader.name]: staffRequestHeader.value };

  it('E2E: a synthetic buyer signs in, acts and signs out, after which the session is refused', async () => {
    const signedIn = await signIn(buyer);
    expect(signedIn.callback?.status).toBe(303);
    expect(signedIn.callback?.headers.get('location')).toBe(`${staffAppOrigin}/rfqs`);
    const cookie = sessionCookieOf(signedIn);

    const session = await readSession(cookie);
    expect(session.status).toBe(200);
    expect(session.headers.get('cache-control')).toBe('no-store');
    expect(staffSessionSchema.parse(await session.json())).toMatchObject({
      userId: buyer.id,
      tenantId: harness.tenantA,
    });

    const created = await createNote(cookie, 'Signed-in synthetic note', staffHeader);
    expect(created.status).toBe(200);
    createdNote.parse(await created.json());
    expect(await keycloak.admin.userSessionCount(buyer.id)).toBeGreaterThan(0);

    const signedOut = await signOut(cookie, staffHeader);
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie()).toEqual([
      `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    ]);

    const afterSignOut = await readSession(cookie);
    expect(afterSignOut.status).toBe(401);
    expect(await afterSignOut.json()).toEqual(uniform401);
    const refusedCommand = await createNote(cookie, 'Signed-out synthetic note', staffHeader);
    expect(refusedCommand.status).toBe(401);
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Signed-out synthetic note'`)).toBe(0);
    expect(await keycloak.admin.userSessionCount(buyer.id)).toBe(0);
  });

  it('the session cookie is __Host-, HttpOnly, Secure and SameSite=Strict, and the sign-in cookie is cleared', async () => {
    const signedIn = await signIn(buyer);
    const cookies = signedIn.callback?.headers.getSetCookie() ?? [];
    expect(cookies).toContain(`${signInCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    const session = cookies.find((cookie) => cookie.startsWith(`${sessionCookieName}=`)) ?? '';
    expect(session).toMatch(
      /^__Host-pl_session=pls_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}; Path=\/; Max-Age=36000; HttpOnly; Secure; SameSite=Strict$/,
    );
    expect(session.toLowerCase()).not.toContain('domain=');
  });

  it('the sign-in redirect asks for the code flow with PKCE and sets a Lax, HttpOnly state cookie', async () => {
    const browser = new TestBrowser();
    const start = await browser.get(`${staff}${staffAuthPaths.signIn}?returnTo=%2Frfqs`);
    const authorization = new URL(start.headers.get('location') ?? '');
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid organization',
      redirect_uri: `${staffAppOrigin}${staffAuthPaths.callback}`,
      code_challenge_method: 'S256',
    });
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start.headers.getSetCookie()[0]).toMatch(
      /^__Host-pl_sign_in=[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('a return path on another origin is replaced by the staff app root', async () => {
    const signedIn = await signIn(buyer, '//attacker.example/steal');
    expect(signedIn.callback?.headers.get('location')).toBe(`${staffAppOrigin}/`);
  });

  it('a callback whose state does not match its sign-in cookie is refused and starts no session', async () => {
    const browser = new TestBrowser();
    const authorizationUrl = await startSignIn(browser);
    const loginPage = await browser.get(authorizationUrl);
    const settled = await submitLogin(browser, await loginPage.text(), buyer, authorizationUrl);
    const forged = new URL(settled.url);
    forged.searchParams.set('state', 'A'.repeat(43));
    const callback = await browser.get(forged.toString().replace(staffAppOrigin, staff));
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(signInFailedUrl);
    expect(browser.cookie(`${staff}/`, sessionCookieName)).toBeUndefined();

    const withoutCookie = await fetch(settled.url.replace(staffAppOrigin, staff), { redirect: 'manual' });
    expect(withoutCookie.headers.get('location')).toBe(signInFailedUrl);
    expect(withoutCookie.headers.getSetCookie().some((cookie) => cookie.startsWith(`${sessionCookieName}=pls_`))).toBe(
      false,
    );
  });

  it('a user in no organization is refused at sign-in and gets no session', async () => {
    const loner = await syntheticUser('synthetic.loner');
    const signedIn = await signIn(loner);
    expect(signedIn.callback?.status).toBe(303);
    expect(signedIn.callback?.headers.get('location')).toBe(signInFailedUrl);
    expect(signedIn.browser.cookie(`${staff}/`, sessionCookieName)).toBeUndefined();
  });

  it('a user whose organization names no tenant, or a tenant unknown here, is refused', async () => {
    for (const tenantId of [null, randomUUID()]) {
      const organization = await keycloak.admin.createOrganization(`org-${randomUUID().slice(0, 8)}`, tenantId);
      const member = await memberOf(organization, 'synthetic.orphan');
      const signedIn = await signIn(member);
      expect(signedIn.callback?.headers.get('location'), String(tenantId)).toBe(signInFailedUrl);
      expect(signedIn.browser.cookie(`${staff}/`, sessionCookieName)).toBeUndefined();
    }
  });

  it('a state-changing request without the staff request header is refused', async () => {
    const cookie = sessionCookieOf(await signIn(buyer));
    const response = await createNote(cookie, 'Cross-site synthetic note');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Forbidden',
      message: 'pl.error.forbidden.crossSiteRequest',
      params: {},
    });
    expect(await harness.count(`select 1 from internal_test_notes where title = 'Cross-site synthetic note'`)).toBe(0);
    const refusedSignOut = await signOut(cookie, { [staffRequestHeader.name]: 'another-site' });
    expect(refusedSignOut.status).toBe(403);
    expect((await readSession(cookie)).status).toBe(200);
  });

  it('a staff session sent as a bearer token is refused on the staff listener', async () => {
    const cookie = sessionCookieOf(await signIn(buyer));
    const response = await fetch(`${staff}${staffAuthPaths.session}`, {
      headers: { authorization: `Bearer ${cookie}` },
    });
    expect(response.status).toBe(401);
    const command = await fetch(`${staff}${commandPath('internalTest.createNote')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cookie}`, ...staffHeader },
      body: JSON.stringify({ title: 'Bearer synthetic note' }),
    });
    expect(command.status).toBe(401);
  });

  it('a user disabled in Keycloak is refused on the next request after the refresh interval', async () => {
    const member = await memberOf(organizationA, 'synthetic.leaver');
    const cookie = sessionCookieOf(await signIn(member));
    expect((await readSession(cookie)).status).toBe(200);

    await keycloak.admin.setUserEnabled(member.id, false);
    // Within the refresh interval the session stands; the interval bounds how long a disabled user keeps access.
    expect((await readSession(cookie)).status).toBe(200);
    harness.clock.advance((refreshIntervalSeconds + 1) * 1000);
    const refused = await readSession(cookie);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual(uniform401);

    const rows = endedSessions.parse(
      (await harness.superuser.query('select end_reason from staff_sessions where subject_id = $1', [member.id])).rows,
    );
    expect(rows).toEqual([{ end_reason: 'refresh_failed' }]);
  });

  it('a session refreshes against Keycloak after the refresh interval and keeps working', async () => {
    const cookie = sessionCookieOf(await signIn(buyer));
    harness.clock.advance((refreshIntervalSeconds + 1) * 1000);
    expect((await readSession(cookie)).status).toBe(200);
    const created = await createNote(cookie, 'Refreshed synthetic note', staffHeader);
    expect(created.status).toBe(200);
  });

  it('after signing-key rotation, new tokens validate once the JWKS cache refreshes', async () => {
    const before = sessionCookieOf(await signIn(buyer));
    const realm = z.object({ id: z.string() }).parse(await keycloak.admin.json(`/${realmName}`));
    const keyProviders = componentRows.parse(
      await keycloak.admin.json(`/${realmName}/components?type=org.keycloak.keys.KeyProvider`),
    );
    const oldKids = new Set(
      keySet
        .parse(await (await fetch(`${keycloak.issuer}/protocol/openid-connect/certs`)).json())
        .keys.map((key) => key.kid),
    );
    const added = await keycloak.admin.request('POST', `/${realmName}/components`, {
      name: 'rotated-rsa',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      parentId: realm.id,
      config: { priority: ['1000'], algorithm: ['RS256'], enabled: ['true'], active: ['true'], keySize: ['2048'] },
    });
    expect(added.status).toBe(201);
    for (const provider of keyProviders.filter((candidate) => candidate.providerId === 'rsa-generated')) {
      const removed = await keycloak.admin.request('DELETE', `/${realmName}/components/${provider.id}`);
      expect(removed.status).toBe(204);
    }
    const newKids = keySet
      .parse(await (await fetch(`${keycloak.issuer}/protocol/openid-connect/certs`)).json())
      .keys.map((key) => key.kid)
      .filter((kid) => !oldKids.has(kid));
    expect(newKids.length).toBeGreaterThan(0);

    const after = await signIn(buyer);
    expect(after.callback?.headers.get('location')).toBe(`${staffAppOrigin}/rfqs`);
    expect((await readSession(sessionCookieOf(after))).status).toBe(200);
    // A session from before the rotation refreshes onto tokens signed with the new key.
    harness.clock.advance((refreshIntervalSeconds + 1) * 1000);
    expect((await readSession(before)).status).toBe(200);
  });

  it('repeated failed sign-ins trigger the brute-force lockout', async () => {
    const member = await memberOf(organizationA, 'synthetic.guesser');
    const browser = new TestBrowser();
    const authorizationUrl = await startSignIn(browser);
    let page = await (await browser.get(authorizationUrl)).text();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const settled = await submitLogin(
        browser,
        page,
        { ...member, password: `wrong-${String(attempt)}` },
        authorizationUrl,
      );
      page = await settled.response.text();
    }
    const withRightPassword = await completeAtCallback(
      browser,
      await submitLogin(browser, page, member, authorizationUrl),
    );
    expect(withRightPassword.callback).toBeNull();
    const status = z
      .object({ disabled: z.boolean(), numFailures: z.number() })
      .parse(await keycloak.admin.json(`/${realmName}/attack-detection/brute-force/users/${member.id}`));
    expect(status.disabled).toBe(true);
  });

  it('a brokered login whose email matches an existing account is not linked automatically', async () => {
    const existing = await memberOf(organizationA, 'synthetic.existing');
    const brokerSecret = await keycloak.admin.regenerateClientSecret('partledger-broker', 'customer-idp');
    await keycloak.admin.createUser(
      { username: 'synthetic.brokered', email: existing.email, password: existing.password },
      'customer-idp',
    );
    const created = await keycloak.admin.request('POST', `/${realmName}/identity-provider/instances`, {
      alias: 'customer-idp',
      providerId: 'oidc',
      enabled: true,
      trustEmail: false,
      firstBrokerLoginFlowAlias: 'first broker login',
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

    const browser = new TestBrowser();
    const authorizationUrl = await startSignIn(browser);
    const loginPage = await (await browser.get(authorizationUrl)).text();
    const brokerLink = linkOn(loginPage, /\/broker\/customer-idp\/login/);
    expect(brokerLink).not.toBeNull();
    const brokerUrl = new URL(brokerLink ?? '', authorizationUrl).toString();
    const idpPage = await settle(browser, await browser.get(brokerUrl), brokerUrl);
    let settled = await submitLogin(
      browser,
      await idpPage.response.text(),
      { username: 'synthetic.brokered', email: existing.email, password: existing.password },
      idpPage.url,
    );
    let page = await settled.response.text();
    const reviewForm = formOn(page, /first-broker-login/);
    if (reviewForm !== null && !page.includes('value="linkAccount"')) {
      settled = await settle(browser, await browser.post(reviewForm.action, reviewForm.fields), settled.url);
      page = await settled.response.text();
    }

    expect(settled.url.startsWith(staffAppOrigin)).toBe(false);
    expect(page).toContain('value="linkAccount"');
    expect(await keycloak.admin.json(`/${realmName}/users/${existing.id}/federated-identity`)).toEqual([]);
  });

  it('the realm disables impersonation and automatic linking by email, and records admin events', async () => {
    const realm = z
      .object({ bruteForceProtected: z.boolean(), adminEventsEnabled: z.boolean(), organizationsEnabled: z.boolean() })
      .parse(await keycloak.admin.json(`/${realmName}`));
    expect(realm).toEqual({ bruteForceProtected: true, adminEventsEnabled: true, organizationsEnabled: true });

    const impersonation = await keycloak.admin.request('POST', `/${realmName}/users/${buyer.id}/impersonation`);
    expect(impersonation.ok).toBe(false);

    const flows = z
      .array(z.object({ alias: z.string() }))
      .parse(await keycloak.admin.json(`/${realmName}/authentication/flows`));
    for (const flow of flows) {
      const executions = z
        .array(z.object({ providerId: z.string().optional() }))
        .parse(
          await keycloak.admin.json(`/${realmName}/authentication/flows/${encodeURIComponent(flow.alias)}/executions`),
        );
      expect(
        executions.map((execution) => execution.providerId),
        flow.alias,
      ).not.toContain('idp-auto-link');
    }

    const adminEvents = z.array(z.unknown()).parse(await keycloak.admin.json(`/${realmName}/admin-events`));
    expect(adminEvents.length).toBeGreaterThan(0);
  });
});
