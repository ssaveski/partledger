import { z } from 'zod';

import { apiBasePath, defineQuery } from '../define';
import { messageKeySchema } from '../errors';
import { lifecycleRead } from '../lifecycle';
import { partCategorySchema } from '../parts/queries';
import { principalTypeSchema } from '../principals';
import { asOfSchema, expiryStatusSchema, listInputSchema, listReadErrors } from '../reads';

/**
 * The evidence review queue (U27): documents awaiting a quality engineer, and the evidence gaps
 * a deviation can cover (R41). U15 implements it on the API; until then the fixture adapter
 * serves synthetic documents in this shape.
 */

/** Reviewing evidence is quality work; auditors may read the queue, and buyers see it on the overview. */
const evidenceReaders = { person: ['quality_engineer', 'buyer', 'auditor'] } as const;

export const evidenceTypeSchema = z
  .object({
    code: z
      .string()
      .regex(/^[a-z]{2}\.[a-z][a-zA-Z]+$/)
      .describe('The pack evidence type, prefixed by its market pack, such as ca.qualityCertificate (R11).'),
    label: messageKeySchema.describe('The message key naming the evidence type.'),
  })
  .strict()
  .describe('An evidence type from the market pack.');

export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

const supplierReferenceSchema = z
  .object({
    supplierId: z.uuid().describe('The supplier.'),
    name: z.string().min(1).describe('The supplier organisation name.'),
  })
  .strict()
  .describe('The supplier the evidence belongs to.');

/** The document types the upload pipeline accepts for evidence (KTD22). */
export const evidenceMediaTypes = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export const documentTransitions = ['confirm', 'reject'] as const;

export const reviewDocumentSchema = lifecycleRead(
  z
    .object({
      documentId: z.uuid().describe('The evidence document.'),
      supplier: supplierReferenceSchema,
      evidenceType: evidenceTypeSchema,
      fileName: z.string().min(1).max(255).describe('The file name the uploader gave.'),
      mediaType: z.enum(evidenceMediaTypes).describe('The media type, checked against the file content.'),
      sizeBytes: z.number().int().positive().describe('The file size in bytes.'),
      contentHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .describe('SHA-256 of the file, which a seal records.'),
      uploadedAt: z.iso.datetime().describe('When the file arrived.'),
      uploadedBy: z
        .object({
          name: z.string().min(1).describe('The declared name of the person who uploaded it.'),
          actorType: principalTypeSchema
            .extract(['person', 'supplier_token'])
            .describe('A staff member, or a supplier contact through a supplier link.'),
        })
        .strict()
        .describe('Who uploaded the file and through which kind of access.'),
      issuedOn: z.iso.date().nullable().describe('The issue date the document states, or null.'),
      expiresOn: z.iso.date().nullable().describe('The expiry date the document states, or null when undated.'),
      validUntil: z.iso
        .date()
        .nullable()
        .describe('The last day it counts: its expiry, or 12 months from issue for an undated attestation (R13).'),
      expiry: expiryStatusSchema,
      scope: z.array(partCategorySchema).describe('The part categories the document covers.'),
      scan: z
        .enum(['clean', 'pending'])
        .describe('clean: scanned and safe to open; pending: not scanned yet, so it is never served (R12).'),
    })
    .strict(),
  documentTransitions,
).describe('A document awaiting confirmation, with what the reviewer may do next.');

export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;

export const evidenceProblems = ['missing', 'expired', 'rejected'] as const;

export const evidenceDeviationSchema = z
  .object({
    deviationId: z.uuid().describe('The deviation.'),
    reason: z.string().min(1).describe('Why the quality engineer accepted the gap.'),
    recordedBy: z.string().min(1).describe('The quality engineer who recorded it.'),
    recordedAt: z.iso.datetime().describe('When it was recorded.'),
    expiresOn: z.iso.date().describe('The last day the deviation is active.'),
  })
  .strict()
  .describe('An active, time-limited deviation covering the gap (R41).');

export type EvidenceDeviation = z.infer<typeof evidenceDeviationSchema>;

export const gapTransitions = ['recordDeviation'] as const;

export const evidenceGapSchema = lifecycleRead(
  z
    .object({
      supplier: supplierReferenceSchema,
      evidenceType: evidenceTypeSchema,
      problem: z
        .enum(evidenceProblems)
        .describe(
          'missing: never supplied; expired: its last document ended; rejected: its last document was rejected.',
        ),
      since: z.iso.date().nullable().describe('Since when the evidence has been expired or rejected, or null.'),
      deviation: evidenceDeviationSchema.nullable().describe('The active deviation covering the gap, or null.'),
    })
    .strict(),
  gapTransitions,
)
  // Missing evidence was never supplied, so it has no date; expired or rejected evidence has one.
  .superRefine((gap, context) => {
    if ((gap.since === null) !== (gap.problem === 'missing')) {
      context.addIssue({
        code: 'custom',
        path: ['since'],
        message: 'since is null exactly when the problem is missing',
      });
    }
  })
  .describe('Required evidence of one type that a supplier lacks, and any deviation covering it.');

export type EvidenceGap = z.infer<typeof evidenceGapSchema>;

export const reviewQueueSchema = z
  .object({
    asOf: asOfSchema,
    maxDeviationUntil: z.iso.date().describe('The latest end date a deviation recorded today may have.'),
    documents: z.array(reviewDocumentSchema).describe('Documents awaiting confirmation, oldest upload first.'),
    gaps: z.array(evidenceGapSchema).describe('Evidence gaps of approved suppliers, by supplier name.'),
  })
  .strict()
  .superRefine((queue, context) => {
    if (queue.maxDeviationUntil <= queue.asOf) {
      context.addIssue({
        code: 'custom',
        path: ['maxDeviationUntil'],
        message: 'a deviation recorded today must be able to end after today',
      });
    }
  })
  .describe('The evidence review queue.');

export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

export const reviewQueueQuery = defineQuery({
  name: 'evidence.reviewQueue',
  description:
    'List the evidence documents awaiting confirmation with their metadata, and the evidence gaps a quality engineer can cover with a deviation.',
  input: listInputSchema,
  output: reviewQueueSchema,
  errors: listReadErrors,
  access: evidenceReaders,
});

export const evidenceQueries = [reviewQueueQuery] as const;

/**
 * Where a document is opened: U14's download streams it with safe headers and writes an audit
 * entry, and serves only files that passed the malware scan (R12).
 */
export function evidenceDownloadPath(documentId: string): string {
  return `${apiBasePath}/evidence/documents/${documentId}/download`;
}
