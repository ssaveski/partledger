import { randomUUID } from 'node:crypto';

import {
  commandPath,
  idempotencyKeyHeader,
  queryPath,
  staffRequestHeader,
  type TenantRole,
} from '@partledger/contracts';
import { issueCredential, shippedExpectations, type CredentialKind, type TableAccess } from '@partledger/db';
import { insertTenant, startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';

import type { IdentityProvider } from '../../src/auth/identity-provider';
import { sessionCookieName } from '../../src/auth/session-cookie';
import { StaffSessions } from '../../src/auth/staff-sessions';
import { startApi, type RunningApi } from '../../src/bootstrap';
import type { OperationRegistry } from '../../src/commands/handlers';
import { parseConfig } from '../../src/config/env.schema';
import type { ModuleJobs } from '../../src/jobs/job.types';
import type { HttpEntryAdapter } from '../../src/listeners/entry-adapters';
import type { EmailPort } from '../../src/notifications/email.port';
import type { RecipientDirectory } from '../../src/notifications/recipient-directory';
import { formatCredentialToken } from '../../src/principals/credential-token';
import type { RoleDirectory } from '../../src/principals/role-directory';
import type { Clock } from '../../src/time/clock';
import { placeholderAuthEnvironment } from './auth-environment';
import { internalTestNotesTable, internalTestRegistry } from './internal-test-module';

const countRows = z.tuple([z.object({ count: z.number().int() })]);

/** A clock the test can move forward. */
export interface MovableClock extends Clock {
  advance(milliseconds: number): void;
}

export interface IssuedToken {
  readonly credentialId: string;
  readonly subjectId: string;
  readonly token: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface ApiHarness {
  readonly database: TestDatabase;
  readonly superuser: pg.Client;
  readonly api: RunningApi;
  readonly clock: MovableClock;
  readonly tenantA: string;
  readonly tenantB: string;
  /** Issues a credential whose subject holds `roles` (people only). */
  issue(
    kind: CredentialKind,
    tenantId: string,
    options?: { readonly roles?: readonly TenantRole[]; readonly expiresInMilliseconds?: number },
  ): Promise<IssuedToken>;
  command(
    adapter: HttpEntryAdapter,
    name: string,
    body: unknown,
    options?: { readonly token?: string; readonly idempotencyKey?: string; readonly api?: RunningApi },
  ): Promise<ApiResponse>;
  query(adapter: HttpEntryAdapter, name: string, input: unknown, token?: string): Promise<ApiResponse>;
  /** Gives a person, such as one signed in through Keycloak, roles in the stand-in directory. */
  grantRoles(userId: string, roles: readonly TenantRole[]): void;
  count(sql: string, values?: unknown[]): Promise<number>;
  /** Another API process on the same database, sharing the clock and role directory; the caller closes it. */
  startAnotherApi(options?: ApiProcessOptions): Promise<RunningApi>;
  close(): Promise<void>;
}

/** What differs between API processes started on the harness's database. */
export interface ApiProcessOptions {
  readonly registry?: OperationRegistry;
  readonly jobs?: ModuleJobs;
  /** Whether the API runs job handlers and schedules; off unless a test needs them. */
  readonly workers?: boolean;
  /** Test tables that exist when this API boots, for its catalog check. */
  readonly catalogTables?: readonly TableAccess[];
  /** Replaces the local email adapter, to see or fail sends. */
  readonly emailPort?: EmailPort;
  /** Replaces the shipped recipient directory, to reach recipients of later units. */
  readonly recipientDirectory?: RecipientDirectory;
}

export interface ApiHarnessOptions {
  /** Staff sign-in settings; by default an unreachable placeholder realm. */
  readonly authEnvironment?: Readonly<Record<string, string>>;
  /**
   * `keycloak` signs in and refreshes against the configured realm; an object replaces the
   * stand-in, whose refreshes always succeed with the same identity.
   */
  readonly identityProvider?: 'keycloak' | IdentityProvider;
  /** The first API process. */
  readonly process?: ApiProcessOptions;
}

/**
 * The API on four loopback listeners with the test-only module registered, against a
 * migrated PostgreSQL 18 as `pl_app`. People's roles come from an in-memory directory, which
 * stands in for U8's membership rows.
 */
export async function startApiHarness(options: ApiHarnessOptions = {}): Promise<ApiHarness> {
  const database = await startTestDatabase();
  const superuser = await database.connect('superuser');
  const tenantA = await insertTenant(superuser, 'tenant-a');
  const tenantB = await insertTenant(superuser, 'tenant-b');
  const rolesByUser = new Map<string, readonly TenantRole[]>();
  const roleDirectory: RoleDirectory = {
    rolesOf: (person) => Promise.resolve(rolesByUser.get(person.userId) ?? []),
  };
  let offset = 0;
  const clock: MovableClock = {
    now: () => new Date(Date.now() + offset),
    advance: (milliseconds) => {
      offset += milliseconds;
    },
  };
  const loopback = { host: '127.0.0.1', port: 0 };
  const startOne = (apiProcess: ApiProcessOptions) =>
    startApi(
      parseConfig({
        NODE_ENV: 'test',
        STAFF_PORT: '1',
        PORTAL_PORT: '2',
        DROP_PORT: '3',
        OPERATOR_PORT: '4',
        DATABASE_URL: database.connectionString('pl_app'),
        JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
        JOBS_WORKERS: apiProcess.workers === true ? 'on' : 'off',
        // Tests move the clock by up to a day; sessions they issue must outlast that.
        ...(options.authEnvironment ?? placeholderAuthEnvironment({ STAFF_SESSION_IDLE_TIMEOUT_MINUTES: '10080' })),
      }),
      { staff: loopback, portal: loopback, drop: loopback, operator: loopback },
      {
        registry: apiProcess.registry ?? internalTestRegistry,
        roleDirectory,
        clock,
        identityProvider:
          options.identityProvider === 'keycloak' ? undefined : (options.identityProvider ?? stubIdentityProvider),
        jobPollingIntervalSeconds: 0.5,
        ...(apiProcess.jobs === undefined ? {} : { jobs: apiProcess.jobs }),
        ...(apiProcess.emailPort === undefined ? {} : { emailPort: apiProcess.emailPort }),
        ...(apiProcess.recipientDirectory === undefined ? {} : { recipientDirectory: apiProcess.recipientDirectory }),
        ...(apiProcess.catalogTables === undefined
          ? {}
          : {
              catalogExpectations: {
                ...shippedExpectations,
                tables: [...shippedExpectations.tables, ...apiProcess.catalogTables],
              },
            }),
      },
    );
  const api = await startOne(options.process ?? {});
  const staffSessions = api.app.get(StaffSessions);
  // Created after boot: the boot-time catalog check knows only the shipped schema.
  const migrator = await database.connect('pl_migrator');
  await migrator.query(internalTestNotesTable);
  await migrator.end();
  const issuer = drizzle({ client: superuser });

  async function send(
    adapter: HttpEntryAdapter,
    path: string,
    init: RequestInit,
    target: RunningApi = api,
  ): Promise<ApiResponse> {
    const response = await fetch(`${target.listeners.urls[adapter]}${path}`, init);
    const text = await response.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    return { status: response.status, headers: response.headers, body };
  }

  return {
    database,
    superuser,
    api,
    clock,
    tenantA,
    tenantB,
    async issue(kind, tenantId, options = {}) {
      const subjectId = randomUUID();
      rolesByUser.set(subjectId, options.roles ?? []);
      const expiresAt = new Date(clock.now().getTime() + (options.expiresInMilliseconds ?? 3_600_000));
      if (kind === 'staff_session') {
        // Staff sessions start the way a sign-in starts them, with a stand-in refresh token.
        const identity = { subject: subjectId, tenantId, organizationId: 'harness' };
        const started = await staffSessions.start(
          { identity, refreshToken: JSON.stringify(identity) },
          clock.now(),
          expiresAt,
        );
        if (started === null) {
          throw new Error('The harness could not start a staff session');
        }
        return {
          credentialId: started.credentialId,
          subjectId,
          token: formatCredentialToken(kind, started.credentialId, started.secret),
        };
      }
      const issued = await issueCredential(issuer, { tenantId, kind, subjectId, expiresAt });
      return { credentialId: issued.id, subjectId, token: formatCredentialToken(kind, issued.id, issued.secret) };
    },
    command(adapter, name, body, options = {}) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...credentialHeaders(adapter, options.token),
        [staffRequestHeader.name]: staffRequestHeader.value,
      };
      if (options.idempotencyKey !== undefined) {
        headers[idempotencyKeyHeader] = options.idempotencyKey;
      }
      return send(adapter, commandPath(name), { method: 'POST', headers, body: JSON.stringify(body) }, options.api);
    },
    query(adapter, name, input, token) {
      const search = new URLSearchParams({ input: JSON.stringify(input) });
      return send(adapter, `${queryPath(name)}?${search.toString()}`, { headers: credentialHeaders(adapter, token) });
    },
    grantRoles(userId, roles) {
      rolesByUser.set(userId, roles);
    },
    async count(text, values = []) {
      const result = await superuser.query(`select count(*)::int as count from (${text}) as counted`, values);
      return countRows.parse(result.rows)[0].count;
    },
    startAnotherApi(apiProcess = options.process ?? {}) {
      return startOne(apiProcess);
    },
    async close() {
      await api.close();
      await superuser.end();
      await database.stop();
    },
  };
}

/**
 * How a client presents a token on each listener: the staff app sends its session cookie,
 * everything else a bearer token. A token of the wrong kind travels the same way, so the
 * listener's refusal is what the test sees.
 */
export function credentialHeaders(adapter: HttpEntryAdapter, token: string | undefined): Record<string, string> {
  if (token === undefined) {
    return {};
  }
  return adapter === 'staff' ? { cookie: `${sessionCookieName}=${token}` } : { authorization: `Bearer ${token}` };
}

/**
 * Stands in for Keycloak: every refresh succeeds with the same identity. Sign-in against a
 * real Keycloak is covered by the auth integration tests.
 */
export const stubIdentity = z.object({ subject: z.uuid(), tenantId: z.uuid(), organizationId: z.string() });

export const stubIdentityProvider: IdentityProvider = {
  authorizationUrl: () => Promise.resolve({ ok: false, error: 'unavailable' }),
  exchangeCode: () => Promise.resolve({ ok: false, error: 'unavailable' }),
  refresh: (refreshToken) =>
    Promise.resolve({ kind: 'refreshed', identity: stubIdentity.parse(JSON.parse(refreshToken)), refreshToken }),
  endSession: () => Promise.resolve(),
};

export function newIdempotencyKey(): string {
  return randomUUID();
}
