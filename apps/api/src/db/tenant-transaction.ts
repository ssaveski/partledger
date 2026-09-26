import { schema } from '@partledger/db';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';

export const tenantIdSchema = z.uuid();

export type TenantScopedDatabase = NodePgDatabase<typeof schema>;

export interface TenantTransaction {
  readonly tenantId: string;
  /** Drizzle bound to the transaction's connection; do not open nested transactions on it. */
  readonly database: TenantScopedDatabase;
  /** The same connection for raw SQL; bind timestamps as ISO strings cast to timestamptz (KTD12). */
  readonly client: pg.PoolClient;
}

/**
 * Runs `work` in one transaction whose first statement sets the tenant context (KTD10).
 * `set_config(…, true)` is transaction-local, so the context ends with the commit or
 * rollback and a pooled connection never carries it into the next request. `SET LOCAL`
 * cannot take a bind parameter, so it is not used.
 */
export async function runInTenantTransaction<T>(
  pool: pg.Pool,
  tenantId: string,
  work: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  const parsedTenantId = tenantIdSchema.parse(tenantId);
  const client = await pool.connect();
  let connectionBroken = false;
  try {
    await client.query('begin');
    try {
      await client.query(`select set_config('app.tenant_id', $1, true)`, [parsedTenantId]);
      const result = await work({ tenantId: parsedTenantId, database: drizzle({ client, schema }), client });
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        connectionBroken = true;
      }
      throw error;
    }
  } finally {
    // A connection whose rollback failed may still hold the transaction; discard it.
    client.release(connectionBroken);
  }
}
