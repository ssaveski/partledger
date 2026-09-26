import { Propagation, TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { schema } from '@partledger/db';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';

export const tenantIdSchema = z.uuid();

export type AppDatabase = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export type DatabaseAdapter = TransactionalAdapterDrizzleOrm<AppDatabase>;

export class NestedTenantTransactionError extends Error {
  constructor() {
    super('A tenant transaction cannot start inside another transaction');
    this.name = 'NestedTenantTransactionError';
  }
}

/**
 * Opens the per-request transaction (KTD10). It is held in CLS by
 * `@nestjs-cls/transactional`, so code below reads it from `TransactionHost.tx`; its first
 * statement sets the tenant context. `set_config(…, true)` is transaction-local, so the
 * context ends with the commit or rollback and a pooled connection never carries it into
 * the next request. `SET LOCAL` cannot take a bind parameter, so it is not used.
 */
@Injectable()
export class TenantTransactions {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost<DatabaseAdapter>) {}

  async run<T>(tenantId: string, work: (database: AppDatabase) => Promise<T>): Promise<T> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    // Joining an open transaction would run under whichever tenant opened it.
    if (this.host.isTransactionActive()) {
      throw new NestedTenantTransactionError();
    }
    return this.host.withTransaction(Propagation.RequiresNew, async () => {
      await this.host.tx.execute(sql`select set_config('app.tenant_id', ${parsedTenantId}, true)`);
      return work(this.host.tx);
    });
  }
}
