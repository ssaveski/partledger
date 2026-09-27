import {
  Inject,
  Injectable,
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { checkCatalog, jobRunnerRole, shippedExpectations, type CatalogExpectations } from '@partledger/db';
import pg from 'pg';
import { PgBoss, type Db } from 'pg-boss';

import { CatalogCheckFailedError, createDatabasePool } from '../db/db.module';
import { clock, type Clock } from '../time/clock';
import { JobQueue, jobBoss } from './enqueue';
import { JobRunner, jobCatalog } from './job-runner';
import { JobScheduler } from './job-scheduler';
import type { JobDeclaration, ModuleJobs } from './job.types';
import { jobQueueSchema } from './queue-schema';

const jobPool = Symbol('JobPool');
const jobsOptions = Symbol('JobsOptions');

export interface JobsOptions {
  /** A `pl_job_runner` connection string; the boot check refuses any other role. */
  readonly connectionString: string;
  readonly poolSize: number;
  /** Whether this process runs job handlers and fires schedules, or only enqueues. */
  readonly workers: boolean;
  readonly catalog: ModuleJobs;
  readonly clock: Clock;
  readonly pollingIntervalSeconds?: number;
  /** What the boot-time catalog check expects; the shipped schema unless a test adds tables of its own. */
  readonly catalogExpectations?: CatalogExpectations;
}

function queueOptions(declaration: JobDeclaration) {
  return {
    retryLimit: declaration.retryLimit,
    retryDelay: declaration.retryDelaySeconds,
    retryBackoff: true,
    expireInSeconds: declaration.expireInSeconds,
  };
}

/**
 * pg-boss on the region's database (KTD16), in `pl_jobs`, connected as `pl_job_runner`. The
 * migrations install its schema, so it never migrates at runtime and refuses to start on a
 * schema version other than its own. Only a worker process runs handlers, fires schedules and
 * maintains the queues; every process can enqueue.
 */
@Injectable()
class JobsLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private started = false;

  constructor(
    @Inject(jobPool) private readonly pool: pg.Pool,
    @Inject(jobBoss) private readonly boss: PgBoss,
    @Inject(jobsOptions) private readonly options: JobsOptions,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(JobScheduler) private readonly scheduler: JobScheduler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const check = await checkCatalog(this.pool, {
      ...(this.options.catalogExpectations ?? shippedExpectations),
      expectedRuntimeRole: jobRunnerRole,
    });
    if (!check.ok) {
      throw new CatalogCheckFailedError(check.violations);
    }
    this.boss.on('error', (error) => {
      this.logger.error(`pg-boss: ${error.message}`);
    });
    await this.boss.start();
    this.started = true;
    for (const { declaration } of this.options.catalog.jobs) {
      await this.boss.createQueue(declaration.name, queueOptions(declaration));
      await this.boss.updateQueue(declaration.name, queueOptions(declaration));
    }
    if (!this.options.workers) {
      return;
    }
    await this.scheduler.synchronise();
    for (const { declaration } of this.options.catalog.jobs) {
      await this.boss.work(
        declaration.name,
        { batchSize: 1, pollingIntervalSeconds: this.options.pollingIntervalSeconds ?? 2 },
        async (jobs) => {
          for (const job of jobs) {
            await this.runner.run(job);
          }
        },
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    // Before the database pools close: a run still active is failed and retried later.
    if (this.started) {
      await this.boss.stop({ graceful: true, close: false, timeout: 10_000 });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({})
export class JobsModule {
  static register(options: JobsOptions): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      providers: [
        { provide: jobsOptions, useValue: options },
        { provide: jobCatalog, useValue: options.catalog },
        { provide: clock, useValue: options.clock },
        {
          provide: jobPool,
          useFactory: () =>
            createDatabasePool({ connectionString: options.connectionString, poolSize: options.poolSize }),
        },
        {
          provide: jobBoss,
          inject: [jobPool],
          useFactory: (pool: pg.Pool) => {
            const adapter: Db = {
              async executeSql(text, values) {
                const result = await pool.query(text, values);
                return { rows: result.rows };
              },
            };
            return new PgBoss({
              // pg-boss names this option `db`.
              ['db']: adapter,
              schema: jobQueueSchema,
              migrate: false,
              createSchema: false,
              supervise: options.workers,
              schedule: options.workers,
              // Rebuilding indexes needs ownership, which the runner does not have.
              reindex: false,
            });
          },
        },
        JobQueue,
        JobRunner,
        JobScheduler,
        JobsLifecycle,
        ...options.catalog.jobs.map((registration) => registration.handler),
      ],
      exports: [JobQueue, JobRunner, JobScheduler, jobBoss],
    };
  }
}
