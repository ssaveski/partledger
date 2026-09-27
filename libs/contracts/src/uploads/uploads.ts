import { z } from 'zod';

import { apiBasePath, defineQuery, type AccessRule } from '../define';
import { errorCode } from '../errors';

/**
 * The upload pipeline (U14, KTD22, R12): every file, whether supplier evidence, a staff
 * document or an import spreadsheet, is streamed to quarantine while it is hashed and checked
 * against its purpose's allowlist, then scanned before anyone can open it. Uploads are raw
 * request bodies, not commands: the file is the body, and its metadata travels in headers.
 */

/** Why a file is uploaded; each purpose has its own allowlist and destination bucket. */
export const uploadPurposes = ['evidence', 'import'] as const;

export const uploadPurposeSchema = z
  .enum(uploadPurposes)
  .describe('evidence: supplier or staff documents (PDF, PNG, JPEG); import: spreadsheets for imports (XLSX, CSV).');

export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

export const pdfMediaType = 'application/pdf';
export const pngMediaType = 'image/png';
export const jpegMediaType = 'image/jpeg';
export const xlsxMediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const csvMediaType = 'text/csv';

export const uploadMediaTypes = [pdfMediaType, pngMediaType, jpegMediaType, xlsxMediaType, csvMediaType] as const;

export const uploadMediaTypeSchema = z.enum(uploadMediaTypes).describe('The media type, checked against the content.');

export type UploadMediaType = z.infer<typeof uploadMediaTypeSchema>;

/** The allowlist per purpose (KTD22): evidence is never a spreadsheet, an import never a document. */
export const uploadAllowlist = {
  evidence: [pdfMediaType, pngMediaType, jpegMediaType],
  import: [xlsxMediaType, csvMediaType],
} as const satisfies Record<UploadPurpose, readonly UploadMediaType[]>;

export function isAllowedFor(purpose: UploadPurpose, mediaType: UploadMediaType): boolean {
  const allowed: readonly UploadMediaType[] = uploadAllowlist[purpose];
  return allowed.includes(mediaType);
}

const mebibyte = 1024 * 1024;

/** The largest file of each type the pipeline accepts; a larger one is refused mid-stream. */
export const uploadSizeCaps = {
  [pdfMediaType]: 20 * mebibyte,
  [pngMediaType]: 10 * mebibyte,
  [jpegMediaType]: 10 * mebibyte,
  [xlsxMediaType]: 10 * mebibyte,
  [csvMediaType]: 10 * mebibyte,
} as const satisfies Record<UploadMediaType, number>;

/** The file name extensions each type may carry; the declared type, the name and the content must agree. */
export const uploadExtensions = {
  [pdfMediaType]: ['pdf'],
  [pngMediaType]: ['png'],
  [jpegMediaType]: ['jpg', 'jpeg'],
  [xlsxMediaType]: ['xlsx'],
  [csvMediaType]: ['csv'],
} as const satisfies Record<UploadMediaType, readonly [string, ...string[]]>;

/**
 * Who may upload for each purpose. A supplier contact uploads evidence through its link; the
 * handler narrows a link to what its scope allows once links carry one (U17, U31).
 */
export const uploadAccess = {
  evidence: { person: ['quality_engineer', 'buyer'], supplier_token: true },
  import: { person: ['buyer', 'quality_engineer'] },
} as const satisfies Record<UploadPurpose, AccessRule>;

/** Who may download a scanned, clean file; every download is audited. */
export const uploadDownloadAccess = {
  person: ['quality_engineer', 'buyer', 'auditor'],
} as const satisfies AccessRule;

/** `POST` the file as the raw body, with its media type as `Content-Type`. */
export function uploadPath(purpose: UploadPurpose): string {
  return `${apiBasePath}/uploads/${purpose}`;
}

/** `GET` a clean file; any other file is refused. */
export function uploadDownloadPath(uploadId: string): string {
  return `${apiBasePath}/uploads/${uploadId}/download`;
}

/** The file's name as the uploader knows it, percent-encoded UTF-8. */
export const uploadFileNameHeader = 'x-partledger-file-name';

/**
 * The uploader's attestation (Q6): the file holds no controlled technical data, such as
 * export-controlled drawings. An upload without it is refused. The value names the version of
 * the statement the uploader was shown (`pl.uploads.attestation.statement`).
 */
export const uploadAttestationHeader = 'x-partledger-attestation';

export const uploadAttestations = ['noControlledTechnicalData.v1'] as const;

export const uploadAttestationSchema = z
  .enum(uploadAttestations)
  .describe('The statement the uploader confirmed: the file holds no controlled technical data.');

export type UploadAttestation = z.infer<typeof uploadAttestationSchema>;

/** A file name as the uploader gives it: no path, no control characters. */
export const uploadFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\\p{Cc}]+$/u)
  .refine((name) => name.trim() === name && name !== '.' && name !== '..')
  .describe('The file name the uploader gave, without any path.');

export const scanStatuses = ['pending', 'clean', 'flagged'] as const;

export const scanStatusSchema = z
  .enum(scanStatuses)
  .describe('pending: not scanned yet; clean: scanned and safe to open; flagged: kept in quarantine and never served.');

export type ScanStatus = z.infer<typeof scanStatusSchema>;

/**
 * Why a file was flagged (R12, KTD22): malware; content beyond the scanner's limits, which
 * fails closed; a PDF with active content; or stored content that no longer matches its hash.
 */
export const scanFindings = ['malware', 'scanLimitExceeded', 'pdfActiveContent', 'contentChanged'] as const;

export const scanFindingSchema = z.enum(scanFindings).describe('Why the file was flagged.');

export type ScanFinding = z.infer<typeof scanFindingSchema>;

const contentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('SHA-256 of the file, computed while it streamed in.');

export const uploadReceiptSchema = z
  .object({
    uploadId: z.uuid().describe('The upload.'),
    purpose: uploadPurposeSchema,
    mediaType: uploadMediaTypeSchema,
    sizeBytes: z.number().int().positive().describe('The file size in bytes.'),
    contentHash: contentHashSchema,
    scanStatus: z.literal('pending').describe('Every upload starts pending; it is served only once scanned clean.'),
  })
  .strict()
  .describe('The upload as received: stored in quarantine, waiting for its scan.');

export type UploadReceipt = z.infer<typeof uploadReceiptSchema>;

export const uploadStatusSchema = z
  .object({
    uploadId: z.uuid().describe('The upload.'),
    purpose: uploadPurposeSchema,
    mediaType: uploadMediaTypeSchema,
    sizeBytes: z.number().int().positive().describe('The file size in bytes.'),
    contentHash: contentHashSchema,
    scanStatus: scanStatusSchema,
    finding: scanFindingSchema.nullable().describe('Why the file was flagged, or null.'),
    uploadedAt: z.iso.datetime().describe('When the file arrived.'),
    scannedAt: z.iso.datetime().nullable().describe('When the scan decided, or null while pending.'),
  })
  .strict()
  .describe('An upload and where its scan stands.');

export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const uploadStatusQuery = defineQuery({
  name: 'uploads.status',
  description: 'Read an upload and where its malware scan stands. A supplier link reads only its own uploads.',
  input: z
    .object({ uploadId: z.uuid().describe('The upload.') })
    .strict()
    .describe('The upload to read.'),
  output: uploadStatusSchema,
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  access: { person: ['quality_engineer', 'buyer', 'auditor'], supplier_token: true },
});
