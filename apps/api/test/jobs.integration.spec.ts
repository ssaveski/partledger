import { randomUUID } from 'node:crypto';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { insertTenant } from '@partledger/db/testing';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { RunningApi } from '../src/bootstrap';
import { TenantTransactions } from '../src/db/tenant-transaction';
import { CommandJobs, JobQueue, jobBoss, type JobOrigin } from '../src/jobs/enqueue';
import { JobScheduler } from '../src/jobs/job-scheduler';
import { productionJobs } from '../src/jobs/job-registry';
import { defineSchedule, type JobSchedule } from '../src/jobs/job.types';
import { enqueueTenantEnrolment, TenantEnrolmentContextError } from '../src/jobs/tenant-enrollment.job';
import { verifyChainJob } from '../src/audit/chain-verification.job';
import type { SystemPrincipal } from '../src/principals/principal';
import { JobItemFailedError, JobRunner, type DeliveredJob } from '../src/jobs/job-runner';
import type { JobEnvelope } from '../src/jobs/job.types';
import { startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';
import {
  applyNotesJob,
  jobProbe,
  jobsTestCatalogTables,
  jobsTestJobs,
  jobsTestRegistry,
  jobsTestTables,
  failingFailureRecord,
  leakedValue,
  misbehaveJob,
} from './support/jobs-test-module';

const apiDirectory = join(import.meta.dirname, '..');

const commandSource = 'jobsTest.createNotesAndEnqueue';
const nightlySchedule = 'audit.nightlyChainVerification';

const outcomeRows = z.array(
  z.object({
    item_key: z.string(),
    status: z.enum(['done', 'failed']),
    attempts: z.number(),
    failure: z.string().nullable(),
  }),
);
const effectRows = z.array(z.object({ item_key: z.string(), count: z.number() }));
const jobStateRows = z.array(z.object({ state: z.string(), retry_count: z.number() }));
const entryRows = z.array(
  z.object({
    seq: z.coerce.number(),
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    acted_under: z.unknown(),
    correlation_id: z.string(),
    payload: z.object({
      event: z.string(),
      adapter: z.string(),
      correlationId: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  }),
);
const scheduleRows = z.array(
  z.object({ name: z.string(), key: z.string(), cron: z.string(), timezone: z.string(), data: z.unknown() }),
);
const createdNotes = z.object({ noteIds: z.array(z.uuid()), jobId: z.uuid() });
const insertedIds = z.array(z.object({ id: z.uuid() }));

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Waits until `read` returns a value `done` accepts, polling as a test of an asynchronous worker must. */
async function eventually<Value>(
  read: () => Promise<Value>,
  done: (value: Value) => boolean,
  timeoutMilliseconds = 30_000,
): Promise<Value> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await pause(200);
  }
}

/** The messages of an error and its causes: Drizzle wraps the database error as the cause. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause === undefined ? error.message : `${error.message}: ${describeError(error.cause)}`;
}

describe('background jobs', () => {
  let harness: ApiHarness;
  let buyer: IssuedToken;
  let runner: JobRunner;
  let transactions: TenantTransactions;
  let queue: JobQueue;

  beforeAll(async () => {
    harness = await startApiHarness({ process: { registry: jobsTestRegistry, jobs: jobsTestJobs, workers: false } });
    const migrator = await harness.database.connect('pl_migrator');
    await migrator.query(jobsTestTables);
    await migrator.end();
    buyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    runner = harness.api.app.get(JobRunner);
    transactions = harness.api.app.get(TenantTransactions);
    queue = harness.api.app.get(JobQueue);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    jobProbe.reset();
  });

  function startWorker(): Promise<RunningApi> {
    return harness.startAnotherApi({
      registry: jobsTestRegistry,
      jobs: jobsTestJobs,
      workers: true,
      catalogTables: jobsTestCatalogTables,
    });
  }

  function commandEnvelope(tenantId: string, payload: Record<string, unknown>): JobEnvelope {
    return { tenantId, cause: 'command', source: commandSource, correlationId: randomUUID(), payload };
  }

  function delivered(name: string, data: unknown): DeliveredJob {
    return { id: randomUUID(), name, data };
  }

  function noteItems(count: number): { readonly noteIds: string[]; readonly items: string[] } {
    const noteIds = Array.from({ length: count }, () => randomUUID());
    return { noteIds, items: noteIds.map((noteId) => `note:${noteId}`) };
  }

  async function outcomesOf(tenantId: string, job: string, items: readonly string[]) {
    const result = await harness.superuser.query(
      `select item_key, status, attempts, failure from job_item_outcomes
        where tenant_id = $1 and job = $2 and item_key = any($3::text[])`,
      [tenantId, job, items],
    );
    const rows = outcomeRows.parse(result.rows);
    return Object.fromEntries(rows.map((row) => [row.item_key, row]));
  }

  async function effectCounts(items: readonly string[]): Promise<Record<string, number>> {
    const result = await harness.superuser.query(
      `select item_key, count(*)::int as count from internal_test_job_effects
        where item_key = any($1::text[]) group by item_key`,
      [items],
    );
    return Object.fromEntries(effectRows.parse(result.rows).map((row) => [row.item_key, row.count]));
  }

  async function jobState(jobId: string) {
    const result = await harness.superuser.query('select state::text, retry_count from pl_jobs.job where id = $1', [
      jobId,
    ]);
    return jobStateRows.parse(result.rows)[0];
  }

  async function chainEntries(tenantId: string, afterSeq = 0) {
    const result = await harness.superuser.query(
      `select seq, actor_type, actor_id, acted_under, correlation_id, payload
         from audit_entries where tenant_id = $1 and seq > $2 order by seq`,
      [tenantId, afterSeq],
    );
    return entryRows.parse(result.rows);
  }

  async function schedulesOf(tenantId: string) {
    const result = await harness.superuser.query(
      `select name, key, cron, timezone, data from pl_jobs.schedule where data ->> 'tenantId' = $1 order by key`,
      [tenantId],
    );
    return scheduleRows.parse(result.rows);
  }

  function nightlyScheduleOf(tenantId: string) {
    return {
      name: 'audit.verifyChain',
      key: `${nightlySchedule}/${tenantId}`,
      cron: '17 3 * * *',
      timezone: 'UTC',
      data: { tenantId, cause: 'schedule', source: nightlySchedule, payload: {} },
    };
  }

  describe('enqueuing inside the command transaction', () => {
    it("runs a committed command's job after the enqueuing process is killed right after the commit", async () => {
      const outDir = join(apiDirectory, 'node_modules', '.cache', 'jobs-enqueue-then-die');
      await build({
        root: apiDirectory,
        configFile: false,
        logLevel: 'silent',
        build: {
          ssr: 'test/support/enqueue-then-die.ts',
          outDir,
          emptyOutDir: true,
          target: 'node24',
          sourcemap: false,
        },
        ssr: { noExternal: [/^@partledger\//] },
      });
      const settings = {
        databaseUrl: harness.database.connectionString('pl_app'),
        jobsDatabaseUrl: harness.database.connectionString('pl_job_runner'),
        tenantId: harness.tenantA,
        credentialId: buyer.credentialId,
      };
      const child = spawnSync(process.execPath, [join(outDir, 'enqueue-then-die.js'), JSON.stringify(settings)], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, TZ: 'UTC' },
      });
      expect(child.signal).toBe('SIGKILL');
      const outcome = z
        .object({ kind: z.literal('success'), output: createdNotes })
        .parse(JSON.parse(child.stdout.trim()));
      const { noteIds, jobId } = outcome.output;
      expect(await jobState(jobId)).toEqual({ state: 'created', retry_count: 0 });

      const worker = await startWorker();
      try {
        await eventually(
          () => jobState(jobId),
          (current) => current?.state === 'completed',
        );
      } finally {
        await worker.close();
      }
      expect(await jobState(jobId)).toEqual({ state: 'completed', retry_count: 0 });
      const items = noteIds.map((noteId) => `note:${noteId}`);
      expect(await effectCounts(items)).toEqual(Object.fromEntries(items.map((item) => [item, 1])));
      const applied = (await chainEntries(harness.tenantA)).filter(
        (entry) =>
          entry.payload.event === 'jobsTest.noteApplied' && noteIds.includes(String(entry.payload.data.noteId)),
      );
      expect(applied).toHaveLength(2);
      for (const entry of applied) {
        expect(entry).toMatchObject({
          actor_type: 'system',
          actor_id: null,
          acted_under: { grant: 'job', jobId, cause: 'command', source: commandSource },
          payload: { adapter: 'jobs' },
        });
      }
    });

    it('enqueues nothing for a command that rolls back after enqueuing', async () => {
      const jobsBefore = await harness.count(`select 1 from pl_jobs.job where name = $1`, [applyNotesJob.name]);
      const notesBefore = await harness.count('select 1 from internal_test_notes');
      const response = await harness.command(
        'staff',
        'jobsTest.createNotesAndEnqueue',
        { count: 3, refuseAfterEnqueue: true },
        { token: buyer.token },
      );
      expect(response.status).toBe(409);
      expect(await harness.count(`select 1 from pl_jobs.job where name = $1`, [applyNotesJob.name])).toBe(jobsBefore);
      expect(await harness.count('select 1 from internal_test_notes')).toBe(notesBefore);
    });

    it('lets pl_app enqueue and read jobs only for the tenant of its transaction', async () => {
      const { noteIds } = noteItems(1);
      const origin = (tenantId: string): JobOrigin => ({
        tenantId,
        cause: 'command',
        source: commandSource,
        correlationId: randomUUID(),
      });
      await transactions.run(harness.tenantB, (database) =>
        queue.enqueue(database, applyNotesJob, origin(harness.tenantB), { noteIds }),
      );
      let refusal = '';
      try {
        await transactions.run(harness.tenantA, (database) =>
          queue.enqueue(database, applyNotesJob, origin(harness.tenantB), { noteIds }),
        );
      } catch (error) {
        refusal = describeError(error);
      }
      expect(refusal).toMatch(/row-level security policy/);
      const visibleToA = await transactions.run(harness.tenantA, async (database) => {
        const result = await database.execute(
          sql`select count(*)::int as count from pl_jobs.job_common where data ->> 'tenantId' = ${harness.tenantB}`,
        );
        return z.tuple([z.object({ count: z.number() })]).parse(result.rows)[0].count;
      });
      expect(visibleToA).toBe(0);
      expect(
        await harness.count(`select 1 from pl_jobs.job_common where data ->> 'tenantId' = $1`, [harness.tenantB]),
      ).toBeGreaterThan(0);
    });

    it('refuses a job payload that carries anything but its declared identifiers', async () => {
      const withTitle = { noteIds: [randomUUID()], title: 'Synthetic free text' };
      let refusal = '';
      try {
        await transactions.run(harness.tenantA, (database) =>
          queue.enqueue(
            database,
            applyNotesJob,
            { tenantId: harness.tenantA, cause: 'command', source: commandSource, correlationId: randomUUID() },
            withTitle,
          ),
        );
      } catch (error) {
        refusal = describeError(error);
      }
      expect(refusal).toMatch(/unrecognized_keys|Unrecognized key/);
      expect(await harness.count(`select 1 from pl_jobs.job where data::text like '%Synthetic free text%'`)).toBe(0);
    });
  });

  describe('per-item outcomes', () => {
    it('records items 1–2 done and item 3 failed when a job fails on item 3 of 5, and the retry processes items 3–5 only', async () => {
      const { noteIds, items } = noteItems(5);
      const job = delivered(applyNotesJob.name, commandEnvelope(harness.tenantA, { noteIds }));
      const [first, second, third, fourth, fifth] = items;
      if (third === undefined) {
        throw new Error('Five items expected');
      }
      jobProbe.refuseOnce.add(third);

      let failure: unknown;
      try {
        await runner.run(job);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(JobItemFailedError);
      expect(failure instanceof JobItemFailedError ? [failure.item, failure.failure] : []).toEqual([
        third,
        'Unavailable.dependencyUnavailable',
      ]);
      expect(jobProbe.invocations.map((invocation) => invocation.item)).toEqual([first, second, third]);
      expect(await outcomesOf(harness.tenantA, applyNotesJob.name, items)).toEqual({
        [String(first)]: { item_key: first, status: 'done', attempts: 1, failure: null },
        [String(second)]: { item_key: second, status: 'done', attempts: 1, failure: null },
        [third]: { item_key: third, status: 'failed', attempts: 1, failure: 'Unavailable.dependencyUnavailable' },
      });
      expect(await effectCounts(items)).toEqual({ [String(first)]: 1, [String(second)]: 1 });

      jobProbe.invocations = [];
      const retry = await runner.run(job);
      expect(retry).toEqual({ applied: [third, fourth, fifth], skipped: [first, second] });
      expect(jobProbe.invocations.map((invocation) => invocation.item)).toEqual([third, fourth, fifth]);
      const outcomes = await outcomesOf(harness.tenantA, applyNotesJob.name, items);
      expect(Object.values(outcomes).map((outcome) => outcome.status)).toEqual(Array(5).fill('done'));
      expect(outcomes[third]).toEqual({ item_key: third, status: 'done', attempts: 2, failure: null });
      expect(await effectCounts(items)).toEqual(Object.fromEntries(items.map((item) => [item, 1])));
    });

    it('records an item whose handler throws as an unexpected failure and keeps none of its effects', async () => {
      const { noteIds, items } = noteItems(2);
      const [first, second] = items;
      if (second === undefined) {
        throw new Error('Two items expected');
      }
      jobProbe.throwOnce.add(second);
      const job = delivered(applyNotesJob.name, commandEnvelope(harness.tenantA, { noteIds }));
      await expect(runner.run(job)).rejects.toThrow(JobItemFailedError);
      expect(await outcomesOf(harness.tenantA, applyNotesJob.name, [second])).toEqual({
        [second]: { item_key: second, status: 'failed', attempts: 1, failure: 'unexpected' },
      });
      expect(await effectCounts(items)).toEqual({ [String(first)]: 1 });
    });

    it('does not apply an item twice when a redelivered job runs alongside the first', async () => {
      const { noteIds, items } = noteItems(5);
      const job = delivered(applyNotesJob.name, commandEnvelope(harness.tenantA, { noteIds }));
      jobProbe.delayMilliseconds = 150;
      const [one, two] = await Promise.all([runner.run(job), runner.run(job)]);
      expect(jobProbe.invocations).toHaveLength(5);
      expect([...one.applied, ...two.applied].sort()).toEqual([...items].sort());
      expect([...one.skipped, ...two.skipped].sort()).toEqual([...items].sort());
      expect(await effectCounts(items)).toEqual(Object.fromEntries(items.map((item) => [item, 1])));
    });

    it('lets pg-boss retry a failed run, which resumes from the failed item', async () => {
      const { noteIds, items } = noteItems(5);
      const third = items[2];
      if (third === undefined) {
        throw new Error('Five items expected');
      }
      jobProbe.refuseOnce.add(third);
      const worker = await startWorker();
      let jobId = '';
      try {
        jobId = await transactions.run(harness.tenantA, (database) =>
          queue.enqueue(
            database,
            applyNotesJob,
            { tenantId: harness.tenantA, cause: 'command', source: commandSource, correlationId: randomUUID() },
            { noteIds },
          ),
        );
        await eventually(
          () => jobState(jobId),
          (current) => current?.state === 'completed',
        );
      } finally {
        await worker.close();
      }
      expect(await jobState(jobId)).toEqual({ state: 'completed', retry_count: 1 });
      expect(
        jobProbe.invocations.filter((invocation) => invocation.jobId === jobId).map((invocation) => invocation.item),
      ).toEqual([items[0], items[1], third, third, items[3], items[4]]);
      expect(await effectCounts(items)).toEqual(Object.fromEntries(items.map((item) => [item, 1])));
    });
  });

  describe('tenant isolation', () => {
    it("keeps a job for tenant A from reading tenant B's rows", async () => {
      const insertNote = async (tenantId: string) => {
        const result = await harness.superuser.query(
          `insert into internal_test_notes (tenant_id, title, actor_type) values ($1, 'Synthetic gasket', 'person')
           returning id`,
          [tenantId],
        );
        const [row] = insertedIds.parse(result.rows);
        if (row === undefined) {
          throw new Error('The note was not inserted');
        }
        return row.id;
      };
      await insertNote(harness.tenantA);
      const noteOfB = await insertNote(harness.tenantB);
      await runner.run(delivered('jobsTest.observeNotes', commandEnvelope(harness.tenantA, { noteId: noteOfB })));
      await runner.run(delivered('jobsTest.observeNotes', commandEnvelope(harness.tenantB, { noteId: noteOfB })));
      expect(jobProbe.observations).toEqual([
        { tenantsSeen: [harness.tenantA], foundNote: false },
        { tenantsSeen: [harness.tenantB], foundNote: true },
      ]);
    });
  });

  describe('tenant enrolment', () => {
    it('schedules the nightly chain verification for a tenant whose provisioning command enrols it, once a worker runs', async () => {
      const tenantD = await insertTenant(harness.superuser, 'tenant-d');
      const buyerOfD = await harness.issue('staff_session', tenantD, { roles: ['buyer'] });
      const response = await harness.command('staff', 'jobsTest.provisionTenant', {}, { token: buyerOfD.token });
      expect(response.status).toBe(200);
      expect(await schedulesOf(tenantD)).toEqual([]);
      const worker = await startWorker();
      try {
        await eventually(
          () => schedulesOf(tenantD),
          (schedules) => schedules.length > 0,
        );
      } finally {
        await worker.close();
      }
      expect(await schedulesOf(tenantD)).toEqual([nightlyScheduleOf(tenantD)]);
      expect(await harness.count('select 1 from pl_jobs.tenant_enrolment where tenant_id = $1', [tenantD])).toBe(1);
    });

    it("refuses to enrol a tenant from a transaction that is not that tenant's", async () => {
      const principal: SystemPrincipal = {
        type: 'system',
        tenantId: harness.tenantA,
        actedUnder: { grant: 'job', jobId: randomUUID(), cause: 'command', source: commandSource },
        adapter: 'jobs',
        correlationId: randomUUID(),
      };
      let refusal: unknown;
      try {
        await transactions.run(harness.tenantA, (database) =>
          enqueueTenantEnrolment(
            { database, jobs: new CommandJobs(queue, database, principal, 'jobsTest.provisionTenant') },
            harness.tenantB,
          ),
        );
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(TenantEnrolmentContextError);
    });
  });

  describe('schedule synchronisation', () => {
    let boss: PgBoss;
    const declared = productionJobs.schedules;

    beforeAll(() => {
      boss = harness.api.app.get<PgBoss>(jobBoss);
    });

    function schedulerDeclaring(schedules: readonly JobSchedule[]): JobScheduler {
      return new JobScheduler(boss, { jobs: jobsTestJobs.jobs, schedules });
    }

    it('keeps enrolled tenants when a build that declares no schedules synchronises, and a restored build still has them', async () => {
      const tenant = await insertTenant(harness.superuser, 'tenant-e');
      await schedulerDeclaring(declared).enrollTenant(tenant);
      await schedulerDeclaring([]).synchronise();
      expect(await schedulesOf(tenant)).toEqual([nightlyScheduleOf(tenant)]);
      await boss.unschedule('audit.verifyChain', `${nightlySchedule}/${tenant}`);
      await schedulerDeclaring(declared).synchronise();
      expect(await schedulesOf(tenant)).toEqual([nightlyScheduleOf(tenant)]);
    });

    it('keeps a tenant whose schedules a crashed synchronisation removed before writing them again', async () => {
      const tenant = await insertTenant(harness.superuser, 'tenant-f');
      await schedulerDeclaring(declared).enrollTenant(tenant);
      await boss.unschedule('audit.verifyChain', `${nightlySchedule}/${tenant}`);
      expect(await schedulesOf(tenant)).toEqual([]);
      await schedulerDeclaring(declared).synchronise();
      expect(await schedulesOf(tenant)).toEqual([nightlyScheduleOf(tenant)]);
    });

    it('replaces a renamed schedule for every enrolled tenant', async () => {
      const tenant = await insertTenant(harness.superuser, 'tenant-g');
      await schedulerDeclaring(declared).enrollTenant(tenant);
      const renamed = defineSchedule({
        name: 'audit.nightlyVerification',
        job: verifyChainJob,
        cron: '5 4 * * *',
        payload: {},
      });
      await schedulerDeclaring([renamed]).synchronise();
      expect((await schedulesOf(tenant)).map((schedule) => schedule.key)).toEqual([
        `audit.nightlyVerification/${tenant}`,
      ]);
      await schedulerDeclaring(declared).synchronise();
      expect(await schedulesOf(tenant)).toEqual([nightlyScheduleOf(tenant)]);
    });
  });

  describe('failures that reach pg-boss', () => {
    it('let no query, parameter or personal value of a failing items stage or failure record reach pg-boss or the logs', async () => {
      const logged: string[] = [];
      const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
      const worker = await startWorker();
      const migrator = await harness.database.connect('pl_migrator');
      const jobIds: string[] = [];
      try {
        await migrator.query(failingFailureRecord);
        const stages: readonly ('items' | 'recordFailure')[] = ['items', 'recordFailure'];
        for (const stage of stages) {
          jobIds.push(
            await transactions.run(harness.tenantA, (database) =>
              queue.enqueue(
                database,
                misbehaveJob,
                { tenantId: harness.tenantA, cause: 'command', source: commandSource, correlationId: randomUUID() },
                { stage },
              ),
            ),
          );
        }
        for (const jobId of jobIds) {
          await eventually(
            () => jobState(jobId),
            (current) => current?.state === 'failed',
          );
        }
      } finally {
        await migrator.query(`drop trigger job_item_outcomes_refuse_failed on job_item_outcomes;
                              drop function pl_migration.refuse_failed_item()`);
        await migrator.end();
        await worker.close();
        spy.mockRestore();
      }
      const outputs = await harness.superuser.query(
        'select id, state::text, output::text as output from pl_jobs.job where id = any($1::uuid[])',
        [jobIds],
      );
      const stored = z.array(z.object({ id: z.uuid(), state: z.string(), output: z.string() })).parse(outputs.rows);
      expect(stored.map((row) => row.state)).toEqual(['failed', 'failed']);
      for (const { output } of stored) {
        expect(output).not.toContain(leakedValue);
        expect(output).not.toMatch(/params|select|insert into|Failed query/i);
        expect(output).toContain('JobRunFailedError');
      }
      for (const jobId of jobIds) {
        expect(logged.some((message) => message.includes(`correlation ${jobId}`))).toBe(true);
      }
      for (const message of logged) {
        expect(message).not.toContain(leakedValue);
        expect(message).not.toContain('params:');
      }
    });
  });

  describe('the nightly chain verification', () => {
    let tenantC: string;

    beforeAll(async () => {
      tenantC = await insertTenant(harness.superuser, 'tenant-c');
    });

    it('is scheduled for a tenant once its enrolment job runs, however often that job runs', async () => {
      const enrolment = delivered('jobs.enrollTenant', commandEnvelope(tenantC, {}));
      await runner.run(enrolment);
      await runner.run(delivered('jobs.enrollTenant', commandEnvelope(tenantC, {})));
      expect(await schedulesOf(tenantC)).toEqual([
        {
          name: 'audit.verifyChain',
          key: `${nightlySchedule}/${tenantC}`,
          cron: '17 3 * * *',
          timezone: 'UTC',
          data: { tenantId: tenantC, cause: 'schedule', source: nightlySchedule, payload: {} },
        },
      ]);
    });

    it('records an audit entry as the system principal that names its schedule, once per run', async () => {
      const [schedule] = await schedulesOf(tenantC);
      const before = (await chainEntries(tenantC)).length;
      const run = delivered('audit.verifyChain', schedule?.data);
      await runner.run(run);
      await runner.run(run);
      const added = await chainEntries(tenantC, before);
      expect(added).toEqual([
        {
          seq: before + 1,
          actor_type: 'system',
          actor_id: null,
          acted_under: { grant: 'job', jobId: run.id, cause: 'schedule', source: nightlySchedule },
          correlation_id: run.id,
          payload: {
            event: 'audit.chainVerified',
            adapter: 'jobs',
            correlationId: run.id,
            data: { length: before },
          },
        },
      ]);
    });

    it('raises an operational alert naming the first failing sequence number when the chain fails', async () => {
      await harness.superuser.query('begin');
      try {
        await harness.superuser.query('alter table audit_entries disable trigger audit_entries_refuse_update_delete');
        await harness.superuser.query(
          `update audit_entries set payload = jsonb_set(payload, '{data,schedules}', '7') where tenant_id = $1 and seq = 1`,
          [tenantC],
        );
        await harness.superuser.query(
          'alter table audit_entries enable always trigger audit_entries_refuse_update_delete',
        );
        await harness.superuser.query('commit');
      } catch (error) {
        await harness.superuser.query('rollback');
        throw error;
      }
      const [schedule] = await schedulesOf(tenantC);
      const run = delivered('audit.verifyChain', schedule?.data);
      await runner.run(run);
      await runner.run(run);
      const alerts = await harness.superuser.query(
        `select kind, key, params, raised_by_job_id from operational_alerts where tenant_id = $1`,
        [tenantC],
      );
      expect(alerts.rows).toEqual([
        {
          kind: 'chainVerificationFailed',
          key: `verification:${run.id}`,
          params: { firstFailingSeq: 1, reason: 'record_mismatch' },
          raised_by_job_id: run.id,
        },
      ]);
      const [last] = (await chainEntries(tenantC)).slice(-1);
      expect(last).toMatchObject({
        actor_type: 'system',
        acted_under: { grant: 'job', jobId: run.id, cause: 'schedule', source: nightlySchedule },
        payload: { event: 'audit.chainVerificationFailed', data: { firstFailingSeq: 1, reason: 'record_mismatch' } },
      });
    });
  });
});
