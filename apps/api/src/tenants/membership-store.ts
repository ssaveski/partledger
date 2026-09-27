import { tenantRoles, type TenantRole } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDatabase } from '../db/tenant-transaction';

const { memberships, roleAssignments, staffSessions, tenants } = schema;

export interface StoredMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly invitedAt: Date;
  readonly roles: readonly TenantRole[];
}

const roleSchema = z.enum(tenantRoles);

function inRoleOrder(roles: readonly string[]): TenantRole[] {
  const held = new Set(roles.map((role) => roleSchema.parse(role)));
  return tenantRoles.filter((role) => held.has(role));
}

function lockKey(tenantId: string) {
  return sql`pg_catalog.hashtextextended(${`partledger/members:${tenantId}`}, 0)`;
}

const current = (tenantId: string, userId: string) =>
  and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), isNull(memberships.removedAt));

/**
 * The tenant's membership rows (R3, KTD20). Every call runs inside the caller's tenant
 * transaction, so row-level security confines it to that tenant. Roles belong to a person's
 * current membership; a removed membership keeps none.
 */
export const membershipStore = {
  /**
   * Serialises membership and role changes within one tenant, so two administrators can never
   * each remove the other and leave the tenant with none.
   */
  async lockTenantMembers(database: AppDatabase, tenantId: string): Promise<void> {
    await database.execute(sql`select pg_catalog.pg_advisory_xact_lock(${lockKey(tenantId)})`);
  },

  /**
   * Waits for a membership change in flight, so a sign-in never reads a membership that a
   * concurrent removal is ending and then starts a session the removal cannot see.
   */
  async waitForMemberChanges(database: AppDatabase, tenantId: string): Promise<void> {
    await database.execute(sql`select pg_catalog.pg_advisory_xact_lock_shared(${lockKey(tenantId)})`);
  },

  async activeRoles(database: AppDatabase, tenantId: string, userId: string): Promise<TenantRole[]> {
    const rows = await database
      .select({ role: roleAssignments.role })
      .from(roleAssignments)
      .innerJoin(
        memberships,
        and(eq(memberships.tenantId, roleAssignments.tenantId), eq(memberships.id, roleAssignments.membershipId)),
      )
      .where(current(tenantId, userId));
    return inRoleOrder(rows.map((row) => row.role));
  },

  async findActive(database: AppDatabase, tenantId: string, userId: string): Promise<StoredMember | undefined> {
    const [row] = await database
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        email: memberships.email,
        displayName: memberships.displayName,
        invitedAt: memberships.invitedAt,
      })
      .from(memberships)
      .where(current(tenantId, userId));
    if (row === undefined) {
      return undefined;
    }
    return { ...row, roles: await membershipStore.activeRoles(database, tenantId, userId) };
  },

  async emailInUse(database: AppDatabase, tenantId: string, email: string): Promise<boolean> {
    const rows = await database
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.email, email), isNull(memberships.removedAt)));
    return rows.length > 0;
  },

  async listActive(database: AppDatabase, tenantId: string): Promise<StoredMember[]> {
    const rows = await database
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        email: memberships.email,
        displayName: memberships.displayName,
        invitedAt: memberships.invitedAt,
        roles: sql<unknown>`coalesce(array_agg(${roleAssignments.role}) filter (where ${roleAssignments.role} is not null), '{}')`,
      })
      .from(memberships)
      .leftJoin(
        roleAssignments,
        and(eq(roleAssignments.tenantId, memberships.tenantId), eq(roleAssignments.membershipId, memberships.id)),
      )
      .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.removedAt)))
      .groupBy(memberships.tenantId, memberships.id)
      .orderBy(asc(memberships.invitedAt), asc(memberships.userId));
    return rows.map((row) => ({ ...row, roles: inRoleOrder(z.array(z.string()).parse(row.roles)) }));
  },

  async countActiveAdmins(database: AppDatabase, tenantId: string): Promise<number> {
    const rows = await database
      .select({ membershipId: roleAssignments.membershipId })
      .from(roleAssignments)
      .innerJoin(
        memberships,
        and(eq(memberships.tenantId, roleAssignments.tenantId), eq(memberships.id, roleAssignments.membershipId)),
      )
      .where(
        and(
          eq(roleAssignments.tenantId, tenantId),
          eq(roleAssignments.role, 'tenant_admin'),
          isNull(memberships.removedAt),
        ),
      );
    return rows.length;
  },

  /** Records a new current membership; returns its id. */
  async insertMember(
    database: AppDatabase,
    member: { tenantId: string; userId: string; email: string; displayName: string; invitedAt: Date },
  ): Promise<string> {
    const [row] = await database.insert(memberships).values(member).returning({ id: memberships.id });
    if (row === undefined) {
      throw new Error('The membership was not inserted');
    }
    return row.id;
  },

  /** `false` when the membership already held the role. */
  async grantRole(
    database: AppDatabase,
    grant: { tenantId: string; membershipId: string; role: TenantRole; grantedAt: Date },
  ): Promise<boolean> {
    const inserted = await database
      .insert(roleAssignments)
      .values(grant)
      .onConflictDoNothing()
      .returning({ role: roleAssignments.role });
    return inserted.length === 1;
  },

  /** `false` when the membership did not hold the role. */
  async revokeRole(database: AppDatabase, tenantId: string, membershipId: string, role: TenantRole): Promise<boolean> {
    const deleted = await database
      .delete(roleAssignments)
      .where(
        and(
          eq(roleAssignments.tenantId, tenantId),
          eq(roleAssignments.membershipId, membershipId),
          eq(roleAssignments.role, role),
        ),
      )
      .returning({ role: roleAssignments.role });
    return deleted.length === 1;
  },

  /** Revokes every role, records the removal and ends the member's sessions; returns the sessions ended. */
  async removeMember(database: AppDatabase, member: StoredMember & { tenantId: string }, now: Date): Promise<number> {
    await database
      .delete(roleAssignments)
      .where(and(eq(roleAssignments.tenantId, member.tenantId), eq(roleAssignments.membershipId, member.membershipId)));
    await database
      .update(memberships)
      .set({ removedAt: now })
      .where(and(eq(memberships.tenantId, member.tenantId), eq(memberships.id, member.membershipId)));
    const ended = await database
      .update(staffSessions)
      .set({ endedAt: now, endReason: 'membership_removed' })
      .where(
        and(
          eq(staffSessions.tenantId, member.tenantId),
          eq(staffSessions.subjectId, member.userId),
          isNull(staffSessions.endedAt),
        ),
      )
      .returning({ credentialId: staffSessions.credentialId });
    return ended.length;
  },

  async tenantOf(database: AppDatabase, tenantId: string) {
    const [row] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
    return row;
  },
};
