import { Inject, Injectable } from '@nestjs/common';
import { uploadPurposeSchema } from '@partledger/contracts';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineJob, jobField, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { objectKeyOf, objectStorage, type ObjectStorage } from '../storage/storage.port';

export const releaseQuarantineJob = defineJob({
  name: 'uploads.releaseQuarantine',
  description: "Removes a clean upload's quarantine copy once its copy in the destination bucket is recorded.",
  payload: { uploadId: jobField.id() },
  retryLimit: 10,
  retryDelaySeconds: 60,
  expireInSeconds: 300,
});

const cleanRows = z.array(z.object({ purpose: uploadPurposeSchema }));

/**
 * Enqueued in the transaction that marks an upload clean, so the quarantine copy goes only
 * after the clean copy is on record; a flagged upload is never released.
 */
@Injectable()
export class ReleaseQuarantineHandler implements JobHandler<typeof releaseQuarantineJob> {
  constructor(@Inject(objectStorage) private readonly storage: ObjectStorage) {}

  items(payload: PayloadOf<typeof releaseQuarantineJob>): Promise<readonly string[]> {
    return Promise.resolve([`release:${payload.uploadId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof releaseQuarantineJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const [clean] = cleanRows.parse(
      (
        await context.database.execute(
          sql`select purpose from uploads where id = ${payload.uploadId} and scan_status = 'clean'`,
        )
      ).rows,
    );
    if (clean === undefined) {
      return success(undefined);
    }
    const removed = await this.storage.delete({
      bucket: 'quarantine',
      key: objectKeyOf(context.principal.tenantId, clean.purpose, payload.uploadId),
    });
    return removed.ok ? success(undefined) : refuse('Unavailable', 'dependencyUnavailable');
  }
}
