import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { shippedExpectations } from '@partledger/db';
import { z } from 'zod';

import { createApp } from '../../src/bootstrap';
import { OperationExecutor } from '../../src/commands/operation-executor';
import { parseConfig } from '../../src/config/env.schema';
import { placeholderAuthEnvironment } from './auth-environment';
import { jobsTestCatalogTables, jobsTestJobs, jobsTestRegistry } from './jobs-test-module';

/**
 * A process that runs one command that enqueues a job, prints its outcome once the command has
 * committed, and kills itself with SIGKILL: no shutdown hook, no pool drain, nothing but what
 * the commit left in the database. The jobs tests build it with Vite and run it with Node.
 */
const settings = z
  .object({
    databaseUrl: z.string(),
    jobsDatabaseUrl: z.string(),
    tenantId: z.uuid(),
    credentialId: z.uuid(),
  })
  .parse(JSON.parse(process.argv[2] ?? '{}'));

const app = await createApp(
  parseConfig({
    NODE_ENV: 'test',
    STAFF_PORT: '1',
    PORTAL_PORT: '2',
    DROP_PORT: '3',
    OPERATOR_PORT: '4',
    DATABASE_URL: settings.databaseUrl,
    JOBS_DATABASE_URL: settings.jobsDatabaseUrl,
    JOBS_WORKERS: 'off',
    ...placeholderAuthEnvironment(),
  }),
  {
    registry: jobsTestRegistry,
    jobs: jobsTestJobs,
    roleDirectory: { rolesOf: () => Promise.resolve(['buyer']) },
    catalogExpectations: { ...shippedExpectations, tables: [...shippedExpectations.tables, ...jobsTestCatalogTables] },
  },
);
const outcome = await app.get(OperationExecutor).runCommand(
  {
    type: 'person',
    tenantId: settings.tenantId,
    userId: randomUUID(),
    stepUp: null,
    actedUnder: { grant: 'staff_session', credentialId: settings.credentialId },
    adapter: 'staff',
    correlationId: randomUUID(),
  },
  'jobsTest.createNotesAndEnqueue',
  { count: 2 },
  undefined,
);
process.stdout.write(`${JSON.stringify(outcome)}\n`, () => {
  process.kill(process.pid, 'SIGKILL');
});
