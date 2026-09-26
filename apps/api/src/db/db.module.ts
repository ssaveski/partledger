import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
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
  schema,
  shippedExpectations,
  verifyCredential,
  type CatalogViolation,
  type CredentialVerification,
  type PresentedCredential,
} from '@partledger/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ClsModule } from 'nestjs-cls';
import pg from 'pg';

import { TenantTransactions, type AppDatabase } from './tenant-transaction';

export const databasePool = Symbol('databasePool');
export const appDatabase = Symbol('appDatabase');

export interface DatabaseOptions {
  /** A `pl_app` connection string; the boot check refuses any other role. */
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
class DatabaseLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(@Inject(databasePool) private readonly pool: pg.Pool) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await checkCatalog(this.pool, { ...shippedExpectations, expectedRuntimeRole: 'pl_app' });
    if (!result.ok) {
      throw new CatalogCheckFailedError(result.violations);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({})
class DatabaseConnectionModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseConnectionModule,
      providers: [
        { provide: databasePool, useFactory: () => createDatabasePool(options) },
        {
          provide: appDatabase,
          inject: [databasePool],
          useFactory: (pool: pg.Pool): AppDatabase => drizzle({ client: pool, schema }),
        },
        DatabaseLifecycle,
      ],
      exports: [databasePool, appDatabase],
    };
  }
}

@Injectable()
export class CredentialResolver {
  constructor(@Inject(databasePool) private readonly pool: pg.Pool) {}

  /** Resolves a credential before any tenant is known, through `resolve_credential` only. */
  verify(presented: PresentedCredential, now: Date): Promise<CredentialVerification> {
    return verifyCredential(this.pool, presented, now);
  }
}

@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    const connection = DatabaseConnectionModule.forRoot(options);
    return {
      module: DatabaseModule,
      global: true,
      imports: [
        connection,
        ClsModule.forRoot({
          global: true,
          middleware: { mount: true },
          plugins: [
            new ClsPluginTransactional({
              imports: [connection],
              adapter: new TransactionalAdapterDrizzleOrm<AppDatabase>({ drizzleInstanceToken: appDatabase }),
            }),
          ],
        }),
      ],
      providers: [TenantTransactions, CredentialResolver],
      exports: [TenantTransactions, CredentialResolver, connection],
    };
  }
}
