-- The tenants enrolled in the scheduled jobs (KTD16, KTD38). The job runner cannot list tenants,
-- whose table is under row-level security, so enrolment is recorded here, apart from the
-- schedules themselves: a change to the declared schedules, or a crash while they are
-- rewritten, can never lose a tenant. It holds tenant ids and nothing else; pl_app has no access.
CREATE TABLE pl_jobs.tenant_enrolment (
  tenant_id uuid PRIMARY KEY,
  enrolled_at timestamp with time zone NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON pl_jobs.tenant_enrolment TO pl_job_runner;
