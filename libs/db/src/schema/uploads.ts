import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { credentials } from './credentials.ts';
import { tenants } from './tenants.ts';

export const uploadPurposes = ['evidence', 'import'] as const;

export const uploadScanStatuses = ['pending', 'clean', 'flagged'] as const;

export const uploadScanFindings = ['malware', 'scanLimitExceeded', 'pdfActiveContent', 'contentChanged'] as const;

/**
 * Every file the upload pipeline accepted (U14, KTD22, R12). A row is written after the file
 * has streamed into quarantine, in a short transaction of its own, so no upload holds a
 * database connection while it streams. The object key derives from the tenant, the purpose
 * and the id and never carries the file name. A file is served only once its scan decided
 * `clean`; the scan decides once, and a trigger keeps every other column fixed.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    purpose: text('purpose', { enum: uploadPurposes }).notNull(),
    mediaType: text('media_type').notNull(),
    /** The name the uploader gave, shown to reviewers; never part of an object key or an audit entry. */
    fileName: text('file_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the content as it streamed in, lowercase hex; a seal records it (R25). */
    contentHash: text('content_hash').notNull(),
    /** The statement the uploader confirmed (Q6). */
    attestation: text('attestation').notNull(),
    uploaderType: text('uploader_type', { enum: ['person', 'supplier_token'] }).notNull(),
    /** The person, or the supplier of the link once links name one (U17). */
    uploaderId: uuid('uploader_id'),
    /** The staff session or supplier link the file was uploaded under; per-link quotas count by it. */
    credentialId: uuid('credential_id').notNull(),
    uploadedAt: timestamptz('uploaded_at').notNull(),
    scanStatus: text('scan_status', { enum: uploadScanStatuses }).notNull(),
    scanFinding: text('scan_finding', { enum: uploadScanFindings }),
    /** The scanner's signature name for a finding, such as `Win.Test.EICAR_HDB-1`. */
    scanSignature: text('scan_signature'),
    scannedAt: timestamptz('scanned_at'),
  },
  (table) => [
    foreignKey({ name: 'uploads_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'uploads_credential_fkey',
      columns: [table.tenantId, table.credentialId],
      foreignColumns: [credentials.tenantId, credentials.id],
    }),
    index('uploads_credential_index').on(table.tenantId, table.credentialId),
    index('uploads_tenant_uploaded_index').on(table.tenantId, table.uploadedAt),
    index('uploads_pending_index')
      .on(table.tenantId, table.uploadedAt)
      .where(sql`${table.scanStatus} = 'pending'`),
    check('uploads_purpose_check', sql`${table.purpose} in ('evidence', 'import')`),
    check(
      'uploads_media_type_check',
      sql`(${table.purpose} = 'evidence' and ${table.mediaType} in ('application/pdf', 'image/png', 'image/jpeg'))
        or (${table.purpose} = 'import' and ${table.mediaType} in
            ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'))`,
    ),
    check(
      'uploads_file_name_check',
      sql`length(${table.fileName}) between 1 and 255 and ${table.fileName} !~ '[/\\\\[:cntrl:]]'`,
    ),
    check('uploads_size_check', sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 20971520`),
    check('uploads_content_hash_check', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('uploads_attestation_check', sql`${table.attestation} in ('noControlledTechnicalData.v1')`),
    check('uploads_uploader_type_check', sql`${table.uploaderType} in ('person', 'supplier_token')`),
    check('uploads_scan_status_check', sql`${table.scanStatus} in ('pending', 'clean', 'flagged')`),
    check(
      'uploads_scan_finding_check',
      sql`(${table.scanStatus} = 'flagged') = (${table.scanFinding} is not null)
        and (${table.scanFinding} is null
             or ${table.scanFinding} in ('malware', 'scanLimitExceeded', 'pdfActiveContent', 'contentChanged'))`,
    ),
    check(
      'uploads_scan_signature_check',
      sql`${table.scanSignature} is null
        or (${table.scanStatus} = 'flagged' and ${table.scanSignature} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')`,
    ),
    check('uploads_scanned_check', sql`(${table.scanStatus} = 'pending') = (${table.scannedAt} is null)`),
  ],
);

export const uploadsAccess = defineTableAccess({
  table: 'uploads',
  tenantKey: 'tenant_id',
  // Only the scan's decision moves, once; a trigger keeps everything else fixed.
  grants: { pl_app: ['SELECT', 'INSERT'] },
  columnGrants: {
    pl_app: {
      scan_status: ['UPDATE'],
      scan_finding: ['UPDATE'],
      scan_signature: ['UPDATE'],
      scanned_at: ['UPDATE'],
    },
  },
});
