import { Injectable } from '@nestjs/common';
import {
  scanFindingSchema,
  scanStatusSchema,
  uploadMediaTypeSchema,
  uploadPurposeSchema,
  uploadStatusQuery,
  type InputOf,
} from '@partledger/contracts';
import { refuse, success } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { HandlerResult, OperationContext, QueryHandler } from '../commands/handlers';

const statusRows = z.array(
  z.object({
    id: z.uuid(),
    purpose: uploadPurposeSchema,
    media_type: uploadMediaTypeSchema,
    size_bytes: z.coerce.number().int().positive(),
    content_hash: z.string(),
    scan_status: scanStatusSchema,
    scan_finding: scanFindingSchema.nullable(),
    uploaded_at: z.coerce.date(),
    scanned_at: z.coerce.date().nullable(),
  }),
);

/**
 * Reads where an upload's scan stands. Staff read any upload of their tenant; a supplier link
 * reads only what was uploaded under that link, and any other upload is not found.
 */
@Injectable()
export class UploadStatusHandler implements QueryHandler<typeof uploadStatusQuery> {
  async execute(
    input: InputOf<typeof uploadStatusQuery>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof uploadStatusQuery>> {
    const { principal } = context;
    const credentialId =
      principal.type === 'supplier_token' && 'credentialId' in principal.actedUnder
        ? principal.actedUnder.credentialId
        : null;
    const result = await context.database.execute(
      sql`select id, purpose, media_type, size_bytes, content_hash, scan_status, scan_finding, uploaded_at, scanned_at
            from uploads
           where id = ${input.uploadId}
             and (${principal.type !== 'supplier_token'} or credential_id = ${credentialId})`,
    );
    const [upload] = statusRows.parse(result.rows);
    if (upload === undefined) {
      return refuse('NotFound', 'resource');
    }
    return success({
      uploadId: upload.id,
      purpose: upload.purpose,
      mediaType: upload.media_type,
      sizeBytes: upload.size_bytes,
      contentHash: upload.content_hash,
      scanStatus: upload.scan_status,
      finding: upload.scan_finding,
      uploadedAt: upload.uploaded_at.toISOString(),
      scannedAt: upload.scanned_at?.toISOString() ?? null,
    });
  }
}
