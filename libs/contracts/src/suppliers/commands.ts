import { z } from 'zod';

import { defineCommand, expectedVersionSchema } from '../define';
import { errorCode } from '../errors';
import { partCategorySchema } from '../parts/queries';
import { approvalStatusSchema } from './queries';

/**
 * Changes to the tenant's suppliers, their contacts and the approved-supplier list (U10, R9,
 * R10). Suppliers created here are `platform` suppliers; `erp` suppliers arrive through imports
 * (U12, U13), and the fields their ERP owns are refused as `sourceOwned`. The approved-supplier
 * list changes here only while the tenant maintains it in the platform, and only by a quality
 * engineer; a tenant whose ERP owns it gets `approvedListErpOwned`.
 */

/** The fields the ERP owns on an `erp` supplier; identity data (VAT id, LEI) is kept here. */
export const erpOwnedSupplierFields = ['code', 'name', 'country'] as const;

export type ErpOwnedSupplierField = (typeof erpOwnedSupplierFields)[number];

export const supplierStatuses = ['active', 'inactive'] as const;

export const supplierStatusSchema = z
  .enum(supplierStatuses)
  .describe('active: can be invited; inactive: kept for the records that name it, never invited.');

export const contactRoles = ['sales', 'quality', 'logistics', 'finance', 'other'] as const;

export const contactRoleSchema = z.enum(contactRoles).describe('What the contact handles for the supplier.');

export type ContactRole = z.infer<typeof contactRoleSchema>;

/** Buyers and quality engineers maintain suppliers and contacts. */
const supplierMaintainers = { person: ['buyer', 'quality_engineer'] } as const;

/** R9: only a quality engineer changes the approved-supplier list. */
const approvedListMaintainers = { person: ['quality_engineer'] } as const;

export const supplierCodeSchema = z
  .string()
  .regex(/^[A-Z0-9-]{2,20}$/)
  .describe('The supplier code: capitals, digits and hyphens, 2 to 20.');

export const supplierNameSchema = z.string().trim().min(1).max(200).describe('The supplier organisation name.');

export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .describe('The ISO 3166-1 alpha-2 country of the supplier.');

export const vatIdSchema = z
  .string()
  .regex(/^[A-Z]{2}[A-Z0-9+*]{2,12}$/)
  .describe('The VAT id with its two-letter prefix and no spaces, such as SE556677889901.');

/** ISO 17442: 18 characters, then two check digits that make the whole code 1 modulo 97. */
export function isValidLei(value: string): boolean {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(value)) {
    return false;
  }
  let remainder = 0;
  for (const character of value) {
    const digits = /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export const leiSchema = z
  .string()
  .refine(isValidLei, { message: 'Not a valid LEI.' })
  .describe('The Legal Entity Identifier: 20 characters ending in two check digits.');

const supplierIdSchema = z.uuid().describe('The supplier.');

const supplierVersionOutputSchema = z
  .object({
    supplierId: supplierIdSchema,
    version: z.number().int().min(1).describe('The supplier’s version after the change.'),
  })
  .strict()
  .describe('The supplier and its new version.');

export const createSupplierCommand = defineCommand({
  name: 'suppliers.create',
  description:
    'Adds a supplier maintained in the platform and queues its identity checks against the EU VAT and LEI registers.',
  purpose: 'business',
  input: z
    .object({
      code: supplierCodeSchema,
      name: supplierNameSchema,
      country: countryCodeSchema,
      vatId: vatIdSchema.nullable().describe('The VAT id, or null when the supplier has none.'),
      lei: leiSchema.nullable().describe('The Legal Entity Identifier, or null when the supplier has none.'),
    })
    .strict()
    .describe('The new supplier.'),
  output: supplierVersionOutputSchema,
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('Conflict', 'alreadyExists')],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const supplierChangesSchema = z
  .object({
    code: supplierCodeSchema.optional(),
    name: supplierNameSchema.optional(),
    country: countryCodeSchema.optional(),
    vatId: vatIdSchema.nullable().optional(),
    lei: leiSchema.nullable().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'Name at least one field to change.',
  })
  .describe('The fields to change; fields left out keep their value, and null clears a VAT id or LEI.');

export type SupplierChanges = z.infer<typeof supplierChangesSchema>;

export const updateSupplierCommand = defineCommand({
  name: 'suppliers.update',
  description:
    'Changes a supplier’s details. A changed VAT id, LEI or name queues fresh identity checks; on a supplier from the ERP, its ERP-owned fields are refused.',
  purpose: 'business',
  input: z
    .object({ supplierId: supplierIdSchema, expectedVersion: expectedVersionSchema, changes: supplierChangesSchema })
    .strict()
    .describe('The supplier, the version last read, and the changes.'),
  output: supplierVersionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Conflict', 'alreadyExists'),
    errorCode('Unprocessable', 'sourceOwned'),
  ],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: true,
});

export const setSupplierStatusCommand = defineCommand({
  name: 'suppliers.setStatus',
  description:
    'Deactivates a platform supplier, which keeps it for the records that name it, or reactivates it. The ERP decides for its own suppliers.',
  purpose: 'business',
  input: z
    .object({ supplierId: supplierIdSchema, expectedVersion: expectedVersionSchema, status: supplierStatusSchema })
    .strict()
    .describe('The supplier, the version last read, and its new status.'),
  output: supplierVersionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Unprocessable', 'sourceOwned'),
  ],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: true,
});

export const contactNameSchema = z.string().trim().min(1).max(200).describe('The contact’s name.');

export const contactEmailSchema = z.email().max(254).toLowerCase().describe('The contact’s work email address.');

const contactIdSchema = z.uuid().describe('The contact.');

export const addContactCommand = defineCommand({
  name: 'suppliers.addContact',
  description: 'Adds a contact to a supplier; supplier links are sent to contacts.',
  purpose: 'business',
  input: z
    .object({
      supplierId: supplierIdSchema,
      name: contactNameSchema,
      email: contactEmailSchema,
      role: contactRoleSchema,
    })
    .strict()
    .describe('The supplier and its new contact.'),
  output: z.object({ supplierId: supplierIdSchema, contactId: contactIdSchema }).strict().describe('The new contact.'),
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'alreadyExists'),
  ],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const removeContactCommand = defineCommand({
  name: 'suppliers.removeContact',
  description:
    'Removes a contact from its supplier. The contact stays on record as removed; a changed address is a removal and a new contact.',
  purpose: 'business',
  input: z.object({ contactId: contactIdSchema }).strict().describe('The contact to remove.'),
  output: z
    .object({ supplierId: supplierIdSchema, contactId: contactIdSchema })
    .strict()
    .describe('The removed contact.'),
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const approvalScopeSchema = z
  .array(partCategorySchema)
  .max(20)
  .refine((scope) => new Set(scope).size === scope.length, { message: 'Name each category once.' })
  .describe('The part categories the approval covers, each once.');

export const setApprovalCommand = defineCommand({
  name: 'suppliers.setApproval',
  description:
    'Sets a supplier’s entry on the approved-supplier list: status, scope and expiry. Only for a list maintained in the platform, and only by a quality engineer (R9).',
  purpose: 'business',
  input: z
    .object({
      supplierId: supplierIdSchema,
      expectedVersion: expectedVersionSchema.describe(
        'The approval version last read; 0 for a supplier not yet on the list.',
      ),
      status: approvalStatusSchema,
      scope: approvalScopeSchema,
      expiresOn: z.iso.date().nullable().describe('The last day the approval is valid, or null for no end date.'),
    })
    .strict()
    .refine((entry) => entry.status !== 'notApproved' || (entry.scope.length === 0 && entry.expiresOn === null), {
      path: ['scope'],
      message: 'A supplier taken off the list keeps no scope or expiry.',
    })
    .refine((entry) => !['approved', 'conditional'].includes(entry.status) || entry.scope.length > 0, {
      path: ['scope'],
      message: 'An approval covers at least one category.',
    })
    .describe('The supplier, the approval version last read, and the entry.'),
  output: z
    .object({
      supplierId: supplierIdSchema,
      version: z.number().int().min(1).describe('The approval’s version after the change.'),
    })
    .strict()
    .describe('The supplier and its approval’s new version.'),
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Unprocessable', 'approvedListErpOwned'),
  ],
  access: approvedListMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: true,
});

export const checkIdentityCommand = defineCommand({
  name: 'suppliers.checkIdentity',
  description:
    'Queues fresh checks of the supplier against the registers that apply to it. The result is informational and never blocks the supplier (R10).',
  purpose: 'business',
  input: z.object({ supplierId: supplierIdSchema }).strict().describe('The supplier to check.'),
  output: z
    .object({
      supplierId: supplierIdSchema,
      registers: z
        .array(z.enum(['vies', 'lei']))
        .describe(
          'The registers that will be asked, by this request or by a check already queued; empty when none applies.',
        ),
    })
    .strict()
    .describe('What was queued.'),
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  access: supplierMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const supplierCommands = [
  createSupplierCommand,
  updateSupplierCommand,
  setSupplierStatusCommand,
  addContactCommand,
  removeContactCommand,
  setApprovalCommand,
  checkIdentityCommand,
] as const;
