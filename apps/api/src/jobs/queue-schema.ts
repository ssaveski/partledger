import { getConstructionPlans } from 'pg-boss';

/** pg-boss's own schema (KTD16), created and owned by `pl_migrator` like every other schema. */
export const jobQueueSchema = 'pl_jobs';

/** The schema version the migrations install; pg-boss refuses to start against any other. */
export const jobQueueSchemaVersion = 42;

/**
 * pg-boss's construction SQL for `pl_jobs` without its own transaction wrapper, as the
 * migration `0011_job_queue.sql` holds it: the migrator runs every migration in one
 * transaction, so the plan's BEGIN and COMMIT must go, and its session settings and advisory
 * lock guard an install that the migrations never race.
 */
export function jobQueueConstructionSql(): string {
  const wrapper = [
    /^\s*BEGIN;$/,
    /^\s*SET LOCAL lock_timeout = \d+;$/,
    /^\s*SET LOCAL idle_in_transaction_session_timeout = \d+;$/,
    /^\s*SELECT pg_advisory_xact_lock\(.*\);$/,
    /^\s*COMMIT;$/,
  ];
  return getConstructionPlans(jobQueueSchema)
    .split('\n')
    .filter((line) => !wrapper.some((pattern) => pattern.test(line)))
    .join('\n')
    .trim();
}
