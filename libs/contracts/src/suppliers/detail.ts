import { z } from 'zod';

import { defineQuery } from '../define';
import { errorCode } from '../errors';
import { partSourceSchema } from '../parts/queries';
import { asOfSchema, staffListReaders } from '../reads';
import {
  contactRoleSchema,
  countryCodeSchema,
  supplierCodeSchema,
  supplierNameSchema,
  supplierStatusSchema,
} from './commands';
import { identityCheckSchema, supplierApprovalSchema } from './queries';

/**
 * One supplier with everything a change to it needs (U10): its versions, contacts, and the
 * latest check against each register that applies to it.
 */

export const supplierContactSchema = z
  .object({
    contactId: z.uuid().describe('The contact.'),
    name: z.string().min(1).describe('The contact’s name.'),
    email: z.email().describe('The contact’s work email address.'),
    role: contactRoleSchema,
    addedAt: z.iso.datetime().describe('When the contact was added.'),
  })
  .strict()
  .describe('A current contact of the supplier.');

export type SupplierContact = z.infer<typeof supplierContactSchema>;

export const supplierDetailSchema = z
  .object({
    asOf: asOfSchema,
    approvedListSource: z
      .enum(['erp', 'platform'])
      .describe('erp: the approved-supplier list mirrors the ERP and is read-only; platform: maintained here (R9).'),
    supplier: z
      .object({
        supplierId: z.uuid().describe('The supplier.'),
        code: supplierCodeSchema,
        name: supplierNameSchema,
        country: countryCodeSchema,
        vatId: z.string().nullable().describe('The VAT id, or null.'),
        lei: z.string().nullable().describe('The Legal Entity Identifier, or null.'),
        status: supplierStatusSchema,
        source: partSourceSchema.describe('erp: the ERP owns its code, name and country; platform: maintained here.'),
        version: z.number().int().min(1).describe('The supplier’s version, which a change names as expected.'),
        approval: supplierApprovalSchema,
        approvalVersion: z
          .number()
          .int()
          .min(0)
          .describe('The approval’s version, which a change to it names as expected; 0 when not on the list.'),
        identityChecks: z
          .array(identityCheckSchema)
          .describe(
            'The latest check against each register that applies, VIES first; empty when none applies. Informational only (R10).',
          ),
        contacts: z.array(supplierContactSchema).describe('Current contacts, in the order they were added.'),
      })
      .strict()
      .describe('The supplier.'),
  })
  .strict()
  .describe('One supplier of the tenant.');

export type SupplierDetail = z.infer<typeof supplierDetailSchema>;

export const supplierDetailQuery = defineQuery({
  name: 'suppliers.detail',
  description: 'One supplier with its versions, approval, identity checks and current contacts.',
  input: z
    .object({ supplierId: z.uuid().describe('The supplier.') })
    .strict()
    .describe('Which supplier.'),
  output: supplierDetailSchema,
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  access: staffListReaders,
});
