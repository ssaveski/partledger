import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';
import {
  isAllowedFor,
  uploadAccess,
  uploadAttestationHeader,
  uploadAttestationSchema,
  uploadFileNameHeader,
  uploadFileNameSchema,
  uploadMediaTypeSchema,
  uploadPurposeSchema,
  uploadSizeCaps,
  type UploadAttestation,
  type UploadMediaType,
  type UploadPurpose,
  type UploadReceipt,
  type ValidationIssue,
} from '@partledger/contracts';
import { domainError, type DomainError } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditHash, auditId, auditToken } from '../audit/audit-payload';
import { appendAuditEntry, auditActorOf } from '../audit/audit-writer';
import { TenantTransactions, type AppDatabase } from '../db/tenant-transaction';
import { JobQueue } from '../jobs/enqueue';
import { entryAdapterOf } from '../listeners/listeners';
import { isAllowed } from '../principals/authorize';
import type { Principal } from '../principals/principal';
import { PrincipalResolver, type PresentedHeaders } from '../principals/principal-resolver';
import { roleDirectory, type RoleDirectory } from '../principals/role-directory';
import { objectStorage, objectKeyOf, type ObjectLocation, type ObjectStorage } from '../storage/storage.port';
import { clock, type Clock } from '../time/clock';
import { extensionAgreesWith } from './magic-bytes';
import { scanUploadJob } from './scan.job';
import { UploadInspector, UploadRefusedError } from './upload-inspector';
import { fileTypeTokens, uploadQuotas, type UploadQuotas } from './upload-settings';

/** How a request to upload ended; the controller turns it into a response. */
export type UploadOutcome =
  | { readonly kind: 'received'; readonly receipt: UploadReceipt }
  | {
      readonly kind: 'failure';
      readonly error: DomainError;
      /** The body was not read to its end, so the connection must close after the response. */
      readonly closeConnection: boolean;
    }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'unauthenticated' };

/** Why a checked upload was refused; each is audited, as the upload's refusal (R26). */
type Refusal =
  'attestationRequired' | 'uploadTypeNotAllowed' | 'uploadContentMismatch' | 'uploadTooLarge' | 'uploadQuotaExceeded';

interface CheckedRequest {
  readonly purpose: UploadPurpose;
  readonly mediaType: UploadMediaType;
  readonly fileName: string;
  readonly attestation: UploadAttestation;
}

interface Usage {
  readonly linkFiles: number;
  readonly linkBytes: number;
  readonly tenantFiles: number;
  readonly tenantBytes: number;
}

const usageRows = z.array(
  z.object({
    link_files: z.coerce.number(),
    link_bytes: z.coerce.number(),
    tenant_files: z.coerce.number(),
    tenant_bytes: z.coerce.number(),
  }),
);

const mebibyte = 1024 * 1024;

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

/** `type/subtype`, lowercased; a CSV may say it is UTF-8, which is all it may be. */
function declaredMediaType(header: string | undefined): UploadMediaType | null {
  if (header === undefined) {
    return null;
  }
  const [essence = '', ...parameters] = header.split(';').map((part) => part.trim().toLowerCase());
  const mediaType = uploadMediaTypeSchema.safeParse(essence);
  if (!mediaType.success) {
    return null;
  }
  const allowedParameters = mediaType.data === 'text/csv' ? ['charset=utf-8', 'charset="utf-8"'] : [];
  return parameters.every((parameter) => allowedParameters.includes(parameter)) ? mediaType.data : null;
}

function decodedFileName(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  try {
    const parsed = uploadFileNameSchema.safeParse(decodeURIComponent(header));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function credentialIdOf(principal: Principal): string | null {
  return 'credentialId' in principal.actedUnder ? principal.actedUnder.credentialId : null;
}

function exceedsQuota(principal: Principal, usage: Usage, quotas: UploadQuotas, sizeBytes: number): boolean {
  const perLink =
    principal.type === 'supplier_token' &&
    (usage.linkFiles + 1 > quotas.linkFiles || usage.linkBytes + sizeBytes > quotas.linkBytes);
  const perTenant =
    usage.tenantFiles + 1 > quotas.tenantDailyFiles || usage.tenantBytes + sizeBytes > quotas.tenantDailyBytes;
  return perLink || perTenant;
}

/**
 * The upload pipeline (KTD22, R12). A request is authenticated and authorised in one short
 * tenant transaction; the file then streams into quarantine through the inspector, which caps,
 * hashes and checks it, with no transaction and no pooled connection held; a second short
 * transaction re-checks the quotas under the tenant's upload lock, records the upload, appends
 * its audit entry and enqueues its scan. A refused upload leaves no object and is audited.
 */
@Injectable()
export class UploadPipeline {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(roleDirectory) private readonly roles: RoleDirectory,
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(objectStorage) private readonly storage: ObjectStorage,
    @Inject(JobQueue) private readonly jobQueue: JobQueue,
    @Inject(uploadQuotas) private readonly quotas: UploadQuotas,
    @Inject(clock) private readonly time: Clock,
  ) {}

  async receive(request: IncomingMessage, purposeParameter: string, correlationId: string): Promise<UploadOutcome> {
    const adapter = entryAdapterOf(request);
    if (adapter === undefined) {
      return { kind: 'unauthenticated' };
    }
    const headers: PresentedHeaders = { authorization: request.headers.authorization, cookie: request.headers.cookie };
    const authentication = await this.principals.authenticate(adapter, headers, correlationId, this.time.now());
    if (!authentication.ok) {
      return authentication.reason === 'unavailable'
        ? { kind: 'failure', error: domainError('Unavailable', 'dependencyUnavailable'), closeConnection: true }
        : { kind: 'unauthenticated' };
    }
    const purpose = uploadPurposeSchema.safeParse(purposeParameter);
    if (!purpose.success) {
      return { kind: 'invalid', issues: [{ path: ['purpose'], code: 'invalid_value' }] };
    }
    const authenticated = authentication.principal;
    const authorised = await this.transactions.run(authenticated.tenantId, async (database) => {
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
      if (!isAllowed(uploadAccess[purpose.data], principal)) {
        return null;
      }
      return { principal, usage: await this.usageOf(database, principal) };
    });
    if (authorised === null) {
      return { kind: 'failure', error: domainError('Forbidden', 'notPermitted'), closeConnection: true };
    }
    const { principal, usage } = authorised;

    const checked = this.check(request, purpose.data);
    if (!checked.ok) {
      return this.refuse(principal, purpose.data, null, checked.refusal);
    }
    const { mediaType } = checked.request;
    const declaredLength = Number(singleHeader(request.headers['content-length']) ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > uploadSizeCaps[mediaType]) {
      return this.refuse(principal, purpose.data, mediaType, 'uploadTooLarge');
    }
    if (exceedsQuota(principal, usage, this.quotas, Number.isFinite(declaredLength) ? declaredLength : 0)) {
      return this.refuse(principal, purpose.data, mediaType, 'uploadQuotaExceeded');
    }
    return this.store(request, principal, checked.request);
  }

  private check(
    request: IncomingMessage,
    purpose: UploadPurpose,
  ): { readonly ok: true; readonly request: CheckedRequest } | { readonly ok: false; readonly refusal: Refusal } {
    const attestation = uploadAttestationSchema.safeParse(singleHeader(request.headers[uploadAttestationHeader]));
    if (!attestation.success) {
      return { ok: false, refusal: 'attestationRequired' };
    }
    const mediaType = declaredMediaType(singleHeader(request.headers['content-type']));
    if (mediaType === null || !isAllowedFor(purpose, mediaType)) {
      return { ok: false, refusal: 'uploadTypeNotAllowed' };
    }
    const fileName = decodedFileName(singleHeader(request.headers[uploadFileNameHeader]));
    if (fileName === null || !extensionAgreesWith(mediaType, fileName)) {
      return { ok: false, refusal: 'uploadContentMismatch' };
    }
    return { ok: true, request: { purpose, mediaType, fileName, attestation: attestation.data } };
  }

  private async store(request: IncomingMessage, principal: Principal, checked: CheckedRequest): Promise<UploadOutcome> {
    const uploadId = randomUUID();
    const quarantine: ObjectLocation = {
      bucket: 'quarantine',
      key: objectKeyOf(principal.tenantId, checked.purpose, uploadId),
    };
    const inspector = new UploadInspector(checked.mediaType);
    const abandon = () => {
      if (!request.complete) {
        inspector.destroy(new ClientAbortedError());
      }
    };
    request.once('aborted', abandon);
    request.once('close', abandon);
    request.once('error', abandon);
    request.pipe(inspector);
    const written = await this.storage.put(quarantine, inspector, checked.mediaType);
    request.off('aborted', abandon);
    request.off('close', abandon);
    request.off('error', abandon);
    const inspected = inspector.result;
    if (!written.ok || inspected === null) {
      request.unpipe(inspector);
      // The storage leaves nothing behind a failed write; the delete makes sure of it.
      await this.storage.delete(quarantine);
      if (written.ok || written.error.kind === 'storage') {
        return { kind: 'failure', error: domainError('Unavailable', 'dependencyUnavailable'), closeConnection: true };
      }
      const cause = written.error.error;
      if (cause instanceof UploadRefusedError) {
        return this.refuse(principal, checked.purpose, checked.mediaType, cause.reason);
      }
      return { kind: 'failure', error: domainError('Invalid', 'request'), closeConnection: true };
    }

    const recorded = await this.transactions.run(principal.tenantId, async (database) => {
      await database.execute(
        sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`partledger/uploads:${principal.tenantId}`}, 0))`,
      );
      if (exceedsQuota(principal, await this.usageOf(database, principal), this.quotas, inspected.sizeBytes)) {
        await this.auditRefusal(database, principal, checked.purpose, checked.mediaType, 'uploadQuotaExceeded');
        return false;
      }
      const now = this.time.now();
      await database.execute(
        sql`insert into uploads (id, tenant_id, purpose, media_type, file_name, size_bytes, content_hash, attestation,
                                 uploader_type, uploader_id, credential_id, uploaded_at, scan_status)
            values (${uploadId}, ${principal.tenantId}, ${checked.purpose}, ${checked.mediaType}, ${checked.fileName},
                    ${inspected.sizeBytes}, ${inspected.contentHash}, ${checked.attestation},
                    ${principal.type}, ${uploaderIdOf(principal)}, ${credentialIdOf(principal)},
                    ${now.toISOString()}::timestamptz, 'pending')`,
      );
      await appendAuditEntry(
        database,
        {
          tenantId: principal.tenantId,
          actor: auditActorOf(principal),
          event: auditToken('uploads.received'),
          data: {
            uploadId: auditId(uploadId),
            purpose: auditToken(checked.purpose),
            fileType: auditToken(fileTypeTokens[checked.mediaType]),
            sizeBytes: inspected.sizeBytes,
            contentHash: auditHash(inspected.contentHash),
            attestation: auditToken(checked.attestation),
          },
        },
        this.time,
      );
      await this.jobQueue.enqueue(
        database,
        scanUploadJob,
        {
          tenantId: principal.tenantId,
          cause: 'command',
          source: 'uploads.upload',
          correlationId: principal.correlationId,
        },
        { uploadId },
      );
      return true;
    });
    if (!recorded) {
      await this.storage.delete(quarantine);
      return {
        kind: 'failure',
        error: domainError('Unprocessable', 'uploadQuotaExceeded'),
        closeConnection: false,
      };
    }
    return {
      kind: 'received',
      receipt: {
        uploadId,
        purpose: checked.purpose,
        mediaType: checked.mediaType,
        sizeBytes: inspected.sizeBytes,
        contentHash: inspected.contentHash,
        scanStatus: 'pending',
      },
    };
  }

  private async refuse(
    principal: Principal,
    purpose: UploadPurpose,
    mediaType: UploadMediaType | null,
    refusal: Refusal,
  ): Promise<UploadOutcome> {
    await this.transactions.run(principal.tenantId, (database) =>
      this.auditRefusal(database, principal, purpose, mediaType, refusal),
    );
    const error =
      refusal === 'attestationRequired'
        ? domainError('Invalid', 'attestationRequired')
        : refusal === 'uploadTooLarge'
          ? domainError('Unprocessable', 'uploadTooLarge', {
              maximumMegabytes: mediaType === null ? 0 : Math.floor(uploadSizeCaps[mediaType] / mebibyte),
            })
          : domainError('Unprocessable', refusal);
    return { kind: 'failure', error, closeConnection: true };
  }

  private async auditRefusal(
    database: AppDatabase,
    principal: Principal,
    purpose: UploadPurpose,
    mediaType: UploadMediaType | null,
    refusal: Refusal,
  ): Promise<void> {
    await appendAuditEntry(
      database,
      {
        tenantId: principal.tenantId,
        actor: auditActorOf(principal),
        event: auditToken('uploads.refused'),
        data: {
          purpose: auditToken(purpose),
          fileType: mediaType === null ? null : auditToken(fileTypeTokens[mediaType]),
          reason: auditToken(refusal),
        },
      },
      this.time,
    );
  }

  private async usageOf(database: AppDatabase, principal: Principal): Promise<Usage> {
    const since = new Date(this.time.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    const result = await database.execute(
      sql`select count(*) filter (where credential_id = ${credentialIdOf(principal)}) as link_files,
                 coalesce(sum(size_bytes) filter (where credential_id = ${credentialIdOf(principal)}), 0) as link_bytes,
                 count(*) filter (where uploaded_at > ${since}::timestamptz) as tenant_files,
                 coalesce(sum(size_bytes) filter (where uploaded_at > ${since}::timestamptz), 0) as tenant_bytes
            from uploads`,
    );
    const [usage] = usageRows.parse(result.rows);
    if (usage === undefined) {
      throw new Error('The usage query returned no row');
    }
    return {
      linkFiles: usage.link_files,
      linkBytes: usage.link_bytes,
      tenantFiles: usage.tenant_files,
      tenantBytes: usage.tenant_bytes,
    };
  }
}

function uploaderIdOf(principal: Principal): string | null {
  switch (principal.type) {
    case 'person':
      return principal.userId;
    case 'supplier_token':
      return principal.supplierId;
    default:
      return null;
  }
}

export class ClientAbortedError extends Error {
  constructor() {
    super('The client stopped sending the upload');
    this.name = 'ClientAbortedError';
  }
}
