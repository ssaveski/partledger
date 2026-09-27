import { Inject, Injectable } from '@nestjs/common';
import { success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditToken } from '../audit/audit-payload';
import type { CommandContext } from '../commands/handlers';
import type { AppDatabase } from '../db/tenant-transaction';
import { JobScheduler } from './job-scheduler';
import { defineJob, type JobContext, type JobHandler, type JobItemContext, type PayloadOf } from './job.types';

/**
 * Enrolls a tenant in every module's schedules, such as the nightly chain verification (R27).
 * The runner cannot list tenants (their table is under row-level security, KTD11), so nothing
 * finds a new tenant by itself: the command that provisions a tenant (U8) calls
 * `enqueueTenantEnrolment` inside its own transaction, the enrolment commits with the tenant,
 * and a worker records it in `pl_jobs.tenant_enrolment` and writes the schedules.
 * docs/runbooks/jobs.md tells how to find a tenant that was never enrolled.
 */
export const enrollTenantJob = defineJob({
  name: 'jobs.enrollTenant',
  description: 'Enrolls the tenant in every scheduled job, such as the nightly chain verification.',
  payload: {},
  retryLimit: 5,
  retryDelaySeconds: 60,
});

@Injectable()
export class EnrollTenantHandler implements JobHandler<typeof enrollTenantJob> {
  constructor(@Inject(JobScheduler) private readonly scheduler: JobScheduler) {}

  items(_payload: PayloadOf<typeof enrollTenantJob>, context: JobContext): Promise<readonly string[]> {
    return Promise.resolve([`enrolment:${context.jobId}`]);
  }

  async apply(
    _item: string,
    _payload: PayloadOf<typeof enrollTenantJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const schedules = await this.scheduler.enrollTenant(context.principal.tenantId);
    await context.audit.record(auditToken('jobs.tenantEnrolled'), { schedules });
    return success(undefined);
  }
}

export class TenantEnrolmentContextError extends Error {
  constructor() {
    super('A tenant is enrolled only in a transaction whose app.tenant_id is that tenant');
    this.name = 'TenantEnrolmentContextError';
  }
}

const currentTenantRows = z.tuple([z.object({ tenant: z.string().nullable() })]);

/**
 * Enqueues the enrolment of a newly provisioned tenant in the caller's transaction, so it
 * commits, or rolls back, with the tenant. Contract: `database` is a transaction whose
 * `app.tenant_id` is `tenantId` (the command's own transaction by default); anything else is a
 * programming error and throws `TenantEnrolmentContextError`. Returns the job id.
 */
export async function enqueueTenantEnrolment(
  context: Pick<CommandContext, 'database' | 'jobs'>,
  tenantId: string,
  database: AppDatabase = context.database,
): Promise<string> {
  const result = await database.execute(sql`select current_setting('app.tenant_id', true) as tenant`);
  if (currentTenantRows.parse(result.rows)[0].tenant !== tenantId) {
    throw new TenantEnrolmentContextError();
  }
  return context.jobs.enqueueFor(database, tenantId, enrollTenantJob, {});
}
