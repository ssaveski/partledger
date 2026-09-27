import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { domainError, failure, success, type Result } from '@partledger/domain';

import {
  watchBody,
  type ObjectLocation,
  type ObjectStorage,
  type PutFailure,
  type StorageBucket,
  type StorageNotFound,
  type StorageUnavailable,
  type StoredObject,
} from './storage.port';

const unavailable: StorageUnavailable = domainError('Unavailable', 'dependencyUnavailable');
const notFound: StorageNotFound = domainError('NotFound', 'resource');

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The object storage port's local adapter (KTD36): each bucket is a directory, each object a
 * file written whole and then renamed, so a failed write leaves nothing behind. For
 * development only; production refuses it.
 */
export class LocalObjectStorage implements ObjectStorage {
  constructor(
    private readonly directory: string,
    private readonly buckets: Readonly<Record<StorageBucket, string>>,
  ) {}

  async put(location: ObjectLocation, body: Readable): Promise<Result<void, PutFailure>> {
    const failureOf = watchBody(body);
    const path = this.pathOf(location);
    const partial = `${path}.${randomUUID()}.partial`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await pipeline(body, createWriteStream(partial, { mode: 0o600 }));
      await rename(partial, path);
      return success(undefined);
    } catch {
      await unlink(partial).catch(() => undefined);
      return failure(failureOf());
    }
  }

  async get(location: ObjectLocation): Promise<Result<StoredObject, StorageNotFound | StorageUnavailable>> {
    const path = this.pathOf(location);
    try {
      const { size } = await stat(path);
      return success({ body: createReadStream(path), sizeBytes: size });
    } catch (error) {
      return failure(isMissing(error) ? notFound : unavailable);
    }
  }

  async copy(from: ObjectLocation, to: ObjectLocation): Promise<Result<void, StorageNotFound | StorageUnavailable>> {
    const target = this.pathOf(to);
    const partial = `${target}.${randomUUID()}.partial`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(this.pathOf(from), partial);
      await rename(partial, target);
      return success(undefined);
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      return failure(isMissing(error) ? notFound : unavailable);
    }
  }

  async delete(location: ObjectLocation): Promise<Result<void, StorageUnavailable>> {
    try {
      await unlink(this.pathOf(location));
      return success(undefined);
    } catch (error) {
      return isMissing(error) ? success(undefined) : failure(unavailable);
    }
  }

  private pathOf(location: ObjectLocation): string {
    return join(this.directory, this.buckets[location.bucket], ...location.key.split('/'));
  }
}
