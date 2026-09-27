import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { checkCatalog, type CatalogExpectations } from '@partledger/db';
import { failure, success, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { CatalogCheckFailedError } from '../db/db.module';
import { tenantIdSchema } from '../db/tenant-transaction';

export const aiWorkerPool = Symbol('AiWorkerPool');
export const aiWorkerCatalog = Symbol('AiWorkerCatalog');

/** A transaction on the AI worker's connection. */
export type AiWorkerTransaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * The AI worker's connection (KTD17, R31): `pl_ai_worker`, which can insert suggestions,
 * commitments and audit entries, read the chain head, and nothing more. Suggestions are stored
 * through it, so even a compromised AI path cannot change a domain record. The boot check
 * refuses any other role. Without a configured connection, nothing can be stored.
 */
@Injectable()
export class AiWorkerDatabase implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly database: NodePgDatabase | null;

  constructor(
    @Inject(aiWorkerPool) private readonly pool: pg.Pool | null,
    @Inject(aiWorkerCatalog) private readonly expectations: CatalogExpectations,
  ) {
    this.database = pool === null ? null : drizzle({ client: pool });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.pool === null) {
      return;
    }
    const result = await checkCatalog(this.pool, { ...this.expectations, expectedRuntimeRole: 'pl_ai_worker' });
    if (!result.ok) {
      throw new CatalogCheckFailedError(result.violations);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }

  /** Runs `work` in one transaction whose first statement sets the tenant (KTD10). */
  async run<T>(
    tenantId: string,
    work: (transaction: AiWorkerTransaction) => Promise<T>,
  ): Promise<Result<T, 'unavailable'>> {
    if (this.database === null) {
      return failure('unavailable');
    }
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    const value = await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.tenant_id', ${parsedTenantId}, true)`);
      return work(transaction);
    });
    return success(value);
  }
}
