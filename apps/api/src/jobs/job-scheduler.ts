import { Inject, Injectable } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { jobBoss } from './enqueue';
import { jobCatalog } from './job-runner';
import type { JobEnvelope, JobSchedule, ModuleJobs } from './job.types';
import { jobQueueSchema } from './queue-schema';

const scheduleTimeZone = 'UTC';

const tenantIdSchema = z.uuid();
const storedScheduleData = z.object({ tenantId: z.uuid() });
const enrolmentRows = z.array(z.object({ tenant_id: z.uuid() }));

function keyOf(schedule: JobSchedule, tenantId: string): string {
  return `${schedule.name}/${tenantId}`;
}

/**
 * Keeps every module's schedules (KTD38) in place for every enrolled tenant. The runner cannot
 * list tenants, whose table is under row-level security, so enrolment is recorded in
 * `pl_jobs.tenant_enrolment`, apart from the schedules: a tenant is enrolled by the
 * `jobs.enrollTenant` job its creation enqueues (see `enqueueTenantEnrolment`), and stays
 * enrolled whatever happens to the declared schedules.
 */
@Injectable()
export class JobScheduler {
  constructor(
    @Inject(jobBoss) private readonly boss: PgBoss,
    @Inject(jobCatalog) private readonly catalog: ModuleJobs,
  ) {}

  /** Records the tenant as enrolled, then creates or updates each declared schedule for it. Returns their number. */
  async enrollTenant(tenantId: string): Promise<number> {
    await this.recordEnrolment(tenantIdSchema.parse(tenantId));
    await this.scheduleFor(tenantId);
    return this.catalog.schedules.length;
  }

  /**
   * Brings every enrolled tenant to the declared schedules. Each tenant's declared schedules are
   * written before any stale one is removed, and nothing is removed while no schedule is
   * declared, so neither a crash part-way nor a build that declares none loses a tenant.
   */
  async synchronise(): Promise<void> {
    const stored = await this.boss.getSchedules();
    const tenants = new Set(await this.enrolledTenants());
    for (const schedule of stored) {
      const data = storedScheduleData.safeParse(schedule.data);
      if (data.success && !tenants.has(data.data.tenantId)) {
        await this.recordEnrolment(data.data.tenantId);
        tenants.add(data.data.tenantId);
      }
    }
    for (const tenantId of tenants) {
      await this.scheduleFor(tenantId);
    }
    if (this.catalog.schedules.length === 0) {
      return;
    }
    const declared = new Set(
      this.catalog.schedules.flatMap((schedule) =>
        [...tenants].map((tenantId) => `${schedule.job.name} ${keyOf(schedule, tenantId)}`),
      ),
    );
    for (const schedule of stored) {
      if (storedScheduleData.safeParse(schedule.data).success && !declared.has(`${schedule.name} ${schedule.key}`)) {
        await this.boss.unschedule(schedule.name, schedule.key);
      }
    }
  }

  private async scheduleFor(tenantId: string): Promise<void> {
    for (const schedule of this.catalog.schedules) {
      const envelope: JobEnvelope = {
        tenantId,
        cause: 'schedule',
        source: schedule.name,
        payload: schedule.job.payload.parse(schedule.payload),
      };
      await this.boss.schedule(schedule.job.name, schedule.cron, envelope, {
        key: keyOf(schedule, tenantId),
        tz: scheduleTimeZone,
      });
    }
  }

  private async recordEnrolment(tenantId: string): Promise<void> {
    await this.boss.getDb().executeSql(
      `insert into ${jobQueueSchema}.tenant_enrolment (tenant_id, enrolled_at) values ($1, now())
         on conflict (tenant_id) do nothing`,
      [tenantId],
    );
  }

  private async enrolledTenants(): Promise<string[]> {
    const result = await this.boss.getDb().executeSql(`select tenant_id from ${jobQueueSchema}.tenant_enrolment`);
    return enrolmentRows.parse(result.rows).map((row) => row.tenant_id);
  }
}
