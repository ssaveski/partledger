import { Inject, Injectable } from '@nestjs/common';
import { jsonValueOf } from '@partledger/chain';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type DrizzleTransactionLike, type PgBoss } from 'pg-boss';

import { unsafeAuditValues } from '../audit/audit-payload';
import type { AppDatabase } from '../db/tenant-transaction';
import type { Principal } from '../principals/principal';
import { jobEnvelopeSchema, type JobDeclaration, type JobEnvelope, type PayloadOf } from './job.types';

export const jobBoss = Symbol('JobBoss');

/** What enqueued a job: everything in its envelope except the payload. */
export type JobOrigin = JobEnvelope extends infer Envelope
  ? Envelope extends JobEnvelope
    ? Omit<Envelope, 'payload'>
    : never
  : never;

export class UnsafeJobPayloadError extends Error {
  constructor(job: string, fields: readonly string[]) {
    super(`The payload of ${job} carries values that are not identifiers, codes or numbers: ${fields.join(', ')}`);
    this.name = 'UnsafeJobPayloadError';
  }
}

export class JobNotEnqueuedError extends Error {
  constructor(job: string) {
    super(`pg-boss did not enqueue ${job}`);
    this.name = 'JobNotEnqueuedError';
  }
}

/**
 * Enqueues jobs inside the caller's transaction (KTD16): the insert runs on that transaction's
 * connection, so a job commits with the command that caused it, a rolled-back command leaves
 * no job, and a committed job survives the process. The job table's policy admits only the
 * tenant of that transaction.
 */
@Injectable()
export class JobQueue {
  constructor(@Inject(jobBoss) private readonly boss: PgBoss) {}

  async enqueue<Declaration extends JobDeclaration>(
    transaction: DrizzleTransactionLike,
    declaration: Declaration,
    origin: JobOrigin,
    payload: PayloadOf<Declaration>,
  ): Promise<string> {
    const envelope = jobEnvelopeSchema.parse({ ...origin, payload: declaration.payload.parse(payload) });
    const unsafe = unsafeAuditValues(jsonValueOf(envelope.payload));
    if (unsafe.length > 0) {
      throw new UnsafeJobPayloadError(declaration.name, unsafe);
    }
    // pg-boss names this option `db`.
    const jobId = await this.boss.send(declaration.name, envelope, { ['db']: fromDrizzle(transaction, sql) });
    if (jobId === null) {
      throw new JobNotEnqueuedError(declaration.name);
    }
    return jobId;
  }
}

/** A command's way to enqueue follow-up work, bound to its transaction, tenant and name. */
export class CommandJobs {
  constructor(
    private readonly queue: JobQueue,
    private readonly database: AppDatabase,
    private readonly principal: Principal,
    private readonly command: string,
  ) {}

  enqueue<Declaration extends JobDeclaration>(
    declaration: Declaration,
    payload: PayloadOf<Declaration>,
  ): Promise<string> {
    return this.enqueueFor(this.database, this.principal.tenantId, declaration, payload);
  }

  /**
   * Enqueues for a tenant other than the principal's, in a transaction whose `app.tenant_id`
   * is that tenant (the job table's policy refuses anything else); tenant provisioning uses it.
   */
  enqueueFor<Declaration extends JobDeclaration>(
    database: AppDatabase,
    tenantId: string,
    declaration: Declaration,
    payload: PayloadOf<Declaration>,
  ): Promise<string> {
    return this.queue.enqueue(
      database,
      declaration,
      { tenantId, cause: 'command', source: this.command, correlationId: this.principal.correlationId },
      payload,
    );
  }
}
