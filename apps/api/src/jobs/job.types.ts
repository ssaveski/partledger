import type { Type } from '@nestjs/common';
import type { JsonObject } from '@partledger/chain';
import type { DomainError, Result } from '@partledger/domain';
import { z } from 'zod';

import { auditTokenPattern, type AuditPayload, type AuditToken } from '../audit/audit-payload';
import type { AppDatabase } from '../db/tenant-transaction';
import type { SystemPrincipal } from '../principals/principal';

/**
 * Background jobs (KTD16, R26). A job is declared once with the payload it carries, which
 * holds identifiers, declared enumerations, counts and hashes only: payloads sit in pg-boss's
 * tables, outside row-level security and erasure, so they never carry personal data or free
 * text. A job runs as the `system` principal in its tenant's transaction, over items named by
 * domain keys, each applied at most once however often the job is delivered.
 */

/** `<module>.<action>`, like command names; it is also the pg-boss queue name. */
export const jobNamePattern = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/** A domain key naming one item of a job, such as a notification id or `verification:<job id>`. */
export const jobItemKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

const payloadFields = new WeakSet<z.ZodType>();

function payloadField<Schema extends z.ZodType>(schema: Schema): Schema {
  payloadFields.add(schema);
  return schema;
}

/** The only fields a job payload may declare. */
export const jobField = {
  id: () => payloadField(z.uuid()),
  ids: (maximum: number) => payloadField(z.array(z.uuid()).min(1).max(maximum)),
  oneOf: <const Values extends readonly [string, ...string[]]>(values: Values) => payloadField(z.enum(values)),
  count: () => payloadField(z.number().int().min(0)),
  hash: () => payloadField(z.string().regex(/^[0-9a-f]{64}$/)),
};

export type JobPayloadShape = Readonly<Record<string, z.ZodType>>;

export interface JobDeclaration<Name extends string = string, Shape extends JobPayloadShape = JobPayloadShape> {
  readonly name: Name;
  readonly description: string;
  readonly payload: z.ZodObject<Shape>;
  /** Retries after a failed run; each retry applies only the items that are not done. */
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  /** A run still active after this long is presumed dead and delivered again. */
  readonly expireInSeconds: number;
}

export type PayloadOf<Declaration extends JobDeclaration> = z.output<Declaration['payload']>;

export class InvalidJobDeclarationError extends Error {
  constructor(name: string, problem: string) {
    super(`Job ${name}: ${problem}`);
    this.name = 'InvalidJobDeclarationError';
  }
}

export function defineJob<const Name extends string, const Shape extends JobPayloadShape>(declaration: {
  readonly name: Name;
  readonly description: string;
  readonly payload: Shape;
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  readonly expireInSeconds?: number;
}): JobDeclaration<Name, Shape> {
  if (!jobNamePattern.test(declaration.name)) {
    throw new InvalidJobDeclarationError(declaration.name, 'the name is not <module>.<action>');
  }
  for (const [field, schema] of Object.entries(declaration.payload)) {
    if (!payloadFields.has(schema)) {
      throw new InvalidJobDeclarationError(declaration.name, `payload field ${field} is not built with jobField`);
    }
  }
  return {
    name: declaration.name,
    description: declaration.description,
    payload: z.strictObject(declaration.payload),
    retryLimit: declaration.retryLimit ?? 3,
    retryDelaySeconds: declaration.retryDelaySeconds ?? 30,
    expireInSeconds: declaration.expireInSeconds ?? 900,
  };
}

const sourceSchema = z.string().max(100).regex(auditTokenPattern);

/**
 * What pg-boss stores as a job's data: the tenant, what enqueued the job, and the payload.
 * The job table's row-level security reads `tenantId`, so `pl_app` can enqueue only for the
 * tenant of its own transaction.
 */
export const jobEnvelopeSchema = z.discriminatedUnion('cause', [
  z.strictObject({
    tenantId: z.uuid(),
    cause: z.literal('command'),
    source: sourceSchema,
    correlationId: z.uuid(),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    tenantId: z.uuid(),
    cause: z.literal('schedule'),
    source: sourceSchema,
    payload: z.record(z.string(), z.unknown()),
  }),
]);

export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

/** What every stage of a run sees. */
export interface JobContext {
  readonly jobId: string;
  readonly principal: SystemPrincipal;
  /** The tenant transaction of this stage, with the job's tenant set as its first statement. */
  readonly database: AppDatabase;
  readonly now: Date;
}

/** Appends an audit entry as the job's principal, in the item's transaction (R26). */
export interface JobAudit {
  record<const Data extends JsonObject>(event: AuditToken, data: AuditPayload<Data>): Promise<void>;
}

/** Enqueues follow-up work in the transaction at hand, so it commits or rolls back with it (KTD16). */
export interface JobEnqueuer {
  enqueue<Declaration extends JobDeclaration>(
    declaration: Declaration,
    payload: PayloadOf<Declaration>,
  ): Promise<string>;
  /** Queues at most one job per key and slot; `null` when one with the key is already queued. */
  enqueue<Declaration extends JobDeclaration>(
    declaration: Declaration,
    payload: PayloadOf<Declaration>,
    singleton: JobSingleton,
  ): Promise<string | null>;
}

/**
 * pg-boss's singleton options: one job per key within each `singletonSeconds` slot. With
 * `singletonNextSlot`, a job asked for while one is queued runs in the next slot instead of
 * being dropped. The key is stored beside the payload, so it holds identifiers only.
 */
export interface JobSingleton {
  readonly singletonKey: string;
  readonly singletonSeconds: number;
  readonly singletonNextSlot?: boolean;
}

export interface JobItemContext<Prepared = unknown> extends JobContext {
  readonly audit: JobAudit;
  /** Which run of this item this is: 1 the first time, one more for each retry after a failure. */
  readonly attempt: number;
  /** Enqueues follow-up jobs in the item's transaction, acting under what enqueued this job. */
  readonly jobs: JobEnqueuer;
  /** What the handler's `prepare` returned for this item; undefined for a handler without one. */
  readonly prepared: Prepared;
}

/**
 * What a handler's `prepare` sees: no transaction, so slow work holds no pooled connection;
 * a short tenant transaction of its own when it needs to read.
 */
export interface JobPreparationContext {
  readonly jobId: string;
  readonly principal: SystemPrincipal;
  readonly now: Date;
  /** Runs work in a short tenant transaction of its own, which ends before this resolves. */
  inTransaction<Value>(work: (database: AppDatabase) => Promise<Value>): Promise<Value>;
}

/**
 * A job's work. `items` names what the run covers; `apply` applies one item in its own tenant
 * transaction, where the item has already been claimed. A failure (returned or thrown) rolls
 * the item back, records it as failed and fails the run, so pg-boss retries it later.
 */
export interface JobHandler<Declaration extends JobDeclaration = JobDeclaration, Prepared = unknown> {
  items(payload: PayloadOf<Declaration>, context: JobContext): Promise<readonly string[]>;
  /**
   * Optional slow work for an item, such as a call to another service, run outside any
   * transaction before the item's transaction opens; `apply` receives its result and must
   * re-check under its own lock whatever the preparation read. A failure here fails the item.
   */
  prepare?(item: string, payload: PayloadOf<Declaration>, context: JobPreparationContext): Promise<Prepared>;
  apply(
    item: string,
    payload: PayloadOf<Declaration>,
    context: JobItemContext<Prepared>,
  ): Promise<Result<void, DomainError>>;
}

export interface JobRegistration<Declaration extends JobDeclaration = JobDeclaration> {
  readonly declaration: Declaration;
  /** A Nest provider, so handlers inject the services they need. */
  readonly handler: Type<JobHandler<Declaration>>;
}

export function registerJob<Declaration extends JobDeclaration>(
  declaration: Declaration,
  handler: Type<JobHandler<Declaration>>,
): JobRegistration<Declaration> {
  return { declaration, handler };
}

/**
 * A recurring job, registered per module (KTD38) in `jobs/schedules/<module>.ts` and enrolled
 * for every tenant: each firing is a job for one tenant, acting under this schedule.
 */
export interface JobSchedule<Declaration extends JobDeclaration = JobDeclaration> {
  /** `<module>.<schedule>`, recorded as the source of every job it fires. */
  readonly name: string;
  readonly job: Declaration;
  /** A cron expression in UTC. */
  readonly cron: string;
  readonly payload: PayloadOf<Declaration>;
}

export function defineSchedule<Declaration extends JobDeclaration>(
  schedule: JobSchedule<Declaration>,
): JobSchedule<Declaration> {
  if (!jobNamePattern.test(schedule.name)) {
    throw new InvalidJobDeclarationError(schedule.job.name, `schedule ${schedule.name} is not <module>.<schedule>`);
  }
  schedule.job.payload.parse(schedule.payload);
  return schedule;
}

/** One module's jobs and schedules. */
export interface ModuleJobs {
  readonly jobs: readonly JobRegistration[];
  readonly schedules: readonly JobSchedule[];
}
