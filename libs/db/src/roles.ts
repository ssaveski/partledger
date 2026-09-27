import { z } from 'zod';

/** Owns every table, policy and trigger; used only to run migrations. */
export const migratorRole = 'pl_migrator';

/**
 * Owns `resolve_credential` and nothing else; it cannot log in. Its only privilege is
 * reading the credential table, so the definer function can do nothing more (KTD37).
 */
export const credentialResolverRole = 'pl_credential_resolver';

/** Reads every tenant row for the nightly dump (KTD32); its read-all policies are the allowed exception. */
export const backupRole = 'pl_backup';

/**
 * Runs pg-boss (KTD16): fetches, completes, retries and schedules jobs in the `pl_jobs`
 * schema. It holds no privilege on the application's tables; a job's work runs as `pl_app`
 * inside the job's tenant transaction.
 */
export const jobRunnerRole = 'pl_job_runner';

/** Roles the running services connect as. None of them owns anything or bypasses row-level security. */
export const runtimeRoles = ['pl_app', 'pl_portal', 'pl_ai_worker', 'pl_verifier', backupRole, jobRunnerRole] as const;

export const runtimeRoleSchema = z.enum(runtimeRoles);

export type RuntimeRole = z.infer<typeof runtimeRoleSchema>;

/** Roles that may hold privileges on tables, besides the owner. */
export const grantableRoles = [...runtimeRoles, credentialResolverRole] as const;

export type GrantableRole = (typeof grantableRoles)[number];
