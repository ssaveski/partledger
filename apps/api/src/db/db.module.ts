import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  checkCatalog,
  describeViolations,
  verifyCredential,
  type CatalogViolation,
  type CredentialVerification,
  type PresentedCredential,
} from '@partledger/db';
import pg from 'pg';

import { runInTenantTransaction, type TenantTransaction } from './tenant-transaction';

export const databasePool = Symbol('databasePool');

export interface DatabaseOptions {
  /** A `pl_app` connection string. */
  readonly connectionString: string;
  readonly poolSize: number;
}

export class CatalogCheckFailedError extends Error {
  readonly violations: readonly CatalogViolation[];

  constructor(violations: readonly CatalogViolation[]) {
    super(`The database fails the catalog check:\n${describeViolations(violations)}`);
    this.name = 'CatalogCheckFailedError';
    this.violations = violations;
  }
}

export function createDatabasePool(options: DatabaseOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolSize,
    options: '-c TimeZone=UTC',
  });
  const logger = new Logger('DatabasePool');
  // An idle connection that the server closes must not crash the process.
  pool.on('error', (error) => {
    logger.warn(`Idle database connection failed: ${error.message}`);
  });
  return pool;
}

@Injectable()
export class TenantDatabase {
  constructor(@Inject(databasePool) private readonly pool: pg.Pool) {}

  inTenant<T>(tenantId: string, work: (transaction: TenantTransaction) => Promise<T>): Promise<T> {
    return runInTenantTransaction(this.pool, tenantId, work);
  }

  /** Resolves a credential before any tenant is known, through `resolve_credential` only. */
  verifyCredential(presented: PresentedCredential, now: Date): Promise<CredentialVerification> {
    return verifyCredential(this.pool, presented, now);
  }
}

@Injectable()
class DatabaseLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(@Inject(databasePool) private readonly pool: pg.Pool) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await checkCatalog(this.pool);
    if (!result.ok) {
      throw new CatalogCheckFailedError(result.violations);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: databasePool, useFactory: () => createDatabasePool(options) },
        TenantDatabase,
        DatabaseLifecycle,
      ],
      exports: [TenantDatabase],
    };
  }
}
