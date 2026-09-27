import { Inject, Injectable } from '@nestjs/common';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { raiseOperationalAlert } from '../alerts/operational-alerts';
import {
  defineJob,
  jobField,
  type JobContext,
  type JobHandler,
  type JobItemContext,
  type JobPreparationContext,
  type PayloadOf,
} from '../jobs/job.types';
import { UploadScanning, type ScanAttempt, type ScanPreparation } from './upload-scanning';

/**
 * How many times the scan job itself tries before it leaves the upload to the sweep. The
 * retries come quickly for a short outage; the sweep keeps trying for as long as it lasts.
 */
export const scanAttemptsBeforeSweep = 3;

export const scanUploadJob = defineJob({
  name: 'uploads.scan',
  description: 'Scans one quarantined upload and releases it to its bucket when it is clean.',
  payload: { uploadId: jobField.id() },
  retryLimit: scanAttemptsBeforeSweep + 1,
  retryDelaySeconds: 20,
  expireInSeconds: 300,
});

export const rescanPendingUploadsJob = defineJob({
  name: 'uploads.rescanPending',
  description: 'Scans uploads still pending after their own scan job gave up, such as while the scanner was down.',
  payload: {},
  retryLimit: 1,
  retryDelaySeconds: 60,
  expireInSeconds: 1_800,
});

/** An upload is swept once it has been pending this long, so the sweep does not race a fresh scan job. */
export const sweepAfterMilliseconds = 5 * 60 * 1000;

const sweepBatch = 200;

/**
 * Raises one `scannerUnavailable` alert per tenant and day (KTD41) while the scanner stays
 * down, in the item's transaction, which then commits with the upload still pending.
 */
async function alertScannerUnavailable(context: JobItemContext<ScanPreparation>): Promise<void> {
  await raiseOperationalAlert(context.database, {
    tenantId: context.principal.tenantId,
    kind: 'scannerUnavailable',
    key: `scanner:${context.now.toISOString().slice(0, 10)}`,
    params: {},
    raisedByJobId: context.jobId,
    now: context.now,
  });
}

function stillPending(attempt: ScanAttempt): boolean {
  return attempt === 'scannerUnavailable' || attempt === 'storageUnavailable';
}

/**
 * Scans the upload a command recorded (KTD22). While the scanner or the store is unavailable
 * the item fails, so pg-boss retries it; after `scanAttemptsBeforeSweep` attempts it succeeds
 * with the upload still pending, raising the scanner alert, and the sweep takes over.
 */
@Injectable()
export class ScanUploadHandler implements JobHandler<typeof scanUploadJob, ScanPreparation> {
  constructor(@Inject(UploadScanning) private readonly scanning: UploadScanning) {}

  items(payload: PayloadOf<typeof scanUploadJob>): Promise<readonly string[]> {
    return Promise.resolve([`scan:${payload.uploadId}`]);
  }

  prepare(
    _item: string,
    payload: PayloadOf<typeof scanUploadJob>,
    context: JobPreparationContext,
  ): Promise<ScanPreparation> {
    return this.scanning.prepare(payload.uploadId, context);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof scanUploadJob>,
    context: JobItemContext<ScanPreparation>,
  ): Promise<Result<void, DomainError>> {
    const attempt = await this.scanning.record(payload.uploadId, context.prepared, context);
    if (!stillPending(attempt)) {
      return success(undefined);
    }
    if (context.attempt < scanAttemptsBeforeSweep) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    if (attempt === 'scannerUnavailable') {
      await alertScannerUnavailable(context);
    }
    return success(undefined);
  }
}

const pendingRows = z.array(z.object({ id: z.uuid() }));
const sweepItemPattern = /^rescan:([0-9a-f-]{36}):/;

function uploadOfItem(item: string): string {
  return z.uuid().parse(sweepItemPattern.exec(item)?.[1]);
}

/**
 * Every ten minutes, per tenant: each upload pending for longer than `sweepAfterMilliseconds`
 * is scanned again. Item keys carry the sweep's job id, so every sweep tries each upload anew.
 */
@Injectable()
export class RescanPendingUploadsHandler implements JobHandler<typeof rescanPendingUploadsJob, ScanPreparation> {
  constructor(@Inject(UploadScanning) private readonly scanning: UploadScanning) {}

  async items(_payload: PayloadOf<typeof rescanPendingUploadsJob>, context: JobContext): Promise<readonly string[]> {
    const before = new Date(context.now.getTime() - sweepAfterMilliseconds).toISOString();
    const result = await context.database.execute(
      sql`select id from uploads
           where scan_status = 'pending' and uploaded_at < ${before}::timestamptz
           order by uploaded_at, id limit ${sweepBatch}`,
    );
    return pendingRows.parse(result.rows).map((row) => `rescan:${row.id}:${context.jobId}`);
  }

  prepare(
    item: string,
    _payload: PayloadOf<typeof rescanPendingUploadsJob>,
    context: JobPreparationContext,
  ): Promise<ScanPreparation> {
    return this.scanning.prepare(uploadOfItem(item), context);
  }

  async apply(
    item: string,
    _payload: PayloadOf<typeof rescanPendingUploadsJob>,
    context: JobItemContext<ScanPreparation>,
  ): Promise<Result<void, DomainError>> {
    const attempt = await this.scanning.record(uploadOfItem(item), context.prepared, context);
    if (attempt === 'scannerUnavailable') {
      await alertScannerUnavailable(context);
    }
    return success(undefined);
  }
}
