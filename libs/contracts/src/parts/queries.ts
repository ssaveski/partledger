import { z } from 'zod';

import { defineQuery } from '../define';
import { listInputSchema, listReadErrors, staffListReaders } from '../reads';

/**
 * The parts list behind the parts screen and the RFQ builder (U27). U10 implements it on the
 * API; until then the fixture adapter serves synthetic parts in this shape.
 */

export const partCategories = ['castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics'] as const;

export const partCategorySchema = z
  .enum(partCategories)
  .describe('The part category, which approved-supplier scopes and evidence requirements refer to.');

export type PartCategory = z.infer<typeof partCategorySchema>;

export const partUnits = ['each', 'kilogram', 'metre'] as const;

export const partSources = ['erp', 'platform'] as const;

export const partSourceSchema = z
  .enum(partSources)
  .describe('erp: owned by the ERP export, so its source fields are read-only here; platform: maintained here (R6).');

export type PartSource = z.infer<typeof partSourceSchema>;

export const partSummarySchema = z
  .object({
    partId: z.uuid().describe('The part.'),
    partNumber: z.string().min(1).describe('The part number.'),
    revision: z.string().min(1).describe('The current revision.'),
    description: z.string().describe('The part description.'),
    category: partCategorySchema,
    unit: z.enum(partUnits).describe('The unit quantities of this part are counted in.'),
    source: partSourceSchema,
    active: z
      .boolean()
      .describe('False when an import deactivated the part because its source no longer lists it (R6).'),
    approvedSupplierCount: z
      .number()
      .int()
      .nonnegative()
      .describe('How many suppliers hold an active approval whose scope covers the part category.'),
    updatedAt: z.iso.datetime().describe('When the part last changed.'),
  })
  .strict()
  .describe('One part of the tenant parts list.');

export type PartSummary = z.infer<typeof partSummarySchema>;

export const partListSchema = z
  .object({
    parts: z.array(partSummarySchema).describe('Every part, active or not, in part-number order.'),
  })
  .strict()
  .describe('The tenant parts list.');

export type PartList = z.infer<typeof partListSchema>;

export const partListQuery = defineQuery({
  name: 'parts.list',
  description: 'List the tenant parts with their category, source, status and approved-supplier count.',
  input: listInputSchema,
  output: partListSchema,
  errors: listReadErrors,
  access: staffListReaders,
});

export const partQueries = [partListQuery] as const;
