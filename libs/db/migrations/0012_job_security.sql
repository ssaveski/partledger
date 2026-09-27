-- Background jobs (KTD16). pg-boss runs as its own role, pl_job_runner, which holds DML on
-- the pl_jobs schema and nothing on the application's tables. A job's work runs as pl_app in
-- the job's tenant transaction. pl_app may only enqueue: insert a job for the tenant of its
-- current transaction and read that tenant's jobs back (INSERT ... RETURNING id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pl_job_runner') THEN
    CREATE ROLE pl_job_runner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pl_job_runner', current_database());
END
$$;

-- Per-item outcomes and operational alerts are tenant-owned.
CALL pl_migration.enable_tenant_row_security('public.job_item_outcomes');
CALL pl_migration.enable_tenant_row_security('public.operational_alerts');
GRANT SELECT, INSERT, UPDATE ON public.job_item_outcomes TO pl_app;
GRANT SELECT, INSERT ON public.operational_alerts TO pl_app;
GRANT SELECT ON public.job_item_outcomes, public.operational_alerts TO pl_backup;

REVOKE ALL ON SCHEMA pl_jobs FROM PUBLIC;
GRANT USAGE ON SCHEMA pl_jobs TO pl_job_runner, pl_app;

-- No TRUNCATE and no CREATE: the runner cannot build partitioned queues or reindex; those
-- arrive as migrations run by the owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pl_jobs TO pl_job_runner;
ALTER DEFAULT PRIVILEGES FOR ROLE pl_migrator IN SCHEMA pl_jobs
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pl_job_runner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pl_jobs TO pl_job_runner;
ALTER DEFAULT PRIVILEGES FOR ROLE pl_migrator IN SCHEMA pl_jobs GRANT EXECUTE ON FUNCTIONS TO pl_job_runner;

-- pg-boss inserts a job into its queue's table, job_common for every unpartitioned queue, joined
-- with the queue's defaults.
GRANT SELECT ON pl_jobs.queue TO pl_app;
GRANT SELECT, INSERT ON pl_jobs.job_common TO pl_app;
GRANT EXECUTE ON FUNCTION pl_jobs.job_now() TO pl_app;

-- Row-level security is enabled but not forced: pg-boss's own migrations run as the owner and
-- must reach every job. Nothing cascades into the job tables.
ALTER TABLE pl_jobs.job_common ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_common_tenant_enqueue ON pl_jobs.job_common FOR INSERT TO pl_app
  WITH CHECK ((data ->> 'tenantId')::uuid = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY job_common_tenant_read ON pl_jobs.job_common FOR SELECT TO pl_app
  USING ((data ->> 'tenantId')::uuid = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY job_common_runner ON pl_jobs.job_common TO pl_job_runner USING (true) WITH CHECK (true);
