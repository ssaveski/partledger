import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/** Tenant-scoped roles (R3), additive; the same list as the contracts' `tenantRoles`. */
export const memberRoles = ['tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'] as const;

/**
 * A person's membership of a tenant (R3, KTD20). The user id is the identity provider's
 * subject, so a signed-in session maps to its row. A membership is never deleted while an
 * audit entry names its user; removing a member records the time instead, and a removed
 * membership never changes again (guard triggers). Email and display name are the tenant's
 * record of the person; audit entries carry them only as commitments.
 */
export const memberships = pgTable(
  'memberships',
  {
    tenantId: tenantIdentifier(),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    invitedAt: timestamptz('invited_at').notNull(),
    removedAt: timestamptz('removed_at'),
  },
  (table) => [
    primaryKey({ name: 'memberships_pkey', columns: [table.tenantId, table.userId] }),
    foreignKey({ name: 'memberships_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    uniqueIndex('memberships_tenant_id_email_key')
      .on(table.tenantId, table.email)
      .where(sql`${table.removedAt} is null`),
    check(
      'memberships_email_check',
      sql`${table.email} ~ '^[^@\\s]{1,64}@[^@\\s]{1,255}$' and ${table.email} = lower(${table.email})`,
    ),
    check('memberships_display_name_check', sql`length(${table.displayName}) between 1 and 200`),
    check('memberships_removed_check', sql`${table.removedAt} is null or ${table.removedAt} >= ${table.invitedAt}`),
  ],
);

export const membershipsAccess = defineTableAccess({
  table: 'memberships',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: { pl_app: { removed_at: ['UPDATE'] } },
});

/**
 * The roles a member holds now (R3). Granting inserts a row and revoking deletes it; the
 * history is the audit chain, where each change names the admin who made it. Roles are read
 * from here on every request (KTD20), so a revocation applies to the member's next request.
 */
export const roleAssignments = pgTable(
  'role_assignments',
  {
    tenantId: tenantIdentifier(),
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: memberRoles }).notNull(),
    grantedAt: timestamptz('granted_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'role_assignments_pkey', columns: [table.tenantId, table.userId, table.role] }),
    foreignKey({ name: 'role_assignments_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'role_assignments_membership_fkey',
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check(
      'role_assignments_role_check',
      sql`${table.role} in ('tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor')`,
    ),
  ],
);

export const roleAssignmentsAccess = defineTableAccess({
  table: 'role_assignments',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT', 'DELETE'] },
});
