import { Inject, Injectable } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { jobBoss } from './enqueue';
import { jobCatalog } from './job-runner';
import type { JobEnvelope, JobSchedule, ModuleJobs } from './job.types';

const scheduleTimeZone = 'UTC';

const storedScheduleData = z.object({ tenantId: z.uuid() });

function keyOf(schedule: JobSchedule, tenantId: string): string {
  return `${schedule.name}/${tenantId}`;
}

/**
 * Keeps every module's schedules (KTD38) enrolled for every tenant. A tenant can only be
 * listed in its own context, so the scheduler never lists tenants: a tenant is enrolled once,
 * by the `jobs.enrollTenant` job its creation enqueues, and the schedules already stored name
 * the enrolled tenants when the declared schedules change.
 */
@Injectable()
export class JobScheduler {
  constructor(
    @Inject(jobBoss) private readonly boss: PgBoss,
    @Inject(jobCatalog) private readonly catalog: ModuleJobs,
  ) {}

  /** Creates or updates each declared schedule for the tenant; running it twice changes nothing. Returns their number. */
  async enrollTenant(tenantId: string): Promise<number> {
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
    return this.catalog.schedules.length;
  }

  /** Brings enrolled tenants to the declared schedules: adds new ones, updates changed ones, drops removed ones. */
  async synchronise(): Promise<void> {
    const stored = await this.boss.getSchedules();
    const tenants = new Set<string>();
    for (const schedule of stored) {
      const data = storedScheduleData.safeParse(schedule.data);
      if (data.success) {
        tenants.add(data.data.tenantId);
      }
    }
    const declaredKeys = new Set(
      this.catalog.schedules.flatMap((schedule) =>
        [...tenants].map((tenantId) => `${schedule.job.name} ${keyOf(schedule, tenantId)}`),
      ),
    );
    for (const schedule of stored) {
      if (!declaredKeys.has(`${schedule.name} ${schedule.key}`)) {
        await this.boss.unschedule(schedule.name, schedule.key);
      }
    }
    for (const tenantId of tenants) {
      await this.enrollTenant(tenantId);
    }
  }
}
