# Background jobs

Background work runs on pg-boss in the `pl_jobs` schema of each region's database (plan KTD16). The code lives in `apps/api/src/jobs/`.

## Processes and roles

- Every API process can enqueue. A process runs job handlers and fires schedules only with `JOBS_WORKERS=on`. At least one process per region must run with it on, or no job ever runs.
- pg-boss connects as `pl_job_runner` (`JOBS_DATABASE_URL`). This role has DML on `pl_jobs` and nothing on the application's tables. A job's work runs as `pl_app` in the job's tenant transaction.
- The migrations install pg-boss's schema. pg-boss never migrates at runtime, and it refuses to start if the schema version differs from its own. Upgrading pg-boss past schema version 42 needs a migration built from `getMigrationPlans()`.

## Tenant enrolment: the hand-off to tenant provisioning

The runner cannot list tenants, because their table is under row-level security. So a tenant is only scheduled once it has been enrolled:

1. The command that provisions a tenant calls `enqueueTenantEnrolment(context, tenantId)` from `apps/api/src/jobs/tenant-enrollment.job.ts`. It must call it inside a transaction whose `app.tenant_id` is the new tenant. The enrolment job then commits, or rolls back, with the tenant.
2. A worker runs `jobs.enrollTenant`. This records the tenant in `pl_jobs.tenant_enrolment` and writes every declared schedule for it, such as `audit.nightlyChainVerification` at 03:17 UTC.
3. At boot, every worker re-applies the declared schedules to every tenant in `pl_jobs.tenant_enrolment`. Only after that does it remove schedules that are no longer declared. A build that declares no schedules removes nothing.

## Spotting a tenant that is not enrolled

Run these as a database administrator. It needs a role that can read both `public.tenants` and `pl_jobs`.

```sql
-- Tenants that were never enrolled: no nightly chain verification runs for them.
select t.id, t.slug
  from public.tenants t
  left join pl_jobs.tenant_enrolment e on e.tenant_id = t.id
 where e.tenant_id is null;

-- Enrolled tenants whose nightly verification schedule is missing.
select e.tenant_id
  from pl_jobs.tenant_enrolment e
 where not exists (
   select 1 from pl_jobs.schedule s
    where s.name = 'audit.verifyChain' and s.key = 'audit.nightlyChainVerification/' || e.tenant_id
 );
```

To repair either case, insert the tenant id into `pl_jobs.tenant_enrolment` if it is not there, then restart one worker. The worker's boot-time synchronisation writes the missing schedules.

## Failures

- A failed item is recorded in `job_item_outcomes` as `failed`, with a code such as `Unavailable.dependencyUnavailable` or `unexpected`. pg-boss retries the job with backoff, and a retry resumes at the failed item.
- pg-boss stores only a code-bearing error with the job. The underlying error is logged by `JobRunner` without its values, with the job id as its correlation id. To find the cause, search the logs for `correlation <job id>`.
- A chain that fails its nightly verification raises a `chainVerificationFailed` row in `operational_alerts`. The row names the first failing sequence number.

## Notifications and operational alerts

- Commands record notifications in the `notifications` outbox inside their own transaction, and enqueue one `notifications.send` job per email. A command that rolls back leaves neither.
- `notifications.send` resolves the recipient's address when it runs; the outbox, job payloads, audit entries and logs hold only the recipient's kind and id. A failed send is retried by pg-boss. After 4 attempts the notification is marked `failed` with a code, and a `notificationDeliveryFailed` operational alert is raised. A failed email about such an alert raises nothing more.
- `notifications.deliverOperationalAlerts` runs every five minutes for every enrolled tenant. It sets each new alert's `notified_at`, which never changes afterwards, and records one email per alert recipient. So each alert reaches each recipient once.
- A tenant admin configures alert recipients with `notifications.addAlertRecipient` and `notifications.removeAlertRecipient`. While a tenant has none, its alerts go to the platform operator's `OPERATIONAL_ALERT_FALLBACK_EMAIL`, which production requires. Without that setting (development only), the alerts stay undelivered, the staff shell still lists them, and each run logs `Tenant <id> has operational alerts to deliver, no alert recipients and no operator fallback`.
- An alert whose kind or params this build cannot read is still marked delivered and sent in general words ("an alert needs your attention"), with the audit outcome `unreadable`, so it never holds back the alerts after it.
- Locally, `EMAIL_ADAPTER=local` writes each email to `EMAIL_LOCAL_INBOX_DIRECTORY` as `<notification id>.json` and sends nothing. Production refuses `local` and refuses to start without an adapter named.

```sql
-- Operational alerts not yet handed to anyone, oldest first.
select tenant_id, kind, key, raised_at from operational_alerts where notified_at is null order by raised_at;

-- Emails that failed for good.
select tenant_id, id, template, attempts, failure, failed_at from notifications where status = 'failed';
```
