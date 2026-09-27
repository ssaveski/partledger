import { approvalStatusSchema, type SupplierSummary } from '@partledger/contracts';
import { z } from 'zod';

import { matchesText } from '../../shell/text-filter';

/** `?q=` searches names and codes; `?approval=` narrows to one approval status. Bad values are dropped. */
export const supplierListSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  approval: approvalStatusSchema.optional().catch(undefined),
});

export type SupplierListSearch = z.infer<typeof supplierListSearchSchema>;

export function filterSuppliers(suppliers: readonly SupplierSummary[], search: SupplierListSearch): SupplierSummary[] {
  return suppliers.filter(
    (supplier) =>
      (search.approval === undefined || supplier.approval.status === search.approval) &&
      matchesText(search.q, [supplier.name, supplier.code]),
  );
}

export function hasSupplierFilters(search: SupplierListSearch): boolean {
  return search.approval !== undefined || (search.q ?? '').trim() !== '';
}
