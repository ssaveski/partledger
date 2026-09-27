import { partCategories, type ContactRole } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDatabase } from '../db/tenant-transaction';
import { isUniqueViolation, type VersionedChange } from '../db/unique-violation';
import type { IdentityCheckResult, IdentityRegister, StoredIdentityCheck } from '../identity-checks/identity-standing';
import type { StoredApproval } from './approval-standing';

const { approvedSupplierEntries, supplierContacts, supplierIdentityChecks, suppliers, tenants } = schema;

export type StoredSupplier = typeof suppliers.$inferSelect;

export type SupplierFields = Pick<StoredSupplier, 'code' | 'name' | 'country' | 'vatId' | 'lei'>;

export interface StoredApprovalEntry extends StoredApproval {
  readonly version: number;
}

const scopeSchema = z.array(z.enum(partCategories));

function approvalOf(row: typeof approvedSupplierEntries.$inferSelect): StoredApprovalEntry {
  return { status: row.status, scope: scopeSchema.parse(row.scope), expiresOn: row.expiresOn, version: row.version };
}

/**
 * The tenant's suppliers, contacts, identity checks and approved-supplier entries (U10). Every
 * call runs inside the caller's tenant transaction, so row-level security confines it to that
 * tenant.
 */
export const supplierStore = {
  /** Who owns the tenant's approved-supplier list (R9). */
  async approvedListSource(database: AppDatabase, tenantId: string): Promise<'erp' | 'platform'> {
    const [row] = await database
      .select({ source: tenants.supplierListSource })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (row === undefined) {
      throw new Error('The tenant of the transaction has no row');
    }
    return row.source;
  },

  async find(database: AppDatabase, tenantId: string, supplierId: string): Promise<StoredSupplier | undefined> {
    const [row] = await database
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, supplierId)));
    return row;
  },

  async codeInUse(database: AppDatabase, tenantId: string, code: string): Promise<boolean> {
    const rows = await database
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.code, code)));
    return rows.length > 0;
  },

  /** Inserts an active platform supplier; `undefined` when its code is taken. */
  async insert(
    database: AppDatabase,
    supplier: SupplierFields & { readonly tenantId: string; readonly now: Date },
  ): Promise<{ readonly id: string; readonly version: number } | undefined> {
    const [row] = await database
      .insert(suppliers)
      .values({
        tenantId: supplier.tenantId,
        code: supplier.code,
        name: supplier.name,
        country: supplier.country,
        vatId: supplier.vatId,
        lei: supplier.lei,
        status: 'active',
        source: 'platform',
        createdAt: supplier.now,
        updatedAt: supplier.now,
      })
      .onConflictDoNothing()
      .returning({ id: suppliers.id, version: suppliers.version });
    return row;
  },

  /**
   * Applies a change to the version the caller read. A code another supplier took meanwhile is
   * a duplicate; the failed statement has aborted the transaction, which the caller rolls back.
   */
  async update(
    database: AppDatabase,
    change: {
      readonly tenantId: string;
      readonly supplierId: string;
      readonly expectedVersion: number;
      readonly now: Date;
      readonly set: Partial<SupplierFields & Pick<StoredSupplier, 'status'>>;
    },
  ): Promise<VersionedChange> {
    try {
      const [row] = await database
        .update(suppliers)
        .set({ ...change.set, version: change.expectedVersion + 1, updatedAt: change.now })
        .where(
          and(
            eq(suppliers.tenantId, change.tenantId),
            eq(suppliers.id, change.supplierId),
            eq(suppliers.version, change.expectedVersion),
          ),
        )
        .returning({ version: suppliers.version });
      return row === undefined ? { kind: 'stale' } : { kind: 'updated', version: row.version };
    } catch (error) {
      if (isUniqueViolation(error, 'suppliers_tenant_id_code_key')) {
        return { kind: 'duplicate' };
      }
      throw error;
    }
  },

  /** Every supplier in name order. */
  async list(database: AppDatabase, tenantId: string): Promise<StoredSupplier[]> {
    return database
      .select()
      .from(suppliers)
      .where(eq(suppliers.tenantId, tenantId))
      .orderBy(asc(suppliers.name), asc(suppliers.code));
  },

  async approvals(database: AppDatabase, tenantId: string): Promise<Map<string, StoredApprovalEntry>> {
    const rows = await database
      .select()
      .from(approvedSupplierEntries)
      .where(eq(approvedSupplierEntries.tenantId, tenantId));
    return new Map(rows.map((row) => [row.supplierId, approvalOf(row)]));
  },

  async approval(
    database: AppDatabase,
    tenantId: string,
    supplierId: string,
  ): Promise<StoredApprovalEntry | undefined> {
    const [row] = await database
      .select()
      .from(approvedSupplierEntries)
      .where(and(eq(approvedSupplierEntries.tenantId, tenantId), eq(approvedSupplierEntries.supplierId, supplierId)));
    return row === undefined ? undefined : approvalOf(row);
  },

  /** The approvals of the tenant's active suppliers, which are the ones that can be invited. */
  async activeSupplierApprovals(database: AppDatabase, tenantId: string): Promise<StoredApprovalEntry[]> {
    const rows = await database
      .select({ entry: approvedSupplierEntries })
      .from(approvedSupplierEntries)
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.tenantId, approvedSupplierEntries.tenantId),
          eq(suppliers.id, approvedSupplierEntries.supplierId),
        ),
      )
      .where(and(eq(approvedSupplierEntries.tenantId, tenantId), eq(suppliers.status, 'active')));
    return rows.map((row) => approvalOf(row.entry));
  },

  /**
   * Records a supplier's entry at the version the caller read: 0 inserts the first entry, any
   * other moves it on by one. Returns the new version, or `undefined` when the entry moved on.
   */
  async setApproval(
    database: AppDatabase,
    entry: StoredApproval & {
      readonly tenantId: string;
      readonly supplierId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ): Promise<number | undefined> {
    const values = { status: entry.status, scope: [...entry.scope], expiresOn: entry.expiresOn, updatedAt: entry.now };
    if (entry.expectedVersion === 0) {
      const [inserted] = await database
        .insert(approvedSupplierEntries)
        .values({ tenantId: entry.tenantId, supplierId: entry.supplierId, ...values })
        .onConflictDoNothing()
        .returning({ version: approvedSupplierEntries.version });
      return inserted?.version;
    }
    const [updated] = await database
      .update(approvedSupplierEntries)
      .set({ ...values, version: entry.expectedVersion + 1 })
      .where(
        and(
          eq(approvedSupplierEntries.tenantId, entry.tenantId),
          eq(approvedSupplierEntries.supplierId, entry.supplierId),
          eq(approvedSupplierEntries.version, entry.expectedVersion),
        ),
      )
      .returning({ version: approvedSupplierEntries.version });
    return updated?.version;
  },

  /** Every check of the given suppliers; the reads keep the latest per register and identifier. */
  async identityChecks(
    database: AppDatabase,
    tenantId: string,
    supplierIds: readonly string[],
  ): Promise<Map<string, StoredIdentityCheck[]>> {
    const bySupplier = new Map<string, StoredIdentityCheck[]>();
    if (supplierIds.length === 0) {
      return bySupplier;
    }
    const rows = await database
      .selectDistinctOn(
        [supplierIdentityChecks.supplierId, supplierIdentityChecks.register, supplierIdentityChecks.identifier],
        {
          supplierId: supplierIdentityChecks.supplierId,
          register: supplierIdentityChecks.register,
          identifier: supplierIdentityChecks.identifier,
          result: supplierIdentityChecks.result,
          checkedAt: supplierIdentityChecks.checkedAt,
        },
      )
      .from(supplierIdentityChecks)
      .where(
        and(
          eq(supplierIdentityChecks.tenantId, tenantId),
          inArray(supplierIdentityChecks.supplierId, [...supplierIds]),
        ),
      )
      .orderBy(
        supplierIdentityChecks.supplierId,
        supplierIdentityChecks.register,
        supplierIdentityChecks.identifier,
        sql`${supplierIdentityChecks.checkedAt} desc`,
      );
    for (const row of rows) {
      bySupplier.set(row.supplierId, [...(bySupplier.get(row.supplierId) ?? []), row]);
    }
    return bySupplier;
  },

  async recordIdentityCheck(
    database: AppDatabase,
    check: {
      readonly tenantId: string;
      readonly supplierId: string;
      readonly register: IdentityRegister;
      readonly identifier: string;
      readonly result: IdentityCheckResult;
      readonly checkedAt: Date;
    },
  ): Promise<void> {
    await database.insert(supplierIdentityChecks).values(check);
  },

  /** Whether the register was ever asked about this identifier of the supplier. */
  async hasIdentityCheck(
    database: AppDatabase,
    check: {
      readonly tenantId: string;
      readonly supplierId: string;
      readonly register: IdentityRegister;
      readonly identifier: string;
    },
  ): Promise<boolean> {
    const rows = await database
      .select({ id: supplierIdentityChecks.id })
      .from(supplierIdentityChecks)
      .where(
        and(
          eq(supplierIdentityChecks.tenantId, check.tenantId),
          eq(supplierIdentityChecks.supplierId, check.supplierId),
          eq(supplierIdentityChecks.register, check.register),
          eq(supplierIdentityChecks.identifier, check.identifier),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async currentContacts(database: AppDatabase, tenantId: string, supplierId: string) {
    return database
      .select()
      .from(supplierContacts)
      .where(
        and(
          eq(supplierContacts.tenantId, tenantId),
          eq(supplierContacts.supplierId, supplierId),
          isNull(supplierContacts.removedAt),
        ),
      )
      .orderBy(asc(supplierContacts.addedAt), asc(supplierContacts.id));
  },

  async findCurrentContact(database: AppDatabase, tenantId: string, contactId: string) {
    const [row] = await database
      .select()
      .from(supplierContacts)
      .where(
        and(
          eq(supplierContacts.tenantId, tenantId),
          eq(supplierContacts.id, contactId),
          isNull(supplierContacts.removedAt),
        ),
      );
    return row;
  },

  /** Adds a current contact; `undefined` when the supplier already has one at that address. */
  async insertContact(
    database: AppDatabase,
    contact: {
      readonly tenantId: string;
      readonly supplierId: string;
      readonly name: string;
      readonly email: string;
      readonly role: ContactRole;
      readonly addedAt: Date;
    },
  ): Promise<string | undefined> {
    const [row] = await database
      .insert(supplierContacts)
      .values(contact)
      .onConflictDoNothing()
      .returning({ id: supplierContacts.id });
    return row?.id;
  },

  /**
   * Removes a current contact; `false` when it was not current, such as when a concurrent
   * removal committed first (the update waits for it, then finds the contact removed).
   */
  async removeContact(database: AppDatabase, tenantId: string, contactId: string, removedAt: Date): Promise<boolean> {
    const removed = await database
      .update(supplierContacts)
      .set({ removedAt })
      .where(
        and(
          eq(supplierContacts.tenantId, tenantId),
          eq(supplierContacts.id, contactId),
          isNull(supplierContacts.removedAt),
        ),
      )
      .returning({ id: supplierContacts.id });
    return removed.length === 1;
  },
};
