import type { GrantableRole } from './roles.ts';

/** Table privileges a role may hold. TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are owner-only (KTD11). */
export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export type ColumnPrivilege = 'SELECT' | 'INSERT' | 'UPDATE';

/**
 * The expected access to one table, checked exactly by the catalog check. `pl_backup`'s
 * SELECT and read-all policy are implied for every table and are not listed here.
 */
export interface TableAccess {
  readonly table: string;
  /**
   * `tenant_id` for tenant-owned tables; `id` for the tenants table itself; `none` for a global
   * table that holds no tenant's data (the directory), whose policies are listed in `policies`.
   */
  readonly tenantKey: 'tenant_id' | 'id' | 'none';
  /** A global table's policies besides `pl_backup`'s read-all, compared exactly. */
  readonly policies?: readonly GlobalPolicy[];
  readonly grants: Readonly<Partial<Record<GrantableRole, readonly TablePrivilege[]>>>;
  readonly columnGrants?: Readonly<
    Partial<Record<GrantableRole, Readonly<Record<string, readonly ColumnPrivilege[]>>>>
  >;
  /** Audit tables: no UPDATE or DELETE grants, guard triggers, nothing cascades into them. */
  readonly insertOnly?: boolean;
  /**
   * Like `insertOnly`, except that column-level UPDATE grants are allowed: the guard trigger
   * lets through only an erasure (the commitment store, R39). No table-level UPDATE or DELETE.
   */
  readonly eraseOnly?: boolean;
}

/** A policy on a global table as `pg_policy` deparses it; the command is `r`, `a`, `w`, `d` or `*`. */
export interface GlobalPolicy {
  readonly name: string;
  readonly command: 'r' | 'a' | 'w' | 'd' | '*';
  readonly role: GrantableRole;
  readonly using: string | null;
  readonly check: string | null;
}

export function defineTableAccess(access: TableAccess): TableAccess {
  return access;
}
