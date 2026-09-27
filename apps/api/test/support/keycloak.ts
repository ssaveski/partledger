import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

/**
 * Keycloak 26 in a container for sign-in tests (KTD20), started the way the runbook starts it
 * for local development: the shipped realm imported at boot and impersonation disabled. Its
 * users, organizations and client secret are synthetic and created per run through the admin
 * API; nothing secret is in the repository.
 *
 * This module runs under Vitest and, for the Playwright stack, directly under Node, so it
 * uses only erasable TypeScript and explicit `.ts` extensions.
 */
/** Pinned by digest (KTD41); the same build as docs/runbooks/keycloak.md. */
export const keycloakImage =
  'quay.io/keycloak/keycloak:26.4@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007';

export const realmName = 'partledger';

export const clientId = 'partledger-api';

export const realmFile = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'compose',
  'keycloak',
  'realm.json',
);

/** Keycloak's own port inside the container, for calls Keycloak makes to itself (brokering). */
export const internalBaseUrl = 'http://localhost:8080';

const idRows = z.array(z.object({ id: z.string() }));
const secretBody = z.object({ value: z.string().min(16) });
const tokenBody = z.object({ access_token: z.string() });

export interface StartedKeycloak {
  readonly container: StartedTestContainer;
  /** As the host (tests, the API, the browser) reaches it. */
  readonly baseUrl: string;
  readonly issuer: string;
  readonly admin: KeycloakAdmin;
  stop(): Promise<void>;
}

export interface SyntheticUser {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly enabled?: boolean;
}

export interface KeycloakAdmin {
  request(method: string, path: string, body?: unknown): Promise<Response>;
  json(path: string): Promise<unknown>;
  regenerateClientSecret(client: string, realm?: string): Promise<string>;
  createOrganization(alias: string, tenantId: string | null): Promise<string>;
  createUser(user: SyntheticUser, realm?: string): Promise<string>;
  addMember(organizationId: string, userId: string): Promise<void>;
  setUserEnabled(userId: string, enabled: boolean): Promise<void>;
  userSessionCount(userId: string): Promise<number>;
}

export async function startKeycloak(extraRealmFiles: readonly string[] = []): Promise<StartedKeycloak> {
  const adminPassword = randomBytes(18).toString('base64url');
  const realms = [realmFile, ...extraRealmFiles].map((source, position) => ({
    source,
    target: `/opt/keycloak/data/import/realm-${position}.json`,
  }));
  const container = await new GenericContainer(keycloakImage)
    .withEnvironment({ KC_BOOTSTRAP_ADMIN_USERNAME: 'bootstrap-admin', KC_BOOTSTRAP_ADMIN_PASSWORD: adminPassword })
    .withCopyFilesToContainer(realms)
    .withCommand(['start-dev', '--import-realm', '--features-disabled=impersonation'])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp(`/realms/${realmName}/.well-known/openid-configuration`, 8080).forStatusCode(200))
    .withStartupTimeout(240_000)
    .start();
  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(8080)}`;

  async function adminToken(): Promise<string> {
    const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'bootstrap-admin',
        password: adminPassword,
      }),
    });
    return tokenBody.parse(await response.json()).access_token;
  }

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${await adminToken()}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return fetch(`${baseUrl}/admin/realms${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  async function expectOk(response: Response, what: string): Promise<void> {
    if (!response.ok) {
      throw new Error(`Keycloak refused to ${what}: ${response.status} ${await response.text()}`);
    }
  }

  /** Keycloak answers a create with the new resource's URL. */
  function createdId(response: Response): string {
    const id = response.headers.get('location')?.split('/').pop();
    if (id === undefined || id === '') {
      throw new Error('Keycloak did not name the created resource');
    }
    return id;
  }

  async function idAt(path: string): Promise<string> {
    const response = await request('GET', path);
    const [first] = idRows.parse(await response.json());
    if (first === undefined) {
      throw new Error(`Nothing found at ${path}`);
    }
    return first.id;
  }

  const admin: KeycloakAdmin = {
    request,
    async json(path) {
      const response = await request('GET', path);
      await expectOk(response, `read ${path}`);
      const body: unknown = await response.json();
      return body;
    },
    async regenerateClientSecret(client, realm = realmName) {
      const internalId = await idAt(`/${realm}/clients?clientId=${encodeURIComponent(client)}`);
      const response = await request('POST', `/${realm}/clients/${internalId}/client-secret`);
      await expectOk(response, 'regenerate the client secret');
      return secretBody.parse(await response.json()).value;
    },
    async createOrganization(alias, tenantId) {
      const response = await request('POST', `/${realmName}/organizations`, {
        name: `Synthetic ${alias}`,
        alias,
        enabled: true,
        domains: [{ name: `${alias}.synthetic.test` }],
        attributes: tenantId === null ? {} : { tenant_id: [tenantId] },
      });
      await expectOk(response, 'create an organization');
      return createdId(response);
    },
    async createUser(user, realm = realmName) {
      const response = await request('POST', `/${realm}/users`, {
        username: user.username,
        email: user.email,
        firstName: 'Synthetic',
        lastName: 'Person',
        enabled: user.enabled ?? true,
        emailVerified: true,
        credentials: [{ type: 'password', value: user.password, temporary: false }],
      });
      await expectOk(response, 'create a user');
      return createdId(response);
    },
    async addMember(organizationId, userId) {
      const response = await request('POST', `/${realmName}/organizations/${organizationId}/members`, userId);
      await expectOk(response, 'add an organization member');
    },
    async setUserEnabled(userId, enabled) {
      const response = await request('PUT', `/${realmName}/users/${userId}`, { enabled });
      await expectOk(response, 'change a user');
    },
    async userSessionCount(userId) {
      const sessions = await admin.json(`/${realmName}/users/${userId}/sessions`);
      return z.array(z.unknown()).parse(sessions).length;
    },
  };

  return {
    container,
    baseUrl,
    issuer: `${baseUrl}/realms/${realmName}`,
    admin,
    async stop() {
      await container.stop();
    },
  };
}

export function syntheticPassword(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Stands in for a browser: follows no redirects on its own and keeps cookies per origin and
 * path, which is enough to drive Keycloak's login pages and the API's sign-in endpoints.
 */
export class TestBrowser {
  /** Per origin, cookies keyed by name and path, as a browser keeps two realms' same-named cookies apart. */
  private readonly jar = new Map<string, Map<string, { name: string; value: string; path: string }>>();

  async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.send(url, { method: 'GET', headers });
  }

  async post(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
    return this.send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
    });
  }

  /** The cookie this browser would send to `url` under `name`. */
  cookie(url: string, name: string): string | undefined {
    return this.cookiesFor(new URL(url)).find((cookie) => cookie.name === name)?.value;
  }

  private cookiesFor(target: URL): { name: string; value: string; path: string }[] {
    return [...(this.jar.get(target.origin)?.values() ?? [])].filter((cookie) =>
      target.pathname.startsWith(cookie.path),
    );
  }

  private async send(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    const target = new URL(url);
    const cookies = this.cookiesFor(target).map((cookie) => `${cookie.name}=${cookie.value}`);
    const headers = cookies.length === 0 ? init.headers : { ...init.headers, cookie: cookies.join('; ') };
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const header of response.headers.getSetCookie()) {
      this.store(target.origin, header);
    }
    return response;
  }

  private store(origin: string, header: string): void {
    const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const path = attributes.find((attribute) => attribute.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
    const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith('max-age='))?.slice(8);
    const expired =
      maxAge === '0' || attributes.some((attribute) => /^expires=thu, 01[- ]jan[- ]1970/i.test(attribute));
    const cookies = this.jar.get(origin) ?? new Map<string, { name: string; value: string; path: string }>();
    const key = `${name};${path}`;
    if (expired || value === '') {
      cookies.delete(key);
    } else {
      cookies.set(key, { name, value, path });
    }
    this.jar.set(origin, cookies);
  }
}

export interface HtmlForm {
  readonly action: string;
  readonly fields: Record<string, string>;
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

/** The first form on a page whose action matches, with the values of its named inputs. */
export function formOn(html: string, actionPattern: RegExp = /./): HtmlForm | null {
  for (const match of html.matchAll(/<form\b[^>]*\baction="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g)) {
    const action = decodeEntities(match[1] ?? '');
    if (!actionPattern.test(action)) {
      continue;
    }
    const fields: Record<string, string> = {};
    for (const input of (match[2] ?? '').matchAll(/<input\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(input[0])?.[1];
      const value = /\bvalue="([^"]*)"/.exec(input[0])?.[1] ?? '';
      if (name !== undefined) {
        fields[name] = decodeEntities(value);
      }
    }
    return { action, fields };
  }
  return null;
}

/** The href of the first link whose target matches. */
export function linkOn(html: string, hrefPattern: RegExp): string | null {
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    const href = decodeEntities(match[1] ?? '');
    if (hrefPattern.test(href)) {
      return href;
    }
  }
  return null;
}
