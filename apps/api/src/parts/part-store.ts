import { partCategories, type PartCategory } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDatabase } from '../db/tenant-transaction';
import { isUniqueViolation, type VersionedChange } from '../db/unique-violation';
import { approvalCovers } from '../suppliers/approval-standing';
import { supplierStore } from '../suppliers/supplier-store';

const { parts } = schema;

export type StoredPart = typeof parts.$inferSelect;

export type PartFields = Pick<StoredPart, 'partNumber' | 'revision' | 'description' | 'category' | 'unit'>;

const categorySchema = z.enum(partCategories);

/**
 * The tenant's part rows (U10). Every call runs inside the caller's tenant transaction, so
 * row-level security confines it to that tenant.
 */
export const partStore = {
  async find(database: AppDatabase, tenantId: string, partId: string): Promise<StoredPart | undefined> {
    const [row] = await database
      .select()
      .from(parts)
      .where(and(eq(parts.tenantId, tenantId), eq(parts.id, partId)));
    return row;
  },

  async numberInUse(database: AppDatabase, tenantId: string, partNumber: string): Promise<boolean> {
    const rows = await database
      .select({ id: parts.id })
      .from(parts)
      .where(and(eq(parts.tenantId, tenantId), eq(parts.partNumber, partNumber)));
    return rows.length > 0;
  },

  /** Inserts a platform part; `undefined` when its number is taken. */
  async insert(
    database: AppDatabase,
    part: PartFields & { readonly tenantId: string; readonly now: Date },
  ): Promise<{ readonly id: string; readonly version: number } | undefined> {
    const [row] = await database
      .insert(parts)
      .values({
        tenantId: part.tenantId,
        partNumber: part.partNumber,
        revision: part.revision,
        description: part.description,
        category: part.category,
        unit: part.unit,
        source: 'platform',
        createdAt: part.now,
        updatedAt: part.now,
      })
      .onConflictDoNothing()
      .returning({ id: parts.id, version: parts.version });
    return row;
  },

  /**
   * Applies a change to the version the caller read. A number another part took meanwhile is a
   * duplicate; the failed statement has aborted the transaction, which the caller rolls back.
   */
  async update(
    database: AppDatabase,
    change: {
      readonly tenantId: string;
      readonly partId: string;
      readonly expectedVersion: number;
      readonly now: Date;
      readonly set: Partial<PartFields & { readonly active: boolean }>;
    },
  ): Promise<VersionedChange> {
    try {
      const [row] = await database
        .update(parts)
        .set({ ...change.set, version: change.expectedVersion + 1, updatedAt: change.now })
        .where(
          and(
            eq(parts.tenantId, change.tenantId),
            eq(parts.id, change.partId),
            eq(parts.version, change.expectedVersion),
          ),
        )
        .returning({ version: parts.version });
      return row === undefined ? { kind: 'stale' } : { kind: 'updated', version: row.version };
    } catch (error) {
      if (isUniqueViolation(error, 'parts_tenant_id_part_number_key')) {
        return { kind: 'duplicate' };
      }
      throw error;
    }
  },

  /** Every part in part-number order, with how many suppliers' active approvals cover its category on `asOf`. */
  async list(database: AppDatabase, tenantId: string, asOf: string) {
    const rows = await database.select().from(parts).where(eq(parts.tenantId, tenantId)).orderBy(asc(parts.partNumber));
    const approvals = await supplierStore.activeSupplierApprovals(database, tenantId);
    const coverage = new Map<PartCategory, number>(
      categorySchema.options.map((category) => [
        category,
        approvals.filter((approval) => approvalCovers(approval, category, asOf)).length,
      ]),
    );
    return rows.map((row) => ({ ...row, approvedSupplierCount: coverage.get(row.category) ?? 0 }));
  },
};
