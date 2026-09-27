import { Readable } from 'node:stream';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { domainError, failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

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

export interface S3Settings {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** The configured bucket name of each role. */
  readonly buckets: Readonly<Record<StorageBucket, string>>;
}

/** S3 multipart uploads need parts of at least 5 MiB; one part is buffered at a time. */
const partSizeBytes = 5 * 1024 * 1024;

const serviceError = z.object({
  name: z.string(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

function isNotFound(error: unknown): boolean {
  const parsed = serviceError.safeParse(error);
  return (
    parsed.success &&
    (parsed.data.name === 'NoSuchKey' ||
      parsed.data.name === 'NotFound' ||
      parsed.data.$metadata?.httpStatusCode === 404)
  );
}

const unavailable: StorageUnavailable = domainError('Unavailable', 'dependencyUnavailable');
const notFound: StorageNotFound = domainError('NotFound', 'resource');

/**
 * The object storage port on any S3-compatible service (KTD36): OVHcloud Object Storage in
 * production, a local S3-compatible container in tests. Checksums are sent only where the
 * service requires them, since S3-compatible services differ in which they accept.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings) {
    const config: S3ClientConfig = {
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
    };
    this.client = new S3Client(config);
  }

  async put(location: ObjectLocation, body: Readable, contentType: string): Promise<Result<void, PutFailure>> {
    const failureOf = watchBody(body);
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucketName(location), Key: location.key, Body: body, ContentType: contentType },
      partSize: partSizeBytes,
      queueSize: 1,
      leavePartsOnError: false,
    });
    try {
      await upload.done();
      return success(undefined);
    } catch {
      return failure(failureOf());
    }
  }

  async get(location: ObjectLocation): Promise<Result<StoredObject, StorageNotFound | StorageUnavailable>> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName(location), Key: location.key }),
      );
      const body = response.Body;
      if (!(body instanceof Readable) || response.ContentLength === undefined) {
        return failure(unavailable);
      }
      return success({ body, sizeBytes: response.ContentLength });
    } catch (error) {
      return failure(isNotFound(error) ? notFound : unavailable);
    }
  }

  async copy(from: ObjectLocation, to: ObjectLocation): Promise<Result<void, StorageNotFound | StorageUnavailable>> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName(to),
          Key: to.key,
          CopySource: `${this.bucketName(from)}/${from.key}`,
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(isNotFound(error) ? notFound : unavailable);
    }
  }

  async delete(location: ObjectLocation): Promise<Result<void, StorageUnavailable>> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(location), Key: location.key }));
      return success(undefined);
    } catch (error) {
      return isNotFound(error) ? success(undefined) : failure(unavailable);
    }
  }

  private bucketName(location: ObjectLocation): string {
    return this.settings.buckets[location.bucket];
  }
}
