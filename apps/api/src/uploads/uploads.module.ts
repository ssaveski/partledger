import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { PrincipalResolver } from '../principals/principal-resolver';
import { roleDirectory, type RoleDirectory } from '../principals/role-directory';
import { LocalObjectStorage } from '../storage/local-storage.adapter';
import { S3ObjectStorage } from '../storage/s3.adapter';
import { objectStorage, type ObjectStorage, type StorageBucket } from '../storage/storage.port';
import { clock, type Clock } from '../time/clock';
import { ClamdScanner } from './clamd.adapter';
import { DownloadController } from './download.controller';
import { LocalMalwareScanner, malwareScanner, type MalwareScanner } from './malware-scanner.port';
import { UploadController } from './upload.controller';
import { UploadDownloads } from './upload-downloads';
import { UploadPipeline } from './upload-pipeline';
import { UploadScanning } from './upload-scanning';
import { uploadQuotas, uploadQuotasFrom } from './upload-settings';

export interface UploadsOptions {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly roleDirectory: RoleDirectory;
}

export class MissingAdapterSettingError extends Error {
  constructor(setting: string) {
    super(`${setting} is required by the configured adapter`);
    this.name = 'MissingAdapterSettingError';
  }
}

function required<Value>(value: Value | undefined, setting: string): Value {
  if (value === undefined) {
    throw new MissingAdapterSettingError(setting);
  }
  return value;
}

/** The configuration refuses a local adapter in production and a missing setting for the one named. */
export function objectStorageFor(config: AppConfig): ObjectStorage {
  const buckets: Readonly<Record<StorageBucket, string>> = {
    quarantine: config.STORAGE_QUARANTINE_BUCKET,
    evidence: config.STORAGE_EVIDENCE_BUCKET,
    imports: config.STORAGE_IMPORTS_BUCKET,
  };
  if (config.STORAGE_ADAPTER !== 's3') {
    return new LocalObjectStorage(config.STORAGE_LOCAL_DIRECTORY, buckets);
  }
  return new S3ObjectStorage({
    endpoint: required(config.S3_ENDPOINT, 'S3_ENDPOINT'),
    region: config.S3_REGION,
    accessKeyId: required(config.S3_ACCESS_KEY_ID, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(config.S3_SECRET_ACCESS_KEY, 'S3_SECRET_ACCESS_KEY'),
    forcePathStyle: config.S3_FORCE_PATH_STYLE === 'on',
    buckets,
  });
}

export function malwareScannerFor(config: AppConfig): MalwareScanner {
  if (config.MALWARE_SCANNER !== 'clamd') {
    return new LocalMalwareScanner();
  }
  return new ClamdScanner({
    host: required(config.CLAMD_HOST, 'CLAMD_HOST'),
    port: config.CLAMD_PORT,
    timeoutMilliseconds: config.CLAMD_TIMEOUT_SECONDS * 1000,
  });
}

/**
 * The upload pipeline, the audited downloads, and the storage and scanner ports that the
 * scan jobs share (U14, KTD22, KTD36). Global, like the notifications module, because the job
 * runner's module constructs the scan handlers.
 */
@Module({})
export class UploadsModule {
  static register(options: UploadsOptions): DynamicModule {
    return {
      module: UploadsModule,
      global: true,
      controllers: [UploadController, DownloadController],
      providers: [
        { provide: objectStorage, useValue: objectStorageFor(options.config) },
        { provide: malwareScanner, useValue: malwareScannerFor(options.config) },
        { provide: uploadQuotas, useValue: uploadQuotasFrom(options.config) },
        { provide: roleDirectory, useValue: options.roleDirectory },
        { provide: clock, useValue: options.clock },
        PrincipalResolver,
        UploadPipeline,
        UploadDownloads,
        UploadScanning,
      ],
      exports: [objectStorage, malwareScanner, UploadScanning],
    };
  }
}
