import { jobRunnerRole } from './roles.ts';
import type { TablePrivilege } from './table-access.ts';

/**
 * The expected access to pg-boss's schema (KTD16), which the catalog check compares exactly.
 * pg-boss owns its table layout, so the check does not list its tables: every table in the
 * schema grants the runner DML, and `pl_app` holds only what enqueuing inside a command's
 * transaction needs, on the job table under a tenant policy.
 */
export interface JobQueueAccess {
  readonly schema: string;
  readonly runnerRole: string;
  readonly runnerTablePrivileges: readonly TablePrivilege[];
  /** Table privileges `pl_app` holds, by table; every other table grants it nothing. */
  readonly appGrants: Readonly<Record<string, readonly TablePrivilege[]>>;
  /** Functions `pl_app` may execute, by signature; the runner may execute every function. */
  readonly appFunctions: readonly string[];
  /** Tables whose rows carry a tenant in `data.tenantId`; `pl_app` reaches them only under that tenant's policy. */
  readonly tenantTables: readonly string[];
}

export const jobQueueAccess: JobQueueAccess = {
  schema: 'pl_jobs',
  runnerRole: jobRunnerRole,
  runnerTablePrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  appGrants: { queue: ['SELECT'], job_common: ['SELECT', 'INSERT'] },
  appFunctions: ['pl_jobs.job_now()'],
  tenantTables: ['job_common'],
};
