import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import { pdfMediaType, uploadPurposeSchema, type ScanFinding } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditHash, auditId, auditToken } from '../audit/audit-payload';
import type { JobItemContext } from '../jobs/job.types';
import {
  destinationBucketOf,
  objectKeyOf,
  objectStorage,
  type ObjectLocation,
  type ObjectStorage,
} from '../storage/storage.port';
import { malwareScanner, type MalwareScanner } from './malware-scanner.port';
import { inspectPdf } from './pdf-active-content';
import { releaseQuarantineJob } from './release-quarantine.job';

/** What one scan attempt did. Only the two `Unavailable` outcomes leave the upload pending. */
export type ScanAttempt = 'decided' | 'alreadyDecided' | 'missing' | 'scannerUnavailable' | 'storageUnavailable';

const uploadRows = z.array(
  z.object({
    purpose: uploadPurposeSchema,
    media_type: z.string(),
    size_bytes: z.coerce.number().int().positive(),
    content_hash: z.string().regex(/^[0-9a-f]{64}$/),
    scan_status: z.enum(schema.uploadScanStatuses),
  }),
);

async function readAtMost(body: Readable, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Buffer)) {
      body.destroy();
      return null;
    }
    size += chunk.byteLength;
    if (size > limit) {
      body.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

interface Decision {
  readonly finding: ScanFinding | null;
  readonly signature: string | null;
}

/**
 * Scans one quarantined upload and records the decision (KTD22, R12), inside the job item's
 * transaction and under the upload's own lock, so two runs never decide the same upload twice.
 * The stored bytes are hashed again before the scan, so what is scanned and released is exactly
 * what was uploaded. A clean file is copied to its purpose's bucket before it is marked clean,
 * and its quarantine copy is removed by a follow-up job once that commits; anything flagged
 * stays in quarantine. An unreachable scanner or store decides nothing.
 */
@Injectable()
export class UploadScanning {
  constructor(
    @Inject(objectStorage) private readonly storage: ObjectStorage,
    @Inject(malwareScanner) private readonly scanner: MalwareScanner,
  ) {}

  async scan(uploadId: string, context: JobItemContext): Promise<ScanAttempt> {
    const { database } = context;
    await database.execute(
      sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`partledger/uploads/scan:${uploadId}`}, 0))`,
    );
    const [upload] = uploadRows.parse(
      (
        await database.execute(
          sql`select purpose, media_type, size_bytes, content_hash, scan_status from uploads where id = ${uploadId}`,
        )
      ).rows,
    );
    if (upload === undefined) {
      return 'missing';
    }
    if (upload.scan_status !== 'pending') {
      return 'alreadyDecided';
    }
    const key = objectKeyOf(context.principal.tenantId, upload.purpose, uploadId);
    const quarantine: ObjectLocation = { bucket: 'quarantine', key };
    const stored = await this.storage.get(quarantine);
    if (!stored.ok && stored.error._tag === 'Unavailable') {
      return 'storageUnavailable';
    }
    const content = stored.ok ? await readAtMost(stored.value.body, upload.size_bytes) : null;
    if (content === null || createHash('sha256').update(content).digest('hex') !== upload.content_hash) {
      await this.record(context, uploadId, upload.content_hash, { finding: 'contentChanged', signature: null });
      return 'decided';
    }
    const verdict = await this.scanner.scan(content);
    if (verdict.kind === 'unavailable') {
      return 'scannerUnavailable';
    }
    let decision: Decision =
      verdict.kind === 'clean'
        ? { finding: null, signature: null }
        : {
            finding: verdict.kind === 'infected' ? 'malware' : 'scanLimitExceeded',
            signature: verdict.signature,
          };
    if (decision.finding === null && upload.media_type === pdfMediaType) {
      const inspection = inspectPdf(content);
      if (inspection.kind !== 'passive') {
        decision = {
          finding: 'pdfActiveContent',
          signature:
            inspection.kind === 'active' ? `Partledger.Pdf.${inspection.marker}` : 'Partledger.Pdf.Uninspectable',
        };
      }
    }
    if (decision.finding === null) {
      const copied = await this.storage.copy(quarantine, { bucket: destinationBucketOf(upload.purpose), key });
      if (!copied.ok) {
        return 'storageUnavailable';
      }
    }
    await this.record(context, uploadId, upload.content_hash, decision);
    if (decision.finding === null) {
      await context.jobs.enqueue(releaseQuarantineJob, { uploadId });
    }
    return 'decided';
  }

  private async record(context: JobItemContext, uploadId: string, contentHash: string, decision: Decision) {
    const now = context.now.toISOString();
    await context.database.execute(
      decision.finding === null
        ? sql`update uploads set scan_status = 'clean', scanned_at = ${now}::timestamptz where id = ${uploadId}`
        : sql`update uploads
                 set scan_status = 'flagged', scan_finding = ${decision.finding},
                     scan_signature = ${decision.signature}, scanned_at = ${now}::timestamptz
               where id = ${uploadId}`,
    );
    await context.audit.record(auditToken('uploads.scanned'), {
      uploadId: auditId(uploadId),
      contentHash: auditHash(contentHash),
      outcome: auditToken(decision.finding === null ? 'clean' : 'flagged'),
      finding: decision.finding === null ? null : auditToken(decision.finding),
    });
  }
}
