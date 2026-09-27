import type { Readable } from 'node:stream';

import type { UploadPurpose } from '@partledger/contracts';
import type { DomainErrorOf, Result } from '@partledger/domain';

/**
 * The object storage port (KTD36): the S3-compatible adapter for the region's object storage,
 * and a local adapter for development. Callers name buckets by role, never by their configured
 * names, and every key is built by `objectKeyOf`, so no file name ever reaches storage.
 */

/** quarantine: uploads waiting for their scan; evidence and imports: clean files by purpose (KTD22). */
export const storageBuckets = ['quarantine', 'evidence', 'imports'] as const;

export type StorageBucket = (typeof storageBuckets)[number];

export interface ObjectLocation {
  readonly bucket: StorageBucket;
  readonly key: string;
}

export type StorageUnavailable = DomainErrorOf<{
  readonly tag: 'Unavailable';
  readonly reason: 'dependencyUnavailable';
}>;

export type StorageNotFound = DomainErrorOf<{ readonly tag: 'NotFound'; readonly reason: 'resource' }>;

/**
 * Why a write stopped: the storage failed, or the body stream did. A body that fails, such as
 * an upload refused mid-stream, carries its own error back to the caller untouched.
 */
export type PutFailure = { readonly kind: 'storage' } | { readonly kind: 'body'; readonly error: unknown };

/**
 * Watches a body stream an adapter is about to consume, so a failed write can tell whether the
 * body or the storage failed first.
 */
export function watchBody(body: Readable): () => PutFailure {
  const seen: { failed: boolean; error: unknown } = { failed: false, error: undefined };
  body.once('error', (error) => {
    seen.failed = true;
    seen.error = error;
  });
  return () => (seen.failed ? { kind: 'body', error: seen.error } : { kind: 'storage' });
}

export interface StoredObject {
  readonly body: Readable;
  readonly sizeBytes: number;
}

export interface ObjectStorage {
  /**
   * Streams `body` to the location. A write that fails, whichever side fails, leaves no object
   * behind: a partial object is never visible, and a multipart upload is aborted.
   */
  put(location: ObjectLocation, body: Readable, contentType: string): Promise<Result<void, PutFailure>>;
  get(location: ObjectLocation): Promise<Result<StoredObject, StorageNotFound | StorageUnavailable>>;
  copy(from: ObjectLocation, to: ObjectLocation): Promise<Result<void, StorageNotFound | StorageUnavailable>>;
  /** Deleting an object that does not exist succeeds. */
  delete(location: ObjectLocation): Promise<Result<void, StorageUnavailable>>;
}

export const objectStorage = Symbol('ObjectStorage');

/** Where clean files of each purpose live. */
export function destinationBucketOf(purpose: UploadPurpose): Exclude<StorageBucket, 'quarantine'> {
  return purpose === 'evidence' ? 'evidence' : 'imports';
}

/**
 * `t/{tenant}/evidence/{uuid}` or `t/{tenant}/imports/{uuid}` (KTD22): the same key in the
 * quarantine bucket and in the destination, with no file name. Tenant ids and upload ids are
 * uuids, which the caller has already parsed.
 */
export function objectKeyOf(tenantId: string, purpose: UploadPurpose, uploadId: string): string {
  return `t/${tenantId}/${purpose === 'evidence' ? 'evidence' : 'imports'}/${uploadId}`;
}
