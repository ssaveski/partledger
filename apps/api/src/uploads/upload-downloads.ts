import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import {
  uploadDownloadAccess,
  uploadMediaTypeSchema,
  uploadPurposeSchema,
  type UploadMediaType,
} from '@partledger/contracts';
import { schema } from '@partledger/db';
import { domainError, type DomainError } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditHash, auditId, auditToken } from '../audit/audit-payload';
import { appendAuditEntry, auditActorOf } from '../audit/audit-writer';
import { TenantTransactions } from '../db/tenant-transaction';
import { entryAdapterOf } from '../listeners/listeners';
import { isAllowed } from '../principals/authorize';
import type { Principal } from '../principals/principal';
import { PrincipalResolver } from '../principals/principal-resolver';
import { roleDirectory, type RoleDirectory } from '../principals/role-directory';
import { destinationBucketOf, objectKeyOf, objectStorage, type ObjectStorage } from '../storage/storage.port';
import { clock, type Clock } from '../time/clock';

export interface ServedFile {
  readonly body: Readable;
  readonly sizeBytes: number;
  readonly mediaType: UploadMediaType;
  readonly fileName: string;
}

export type DownloadOutcome =
  | { readonly kind: 'served'; readonly file: ServedFile }
  | { readonly kind: 'failure'; readonly error: DomainError }
  | { readonly kind: 'unauthenticated' };

const uploadRows = z.array(
  z.object({
    purpose: uploadPurposeSchema,
    media_type: uploadMediaTypeSchema,
    file_name: z.string(),
    size_bytes: z.coerce.number().int().positive(),
    content_hash: z.string().regex(/^[0-9a-f]{64}$/),
    scan_status: z.enum(schema.uploadScanStatuses),
  }),
);

/**
 * Serves clean files (KTD22, R12). A file that is pending or flagged is refused, whoever asks,
 * so an unscanned or infected file is never served. Every download is audited before the
 * first byte leaves; the file streams from its purpose's bucket, never from quarantine.
 */
@Injectable()
export class UploadDownloads {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(roleDirectory) private readonly roles: RoleDirectory,
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(objectStorage) private readonly storage: ObjectStorage,
    @Inject(clock) private readonly time: Clock,
  ) {}

  async open(request: IncomingMessage, uploadIdParameter: string, correlationId: string): Promise<DownloadOutcome> {
    const adapter = entryAdapterOf(request);
    if (adapter === undefined) {
      return { kind: 'unauthenticated' };
    }
    const authentication = await this.principals.authenticate(
      adapter,
      { authorization: request.headers.authorization, cookie: request.headers.cookie },
      correlationId,
      this.time.now(),
    );
    if (!authentication.ok) {
      return authentication.reason === 'unavailable'
        ? { kind: 'failure', error: domainError('Unavailable', 'dependencyUnavailable') }
        : { kind: 'unauthenticated' };
    }
    const authenticated = authentication.principal;
    const uploadId = z.uuid().safeParse(uploadIdParameter);
    if (!uploadId.success) {
      return { kind: 'failure', error: domainError('NotFound', 'resource') };
    }
    const found = await this.transactions.run(authenticated.tenantId, async (database) => {
      const principal: Principal =
        authenticated.type === 'person'
          ? {
              ...authenticated,
              roles: await this.roles.rolesOf(
                { tenantId: authenticated.tenantId, userId: authenticated.userId },
                database,
              ),
            }
          : authenticated;
      if (!isAllowed(uploadDownloadAccess, principal)) {
        return { kind: 'refused', error: domainError('Forbidden', 'notPermitted') } as const;
      }
      const [upload] = uploadRows.parse(
        (
          await database.execute(
            sql`select purpose, media_type, file_name, size_bytes, content_hash, scan_status
                  from uploads where id = ${uploadId.data}`,
          )
        ).rows,
      );
      if (upload === undefined) {
        return { kind: 'refused', error: domainError('NotFound', 'resource') } as const;
      }
      if (upload.scan_status !== 'clean') {
        return { kind: 'refused', error: domainError('Conflict', 'uploadNotServable') } as const;
      }
      return { kind: 'found', principal, upload } as const;
    });
    if (found.kind === 'refused') {
      return { kind: 'failure', error: found.error };
    }
    const { principal, upload } = found;
    const stored = await this.storage.get({
      bucket: destinationBucketOf(upload.purpose),
      key: objectKeyOf(principal.tenantId, upload.purpose, uploadId.data),
    });
    if (!stored.ok) {
      return { kind: 'failure', error: domainError('Unavailable', 'dependencyUnavailable') };
    }
    try {
      await this.transactions.run(principal.tenantId, (database) =>
        appendAuditEntry(
          database,
          {
            tenantId: principal.tenantId,
            actor: auditActorOf(principal),
            event: auditToken('uploads.downloaded'),
            data: { uploadId: auditId(uploadId.data), contentHash: auditHash(upload.content_hash) },
          },
          this.time,
        ),
      );
    } catch (error) {
      stored.value.body.destroy();
      throw error;
    }
    return {
      kind: 'served',
      file: {
        body: stored.value.body,
        sizeBytes: stored.value.sizeBytes,
        mediaType: upload.media_type,
        fileName: upload.file_name,
      },
    };
  }
}
