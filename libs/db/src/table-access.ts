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
  /** `tenant_id` for tenant-owned tables; `id` for the tenants table itself. */
  readonly tenantKey: 'tenant_id' | 'id';
  readonly grants: Readonly<Partial<Record<GrantableRole, readonly TablePrivilege[]>>>;
  readonly columnGrants?: Readonly<
    Partial<Record<GrantableRole, Readonly<Record<string, readonly ColumnPrivilege[]>>>>
  >;
  /** Audit tables: no UPDATE or DELETE grants, guard triggers, nothing cascades into them. */
  readonly insertOnly?: boolean;
}

export function defineTableAccess(access: TableAccess): TableAccess {
  return access;
}
