import { issueCredential, schema } from '@partledger/db';
import { insertTenant, startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runInTenantTransaction } from '../src/db/tenant-transaction';

const settingRows = z.tuple([z.object({ tenant: z.string().nullable() })]);
const countRows = z.tuple([z.object({ count: z.coerce.number() })]);

describe('the per-request tenant transaction', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let pool: pg.Pool;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    tenantA = await insertTenant(superuser, 'tenant-a');
    tenantB = await insertTenant(superuser, 'tenant-b');
    // One connection, so every transaction reuses the same pooled connection.
    pool = database.pool('pl_app', { max: 1 });
  });

  afterAll(async () => {
    await pool.end();
    await superuser.end();
    await database.stop();
  });

  async function contextOnNextConnection(): Promise<string | null> {
    const client = await pool.connect();
    try {
      return settingRows.parse((await client.query(`select current_setting('app.tenant_id', true) as tenant`)).rows)[0]
        .tenant;
    } finally {
      client.release();
    }
  }

  it('sets the tenant context as its first statement and sees only that tenant through drizzle', async () => {
    const seen = await runInTenantTransaction(pool, tenantA, async ({ database: tenantDatabase, client }) => {
      const setting = settingRows.parse(
        (await client.query(`select current_setting('app.tenant_id', true) as tenant`)).rows,
      )[0].tenant;
      const rows = await tenantDatabase.select({ id: schema.tenants.id }).from(schema.tenants);
      return { setting, rows };
    });
    expect(seen).toEqual({ setting: tenantA, rows: [{ id: tenantA }] });
  });

  it('a pooled connection reused after a committed transaction carries no tenant context', async () => {
    await runInTenantTransaction(pool, tenantB, async ({ client }) => {
      await client.query('select 1');
    });
    expect(await contextOnNextConnection()).toBe('');
    const client = await pool.connect();
    try {
      expect(countRows.parse((await client.query('select count(*) from tenants')).rows)[0].count).toBe(0);
    } finally {
      client.release();
    }
  });

  it('a failing unit of work rolls back its writes, rethrows, and leaves no tenant context behind', async () => {
    let issuedId = '';
    const failure = new Error('synthetic failure');
    await expect(
      runInTenantTransaction(pool, tenantA, async ({ client }) => {
        issuedId = (
          await issueCredential(client, {
            tenantId: tenantA,
            kind: 'staff_session',
            subjectId: null,
            expiresAt: new Date(Date.now() + 60_000),
          })
        ).id;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await contextOnNextConnection()).toBe('');
    const stored = countRows.parse(
      (await superuser.query('select count(*) from credentials where id = $1', [issuedId])).rows,
    );
    expect(stored[0].count).toBe(0);
  });

  it('refuses a tenant id that is not a uuid before taking a connection', async () => {
    await expect(runInTenantTransaction(pool, `${tenantA}' or true --`, () => Promise.resolve())).rejects.toThrow();
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
});
