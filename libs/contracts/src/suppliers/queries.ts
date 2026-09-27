import { z } from 'zod';

import { defineQuery } from '../define';
import { partCategorySchema } from '../parts/queries';
import { asOfSchema, expiryStatusSchema, listInputSchema, listReadErrors, staffListReaders } from '../reads';
import { supplierEvidenceStatusSchema } from '../rfqs/queries';

/**
 * The supplier list behind the supplier screen and supplier assignment (U27), served by the API
 * with the identity checks of R10 (U10) and, in the preview, by the fixture adapter with
 * synthetic suppliers in the same shape.
 */

export const approvalStatuses = ['approved', 'conditional', 'suspended', 'notApproved'] as const;

export const approvalStatusSchema = z
  .enum(approvalStatuses)
  .describe(
    'approved: on the approved-supplier list; conditional: approved with conditions; suspended: approval paused; notApproved: not on the list.',
  );

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const supplierApprovalSchema = z
  .object({
    status: approvalStatusSchema,
    scope: z.array(partCategorySchema).describe('The part categories the approval covers.'),
    expiresOn: z.iso.date().nullable().describe('The last day the approval is valid, or null.'),
    expiry: expiryStatusSchema,
  })
  .strict()
  .describe('The supplier entry on the approved-supplier list (R9).');

export type SupplierApproval = z.infer<typeof supplierApprovalSchema>;

export const identityCheckStatuses = ['verified', 'mismatch', 'notFound', 'notChecked', 'notApplicable'] as const;

export const identityCheckSchema = z
  .object({
    status: z
      .enum(identityCheckStatuses)
      .describe(
        'verified: the register confirms the supplier; mismatch: the register names someone else; notFound: the register has no entry; notChecked: the register could not be reached; notApplicable: no register applies.',
      ),
    register: z.enum(['vies', 'lei']).nullable().describe('The EU VAT register or the LEI register, or null.'),
    checkedAt: z.iso.datetime().nullable().describe('When the register was last asked, or null.'),
  })
  .strict()
  .describe('The latest identity check; informational only, it never blocks (R10).');

export type IdentityCheck = z.infer<typeof identityCheckSchema>;

export const supplierSummarySchema = z
  .object({
    supplierId: z.uuid().describe('The supplier.'),
    code: z
      .string()
      .regex(/^[A-Z0-9-]{2,20}$/)
      .describe('The supplier code, as the ERP or the tenant assigned it.'),
    name: z.string().min(1).describe('The supplier organisation name.'),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .describe('The ISO 3166-1 alpha-2 country of the supplier.'),
    approval: supplierApprovalSchema,
    identityCheck: identityCheckSchema,
    evidence: supplierEvidenceStatusSchema
      .nullable()
      .describe('The supplier’s evidence status, or null until the evidence vault has assessed the supplier.'),
  })
  .strict()
  .describe('One supplier with its approval, identity check and evidence status.');

export type SupplierSummary = z.infer<typeof supplierSummarySchema>;

export const supplierListSchema = z
  .object({
    asOf: asOfSchema,
    approvedListSource: z
      .enum(['erp', 'platform'])
      .describe('erp: the approved-supplier list mirrors the ERP and is read-only; platform: maintained here (R9).'),
    suppliers: z.array(supplierSummarySchema).describe('Every supplier, in name order.'),
  })
  .strict()
  .describe('The tenant supplier list.');

export type SupplierList = z.infer<typeof supplierListSchema>;

export const supplierListQuery = defineQuery({
  name: 'suppliers.list',
  description:
    'List the tenant suppliers with their approval scope and expiry, their latest identity check and their evidence status.',
  input: listInputSchema,
  output: supplierListSchema,
  errors: listReadErrors,
  access: staffListReaders,
});

export const supplierQueries = [supplierListQuery] as const;
