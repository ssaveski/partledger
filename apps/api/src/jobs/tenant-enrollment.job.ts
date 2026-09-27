import { Inject, Injectable } from '@nestjs/common';
import { success, type DomainError, type Result } from '@partledger/domain';

import { auditToken } from '../audit/audit-payload';
import { JobScheduler } from './job-scheduler';
import { defineJob, type JobContext, type JobHandler, type JobItemContext, type PayloadOf } from './job.types';

/**
 * Enrolls a tenant in every module's schedules. Tenant creation (U8) enqueues it in its own
 * transaction, so a tenant that exists always gets its schedules.
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
