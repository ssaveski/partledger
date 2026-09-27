import { randomUUID } from 'node:crypto';

import { commandPath, idempotencyKeyHeader, queryPath, type TenantRole } from '@partledger/contracts';
import { issueCredential, type CredentialKind } from '@partledger/db';
import { insertTenant, startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';

import { startApi, type RunningApi } from '../../src/bootstrap';
import { parseConfig } from '../../src/config/env.schema';
import type { HttpEntryAdapter } from '../../src/listeners/entry-adapters';
import { formatCredentialToken } from '../../src/principals/credential-token';
import type { RoleDirectory } from '../../src/principals/role-directory';
import type { Clock } from '../../src/time/clock';
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
    options?: { readonly token?: string; readonly idempotencyKey?: string },
  ): Promise<ApiResponse>;
  query(adapter: HttpEntryAdapter, name: string, input: unknown, token?: string): Promise<ApiResponse>;
  count(sql: string, values?: unknown[]): Promise<number>;
  close(): Promise<void>;
}

/**
 * The API on four loopback listeners with the test-only module registered, against a
 * migrated PostgreSQL 18 as `pl_app`. People's roles come from an in-memory directory, which
 * stands in for U8's membership rows.
 */
export async function startApiHarness(): Promise<ApiHarness> {
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
  const config = parseConfig({
    NODE_ENV: 'test',
    STAFF_PORT: '1',
    PORTAL_PORT: '2',
    DROP_PORT: '3',
    OPERATOR_PORT: '4',
    DATABASE_URL: database.connectionString('pl_app'),
  });
  const loopback = { host: '127.0.0.1', port: 0 };
  const api = await startApi(
    config,
    { staff: loopback, portal: loopback, drop: loopback, operator: loopback },
    { registry: internalTestRegistry, roleDirectory, clock },
  );
  // Created after boot: the boot-time catalog check knows only the shipped schema.
  const migrator = await database.connect('pl_migrator');
  await migrator.query(internalTestNotesTable);
  await migrator.end();
  const issuer = drizzle({ client: superuser });

  async function send(adapter: HttpEntryAdapter, path: string, init: RequestInit): Promise<ApiResponse> {
    const response = await fetch(`${api.listeners.urls[adapter]}${path}`, init);
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
      const issued = await issueCredential(issuer, {
        tenantId,
        kind,
        subjectId,
        expiresAt: new Date(Date.now() + (options.expiresInMilliseconds ?? 3_600_000)),
      });
      return { credentialId: issued.id, subjectId, token: formatCredentialToken(kind, issued.id, issued.secret) };
    },
    command(adapter, name, body, options = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.token !== undefined) {
        headers.authorization = `Bearer ${options.token}`;
      }
      if (options.idempotencyKey !== undefined) {
        headers[idempotencyKeyHeader] = options.idempotencyKey;
      }
      return send(adapter, commandPath(name), { method: 'POST', headers, body: JSON.stringify(body) });
    },
    query(adapter, name, input, token) {
      const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
      const search = new URLSearchParams({ input: JSON.stringify(input) });
      return send(adapter, `${queryPath(name)}?${search.toString()}`, { headers });
    },
    async count(text, values = []) {
      const result = await superuser.query(`select count(*)::int as count from (${text}) as counted`, values);
      return countRows.parse(result.rows)[0].count;
    },
    async close() {
      await api.close();
      await superuser.end();
      await database.stop();
    },
  };
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
