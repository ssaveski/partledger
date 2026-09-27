import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrationsFolder } from '@partledger/db';
import { describe, expect, it } from 'vitest';

import { VerifyChainHandler, verifyChainJob } from '../audit/chain-verification.job';
import { combineModuleJobs, InvalidJobRegistryError, productionJobs } from './job-registry';
import { defineJob, defineSchedule, registerJob } from './job.types';
import { jobQueueConstructionSql } from './queue-schema';

describe('the job registry', () => {
  it('registers the nightly chain verification, the tenant enrolment job, the notification jobs, the second-factor reset, the organization clean-up after a removal, the upload scans and the supplier identity checks', () => {
    expect(productionJobs.jobs.map((registration) => registration.declaration.name).sort()).toEqual([
      'audit.verifyChain',
      'auth.resetSecondFactor',
      'identityChecks.run',
      'jobs.enrollTenant',
      'members.leaveOrganization',
      'notifications.deliverOperationalAlerts',
      'notifications.send',
      'uploads.releaseQuarantine',
      'uploads.rescanPending',
      'uploads.scan',
    ]);
    expect(
      productionJobs.schedules
        .map((schedule) => [schedule.name, schedule.job.name, schedule.cron])
        .sort(([left = ''], [right = '']) => left.localeCompare(right)),
    ).toEqual([
      ['audit.nightlyChainVerification', 'audit.verifyChain', '17 3 * * *'],
      ['notifications.operationalAlertDelivery', 'notifications.deliverOperationalAlerts', '*/5 * * * *'],
      ['uploads.pendingScanSweep', 'uploads.rescanPending', '*/10 * * * *'],
    ]);
  });

  it('refuses a job declared by two modules', () => {
    const module = { jobs: [registerJob(verifyChainJob, VerifyChainHandler)], schedules: [] };
    expect(() => combineModuleJobs([module, module])).toThrow(InvalidJobRegistryError);
  });

  it('refuses a schedule whose job no module registers', () => {
    const unregistered = defineJob({ name: 'fixtures.unregistered', description: 'A synthetic job.', payload: {} });
    expect(() =>
      combineModuleJobs([
        {
          jobs: [],
          schedules: [defineSchedule({ name: 'fixtures.nightly', job: unregistered, cron: '0 3 * * *', payload: {} })],
        },
      ]),
    ).toThrow(/not registered/);
  });
});

describe('the job queue schema', () => {
  it('is installed by the migrations exactly as the pg-boss version in use builds it', () => {
    const migration = readFileSync(join(migrationsFolder, '0011_job_queue.sql'), 'utf8');
    const body = migration
      .split('\n')
      .filter((line) => !line.startsWith('-- '))
      .join('\n')
      .trim();
    expect(body).toBe(jobQueueConstructionSql());
  });
});
