import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { JsonObject } from '@partledger/chain';
import type { DomainError } from '@partledger/domain';
import { z } from 'zod';

import type { AuditPayload, AuditToken } from '../audit/audit-payload';
import { appendAuditEntry, auditActorOf } from '../audit/audit-writer';
import { TenantTransactions, type AppDatabase } from '../db/tenant-transaction';
import type { SystemPrincipal } from '../principals/principal';
import { clock, type Clock } from '../time/clock';
import { claimItem, recordItemFailure } from './item-outcomes';
import {
  jobEnvelopeSchema,
  jobItemKeyPattern,
  type JobAudit,
  type JobContext,
  type JobHandler,
  type JobRegistration,
  type ModuleJobs,
} from './job.types';
import { systemPrincipalFor } from './system-principal';

export const jobCatalog = Symbol('JobCatalog');

/** A job as pg-boss delivers it; its data is parsed, never trusted. */
export interface DeliveredJob {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
}

export interface JobRunSummary {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export class UnknownJobError extends Error {
  constructor(name: string) {
    super(`No job named ${name} is registered`);
    this.name = 'UnknownJobError';
  }
}

export class InvalidJobItemsError extends Error {
  constructor(job: string, problem: string) {
    super(`Job ${job} named its items wrongly: ${problem}`);
    this.name = 'InvalidJobItemsError';
  }
}

/**
 * A run that stopped at a failed item. Its message holds codes and keys only, because pg-boss
 * stores it with the job, outside row-level security; the underlying error is logged.
 */
export class JobItemFailedError extends Error {
  readonly item: string;
  readonly failure: string;

  constructor(job: string, item: string, failure: string) {
    super(`Job ${job} failed at item ${item}: ${failure}`);
    this.name = 'JobItemFailedError';
    this.item = item;
    this.failure = failure;
  }
}

class ItemRefused extends Error {
  readonly error: DomainError;

  constructor(error: DomainError) {
    super('The item was refused; its transaction rolls back');
    this.error = error;
  }
}

class ItemAudit implements JobAudit {
  constructor(
    private readonly database: AppDatabase,
    private readonly principal: SystemPrincipal,
    private readonly time: Clock,
  ) {}

  async record<const Data extends JsonObject>(event: AuditToken, data: AuditPayload<Data>): Promise<void> {
    await appendAuditEntry(
      this.database,
      { tenantId: this.principal.tenantId, actor: auditActorOf(this.principal), event, data },
      this.time,
    );
  }
}

const jobIdSchema = z.uuid();

/**
 * Runs one delivery of a job (KTD16): parse its envelope and payload, act as the `system`
 * principal in the job's tenant, list the items in one tenant transaction, then apply each
 * item in a transaction of its own that first claims it. The first failed item is recorded
 * as failed and stops the run, so the retry resumes from it; items already done are skipped.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger('JobRunner');
  private readonly registrations: ReadonlyMap<string, JobRegistration>;

  constructor(
    @Inject(jobCatalog) catalog: ModuleJobs,
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(clock) private readonly time: Clock,
  ) {
    this.registrations = new Map(catalog.jobs.map((registration) => [registration.declaration.name, registration]));
  }

  async run(job: DeliveredJob): Promise<JobRunSummary> {
    const registration = this.registrations.get(job.name);
    if (registration === undefined) {
      throw new UnknownJobError(job.name);
    }
    const jobId = jobIdSchema.parse(job.id);
    const envelope = jobEnvelopeSchema.parse(job.data);
    const { declaration } = registration;
    const payload = declaration.payload.parse(envelope.payload);
    const principal = systemPrincipalFor(envelope, jobId);
    const handler: JobHandler = this.moduleRef.get(registration.handler, { strict: false });

    const items = await this.transactions.run(principal.tenantId, (database) =>
      handler.items(payload, { jobId, principal, database, now: this.time.now() }),
    );
    checkItems(declaration.name, items);

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const now = this.time.now();
      const reference = { tenantId: principal.tenantId, job: declaration.name, itemKey: item, jobId, now };
      try {
        const done = await this.transactions.run(principal.tenantId, async (database) => {
          if (!(await claimItem(database, reference))) {
            return false;
          }
          const context: JobContext = { jobId, principal, database, now };
          const result = await handler.apply(item, payload, {
            ...context,
            audit: new ItemAudit(database, principal, this.time),
          });
          if (!result.ok) {
            throw new ItemRefused(result.error);
          }
          return true;
        });
        (done ? applied : skipped).push(item);
      } catch (error) {
        const failure = error instanceof ItemRefused ? `${error.error._tag}.${error.error.reason}` : 'unexpected';
        if (!(error instanceof ItemRefused)) {
          this.logger.error(`Job ${declaration.name} ${jobId} failed at item ${item}: ${describe(error)}`);
        }
        await this.transactions.run(principal.tenantId, (database) =>
          recordItemFailure(database, { ...reference, now: this.time.now(), failure }),
        );
        throw new JobItemFailedError(declaration.name, item, failure);
      }
    }
    return { applied, skipped };
  }
}

function checkItems(job: string, items: readonly string[]): void {
  const invalid = items.filter((item) => !jobItemKeyPattern.test(item));
  if (invalid.length > 0) {
    throw new InvalidJobItemsError(job, `${invalid.length} keys do not match ${jobItemKeyPattern.source}`);
  }
  if (new Set(items).size !== items.length) {
    throw new InvalidJobItemsError(job, 'a key appears twice');
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-error value was thrown';
}
