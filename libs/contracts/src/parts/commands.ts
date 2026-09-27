import { z } from 'zod';

import { defineCommand, expectedVersionSchema } from '../define';
import { errorCode } from '../errors';
import { partCategorySchema, partUnitSchema } from './queries';

/**
 * Changes to the tenant parts list (U10). Parts created here are `platform` parts; `erp` parts
 * arrive through imports (U12, U13), and their ERP-owned fields are read-only here: a change to
 * one of them is refused as `sourceOwned`. The category is the platform's classification, so it
 * stays editable on every part.
 */

/** The fields the ERP owns on an `erp` part; the platform never changes them. */
export const erpOwnedPartFields = ['partNumber', 'revision', 'description', 'unit'] as const;

export type ErpOwnedPartField = (typeof erpOwnedPartFields)[number];

/** Buyers and quality engineers maintain parts; nobody else changes them. */
const partMaintainers = { person: ['buyer', 'quality_engineer'] } as const;

export const partNumberSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/)
  .describe('The part number: letters, digits, dots, hyphens, underscores and slashes, up to 64.');

export const partRevisionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/)
  .describe('The revision, such as C or 02.');

export const partDescriptionSchema = z.string().trim().min(1).max(500).describe('What the part is.');

const partIdSchema = z.uuid().describe('The part.');

const partVersionOutputSchema = z
  .object({
    partId: partIdSchema,
    version: z.number().int().min(1).describe('The part’s version after the change.'),
  })
  .strict()
  .describe('The part and its new version.');

export const createPartCommand = defineCommand({
  name: 'parts.create',
  description: 'Adds a part maintained in the platform to the tenant parts list.',
  purpose: 'business',
  input: z
    .object({
      partNumber: partNumberSchema,
      revision: partRevisionSchema,
      description: partDescriptionSchema,
      category: partCategorySchema,
      unit: partUnitSchema,
    })
    .strict()
    .describe('The new part.'),
  output: partVersionOutputSchema,
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('Conflict', 'alreadyExists')],
  access: partMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const partChangesSchema = z
  .object({
    partNumber: partNumberSchema.optional(),
    revision: partRevisionSchema.optional(),
    description: partDescriptionSchema.optional(),
    category: partCategorySchema.optional(),
    unit: partUnitSchema.optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'Name at least one field to change.',
  })
  .describe('The fields to change; fields left out keep their value.');

export type PartChanges = z.infer<typeof partChangesSchema>;

export const updatePartCommand = defineCommand({
  name: 'parts.update',
  description:
    'Changes a part’s fields. On a part from the ERP only the category may change; its ERP-owned fields are refused.',
  purpose: 'business',
  input: z
    .object({ partId: partIdSchema, expectedVersion: expectedVersionSchema, changes: partChangesSchema })
    .strict()
    .describe('The part, the version last read, and the changes.'),
  output: partVersionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Conflict', 'alreadyExists'),
    errorCode('Unprocessable', 'sourceOwned'),
  ],
  access: partMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: true,
});

export const setPartActiveCommand = defineCommand({
  name: 'parts.setActive',
  description:
    'Deactivates a platform part, which keeps it for the records that name it, or reactivates it. The ERP decides for its own parts.',
  purpose: 'business',
  input: z
    .object({
      partId: partIdSchema,
      expectedVersion: expectedVersionSchema,
      active: z.boolean().describe('True to reactivate the part, false to deactivate it.'),
    })
    .strict()
    .describe('The part, the version last read, and whether it is active.'),
  output: partVersionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Unprocessable', 'sourceOwned'),
  ],
  access: partMaintainers,
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: true,
});

export const partCommands = [createPartCommand, updatePartCommand, setPartActiveCommand] as const;
