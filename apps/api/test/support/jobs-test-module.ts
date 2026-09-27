import { Injectable } from '@nestjs/common';
import { defineCommand, errorCode, type InputOf } from '@partledger/contracts';
import { defineTableAccess, type TableAccess } from '@partledger/db';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditId, auditToken } from '../../src/audit/audit-payload';
import {
  registerCommand,
  type CommandContext,
  type CommandHandler,
  type HandlerResult,
  type OperationRegistry,
} from '../../src/commands/handlers';
import { combineModuleJobs, productionJobs } from '../../src/jobs/job-registry';
import { enqueueTenantEnrolment } from '../../src/jobs/tenant-enrollment.job';
import {
  defineJob,
  jobField,
  registerJob,
  type JobContext,
  type JobHandler,
  type JobItemContext,
  type ModuleJobs,
  type PayloadOf,
} from '../../src/jobs/job.types';

/**
 * Test-only jobs and a command that enqueues one, never part of the production registries.
 * Their table is created by the tests after the app has booted, outside the shipped schema,
 * beside the harness's notes table.
 * The effects table has no unique key, so an item applied twice would show as two rows.
 */
export const jobsTestTables = `
  create table internal_test_job_effects (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id),
    item_key text not null,
    job_id uuid not null
  );
  call pl_migration.enable_tenant_row_security('public.internal_test_job_effects');
  grant select, insert on internal_test_job_effects to pl_app;
  grant select on internal_test_notes, internal_test_job_effects to pl_backup;
`;

/** The test tables as a later API's boot-time catalog check must know them. */
export const jobsTestCatalogTables: readonly TableAccess[] = [
  defineTableAccess({
    table: 'internal_test_notes',
    tenantKey: 'tenant_id',
    grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE'] },
  }),
  defineTableAccess({
    table: 'internal_test_job_effects',
    tenantKey: 'tenant_id',
    grants: { pl_app: ['SELECT', 'INSERT'] },
  }),
];

/** What the test jobs saw and did, and how they should misbehave; tests reset it. */
export const jobProbe = {
  invocations: new Array<{ readonly jobId: string; readonly item: string }>(),
  /** Items refused once, as an unavailable dependency, then applied on the retry. */
  refuseOnce: new Set<string>(),
  /** Items that throw once. */
  throwOnce: new Set<string>(),
  /** Holds each item's transaction open after its write, to overlap two runs. */
  delayMilliseconds: 0,
  observations: new Array<{ readonly tenantsSeen: readonly string[]; readonly foundNote: boolean }>(),
  reset() {
    this.invocations = [];
    this.refuseOnce.clear();
    this.throwOnce.clear();
    this.delayMilliseconds = 0;
    this.observations = [];
  },
};

export const applyNotesJob = defineJob({
  name: 'jobsTest.applyNotes',
  description: 'Applies each note once, as a job over several items would.',
  payload: { noteIds: jobField.ids(20) },
  retryLimit: 2,
  retryDelaySeconds: 1,
});

@Injectable()
export class ApplyNotesHandler implements JobHandler<typeof applyNotesJob> {
  items(payload: PayloadOf<typeof applyNotesJob>): Promise<readonly string[]> {
    return Promise.resolve(payload.noteIds.map((noteId) => `note:${noteId}`));
  }

  async apply(
    item: string,
    _payload: PayloadOf<typeof applyNotesJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    jobProbe.invocations.push({ jobId: context.jobId, item });
    await context.database.execute(
      sql`insert into internal_test_job_effects (tenant_id, item_key, job_id)
          values (${context.principal.tenantId}, ${item}, ${context.jobId})`,
    );
    await context.audit.record(auditToken('jobsTest.noteApplied'), { noteId: auditId(item.slice('note:'.length)) });
    if (jobProbe.delayMilliseconds > 0) {
      await context.database.execute(sql`select pg_sleep(${jobProbe.delayMilliseconds / 1000})`);
    }
    if (jobProbe.refuseOnce.delete(item)) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    if (jobProbe.throwOnce.delete(item)) {
      throw new Error('Synthetic handler crash');
    }
    return success(undefined);
  }
}

const tenantRows = z.array(z.object({ tenant_id: z.uuid() }));

/** Reads what a job of one tenant can see of the notes table, including another tenant's note by id. */
export const observeNotesJob = defineJob({
  name: 'jobsTest.observeNotes',
  description: "Reports which tenants' notes the job can read.",
  payload: { noteId: jobField.id() },
});

@Injectable()
export class ObserveNotesHandler implements JobHandler<typeof observeNotesJob> {
  items(_payload: PayloadOf<typeof observeNotesJob>, context: JobContext): Promise<readonly string[]> {
    return Promise.resolve([`observation:${context.jobId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof observeNotesJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const all = tenantRows.parse(
      (await context.database.execute(sql`select distinct tenant_id from internal_test_notes`)).rows,
    );
    const byId = await context.database.execute(sql`select id from internal_test_notes where id = ${payload.noteId}`);
    jobProbe.observations.push({ tenantsSeen: all.map((row) => row.tenant_id), foundNote: byId.rows.length > 0 });
    return success(undefined);
  }
}

/** A synthetic personal value that must never reach pg-boss's tables or the logs. */
export const leakedValue = 'Synthetic Person Jane Roe';

/** Fails in the items stage, or has its item refused where recording the failure fails, each quoting `leakedValue`. */
export const misbehaveJob = defineJob({
  name: 'jobsTest.misbehave',
  description: 'Fails where a raw database error would otherwise escape.',
  payload: { stage: jobField.oneOf(['items', 'recordFailure']) },
  retryLimit: 0,
});

/** Makes recording a failed item of that job fail with an error that quotes the personal value. */
export const failingFailureRecord = `
  create function pl_migration.refuse_failed_item() returns trigger language plpgsql
    set search_path = pg_catalog, pg_temp
    as $body$ begin
      if new.job = 'jobsTest.misbehave' and new.status = 'failed' then
        raise exception 'cannot record %', '${leakedValue}';
      end if;
      return new;
    end $body$;
  create trigger job_item_outcomes_refuse_failed before insert or update on job_item_outcomes
    for each row execute function pl_migration.refuse_failed_item();
`;

@Injectable()
export class MisbehaveHandler implements JobHandler<typeof misbehaveJob> {
  async items(payload: PayloadOf<typeof misbehaveJob>, context: JobContext): Promise<readonly string[]> {
    if (payload.stage === 'items') {
      await context.database.execute(sql`select ${leakedValue}::int`);
    }
    return [`misbehave:${context.jobId}`];
  }

  apply(): Promise<Result<void, DomainError>> {
    return Promise.resolve(refuse('Unavailable', 'dependencyUnavailable'));
  }
}

export const jobsTestJobs: ModuleJobs = combineModuleJobs([
  productionJobs,
  {
    jobs: [
      registerJob(applyNotesJob, ApplyNotesHandler),
      registerJob(observeNotesJob, ObserveNotesHandler),
      registerJob(misbehaveJob, MisbehaveHandler),
    ],
    schedules: [],
  },
]);

const insertedNote = z.tuple([z.object({ id: z.uuid() })]);

export const createNotesAndEnqueue = defineCommand({
  name: 'jobsTest.createNotesAndEnqueue',
  description: 'Creates notes and enqueues a job to apply them; optionally refuses afterwards.',
  purpose: 'business',
  input: z
    .object({
      count: z.number().int().min(1).max(10).describe('How many notes to create.'),
      refuseAfterEnqueue: z.boolean().default(false).describe('Refuses after enqueuing, rolling everything back.'),
    })
    .describe('The notes to create.'),
  output: z
    .object({
      noteIds: z.array(z.uuid()).describe('The created notes.'),
      jobId: z.uuid().describe('The enqueued job.'),
    })
    .describe('The notes and the job.'),
  errors: [errorCode('Conflict', 'transitionNotAllowed')],
  access: { person: ['buyer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

@Injectable()
export class CreateNotesAndEnqueueHandler implements CommandHandler<typeof createNotesAndEnqueue> {
  async execute(
    input: InputOf<typeof createNotesAndEnqueue>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof createNotesAndEnqueue>> {
    const noteIds: string[] = [];
    for (let position = 0; position < input.count; position += 1) {
      const result = await context.database.execute(
        sql`insert into internal_test_notes (tenant_id, title, actor_type)
            values (${context.principal.tenantId}, ${`Synthetic bracket ${position}`}, ${context.principal.type})
            returning id`,
      );
      noteIds.push(insertedNote.parse(result.rows)[0].id);
    }
    const jobId = await context.jobs.enqueue(applyNotesJob, { noteIds });
    if (input.refuseAfterEnqueue) {
      return refuse('Conflict', 'transitionNotAllowed');
    }
    return success({ noteIds, jobId });
  }
}

/** Stands in for U8's tenant provisioning: enrols the tenant of its transaction in the scheduled jobs. */
export const provisionTenant = defineCommand({
  name: 'jobsTest.provisionTenant',
  description: "Enrols the caller's tenant in the scheduled jobs, as provisioning will for a new tenant.",
  purpose: 'business',
  input: z.object({}).describe("Nothing: the tenant is the transaction's."),
  output: z.object({ jobId: z.uuid().describe('The enrolment job.') }).describe('The enrolment job.'),
  errors: [],
  access: { person: ['buyer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

@Injectable()
export class ProvisionTenantHandler implements CommandHandler<typeof provisionTenant> {
  async execute(
    _input: InputOf<typeof provisionTenant>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof provisionTenant>> {
    return success({ jobId: await enqueueTenantEnrolment(context, context.principal.tenantId) });
  }
}

export const jobsTestRegistry: OperationRegistry = {
  commands: [
    registerCommand(createNotesAndEnqueue, CreateNotesAndEnqueueHandler),
    registerCommand(provisionTenant, ProvisionTenantHandler),
  ],
  queries: [],
};
