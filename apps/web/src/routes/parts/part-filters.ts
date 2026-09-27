import { partCategorySchema, type PartSummary } from '@partledger/contracts';
import { z } from 'zod';

import { matchesText } from '../../shell/text-filter';

/** `?q=` searches part numbers and descriptions; `?category=` narrows to one category. Bad values are dropped. */
export const partListSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  category: partCategorySchema.optional().catch(undefined),
});

export type PartListSearch = z.infer<typeof partListSearchSchema>;

export function filterParts(parts: readonly PartSummary[], search: PartListSearch): PartSummary[] {
  return parts.filter(
    (part) =>
      (search.category === undefined || part.category === search.category) &&
      matchesText(search.q, [part.partNumber, part.description]),
  );
}

export function hasFilters(search: PartListSearch): boolean {
  return search.category !== undefined || (search.q ?? '').trim() !== '';
}
