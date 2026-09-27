import { z } from 'zod';

import { defineQuery } from '../define';
import { lifecycleRead } from '../lifecycle';
import { partCategorySchema } from '../parts/queries';
import { supplierApprovalSchema } from '../suppliers/queries';
import {
  partSchema,
  quantityBreaksSchema,
  readErrors,
  referenceSchema,
  rfqInputSchema,
  rfqStatusSchema,
  staffReaders,
  supplierEvidenceStatusSchema,
  titleSchema,
} from './queries';

/**
 * Supplier assignment (U27, R15): each line with every supplier that could be invited to it,
 * whether it is invited, and whether the supplier's approved scope covers the line. U16
 * implements it on the API with the tenant's warn-or-block setting.
 */

export const assignmentCandidateSchema = z
  .object({
    supplierId: z.uuid().describe('The supplier.'),
    name: z.string().min(1).describe('The supplier organisation name.'),
    assigned: z.boolean().describe('Whether the supplier is invited to quote this line.'),
    inScope: z
      .boolean()
      .describe("Whether the supplier's active approval covers the line's part category; the server decides."),
    approval: supplierApprovalSchema,
    evidence: supplierEvidenceStatusSchema
      .nullable()
      .describe('The supplier’s evidence status, or null until the evidence vault has assessed the supplier.'),
  })
  .strict()
  .describe('A supplier that could be invited to one line.');

export type AssignmentCandidate = z.infer<typeof assignmentCandidateSchema>;

export const assignmentLineSchema = z
  .object({
    lineId: z.uuid().describe('The RFQ line.'),
    ...partSchema,
    quantityBreaks: quantityBreaksSchema,
    requiredBy: z.iso.date().describe('The date the parts are needed by.'),
    category: partCategorySchema,
    candidates: z.array(assignmentCandidateSchema).describe('Every supplier that could be invited, by name.'),
  })
  .strict()
  .describe('One line with the suppliers that could quote it.');

export type AssignmentLine = z.infer<typeof assignmentLineSchema>;

export const assignmentTransitions = ['assign', 'publish'] as const;

export const rfqAssignmentSchema = lifecycleRead(
  z
    .object({
      rfqId: z.uuid().describe('The RFQ.'),
      reference: referenceSchema,
      title: titleSchema,
      status: rfqStatusSchema,
      version: z.number().int().positive().describe('The RFQ version.'),
      deadline: z.iso.datetime().describe('The response deadline in UTC.'),
      outOfScopePolicy: z
        .enum(['warn', 'block'])
        .describe('The tenant setting: warn about, or block, inviting a supplier outside its approved scope.'),
      lines: z.array(assignmentLineSchema).describe('The lines, in line-number order.'),
    })
    .strict(),
  assignmentTransitions,
).describe('Who is invited to each line of an RFQ, and who could be.');

export type RfqAssignment = z.infer<typeof rfqAssignmentSchema>;

export const rfqAssignmentQuery = defineQuery({
  name: 'rfqs.assignment',
  description:
    'Read the suppliers invited to each line of an RFQ, with every other supplier that could be and whether its approved scope covers the line.',
  input: rfqInputSchema,
  output: rfqAssignmentSchema,
  errors: readErrors,
  access: staffReaders,
});
