import 'reflect-metadata';

import { TransactionHost } from '@nestjs-cls/transactional';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { issueCredential, schema } from '@partledger/db';
import { insertTenant, startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { databasePool, DatabaseModule } from '../src/db/db.module';
import { NestedTenantTransactionError, TenantTransactions, type DatabaseAdapter } from '../src/db/tenant-transaction';

const settingRows = z.tuple([z.object({ tenant: z.string().nullable() })]);
const countRows = z.tuple([z.object({ count: z.coerce.number() })]);

describe('the per-request tenant transaction held in CLS', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let context: INestApplicationContext;
  let transactions: TenantTransactions;
  let host: TransactionHost<DatabaseAdapter>;
  let pool: pg.Pool;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    tenantA = await insertTenant(superuser, 'tenant-a');
    tenantB = await insertTenant(superuser, 'tenant-b');
    const moduleRef = await Test.createTestingModule({
      // One connection, so every transaction reuses the same pooled connection.
      imports: [DatabaseModule.forRoot({ connectionString: database.connectionString('pl_app'), poolSize: 1 })],
    }).compile();
    context = await moduleRef.init();
    transactions = context.get(TenantTransactions);
    host = context.get<TransactionHost<DatabaseAdapter>>(TransactionHost);
    pool = context.get<pg.Pool>(databasePool);
  });

  afterAll(async () => {
    await context.close();
    await superuser.end();
    await database.stop();
  });

  async function tenantSettingOnNextConnection(): Promise<string | null> {
    const result = await pool.query(`select current_setting('app.tenant_id', true) as tenant`);
    return settingRows.parse(result.rows)[0].tenant;
  }

  it('sets the tenant context as its first statement and shares the transaction through CLS', async () => {
    const seen = await transactions.run(tenantA, async (transaction) => {
      const setting = settingRows.parse(
        (await host.tx.execute(sql`select current_setting('app.tenant_id', true) as tenant`)).rows,
      )[0].tenant;
      const rows = await transaction.select({ id: schema.tenants.id }).from(schema.tenants);
      return { setting, rows, active: host.isTransactionActive() };
    });
    expect(seen).toEqual({ setting: tenantA, rows: [{ id: tenantA }], active: true });
  });

  it('a pooled connection reused after a committed transaction carries no tenant context', async () => {
    await transactions.run(tenantB, async (transaction) => {
      await transaction.execute(sql`select 1`);
    });
    expect(await tenantSettingOnNextConnection()).toBe('');
    expect(countRows.parse((await pool.query('select count(*) from tenants')).rows)[0].count).toBe(0);
  });

  it('a failing unit of work rolls back its writes, rethrows, and leaves no tenant context behind', async () => {
    let issuedId = '';
    const failure = new Error('synthetic failure');
    await expect(
      transactions.run(tenantA, async () => {
        issuedId = (
          await issueCredential(host.tx, {
            tenantId: tenantA,
            kind: 'staff_session',
            subjectId: null,
            expiresAt: new Date(Date.now() + 60_000),
          })
        ).id;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await tenantSettingOnNextConnection()).toBe('');
    const stored = countRows.parse(
      (await superuser.query('select count(*) from credentials where id = $1', [issuedId])).rows,
    );
    expect(stored[0].count).toBe(0);
  });

  it('refuses a tenant transaction opened inside another one', async () => {
    await expect(
      transactions.run(tenantA, () => transactions.run(tenantB, () => Promise.resolve('joined'))),
    ).rejects.toBeInstanceOf(NestedTenantTransactionError);
  });

  it('refuses a tenant id that is not a uuid before taking a connection', async () => {
    const connect = vi.spyOn(pool, 'connect');
    try {
      await expect(transactions.run(`${tenantA}' or true --`, () => Promise.resolve())).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
});
