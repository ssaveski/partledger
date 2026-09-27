import { rfqStatusSchema, type RfqListRow } from '@partledger/contracts';
import { z } from 'zod';

import { matchesText } from '../../shell/text-filter';

/** `?q=` searches references and titles; `?status=` narrows to one status. Bad values are dropped. */
export const rfqListSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: rfqStatusSchema.optional().catch(undefined),
});

export type RfqListSearch = z.infer<typeof rfqListSearchSchema>;

export function filterRfqs(rfqs: readonly RfqListRow[], search: RfqListSearch): RfqListRow[] {
  return rfqs.filter(
    (rfq) =>
      (search.status === undefined || rfq.status === search.status) &&
      matchesText(search.q, [rfq.reference, rfq.title]),
  );
}

export function hasRfqFilters(search: RfqListSearch): boolean {
  return search.status !== undefined || (search.q ?? '').trim() !== '';
}
