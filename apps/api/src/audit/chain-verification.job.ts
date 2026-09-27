import { Injectable } from '@nestjs/common';
import { success, type DomainError, type Result } from '@partledger/domain';

import { raiseOperationalAlert } from '../alerts/operational-alerts';
import { defineJob, type JobContext, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { auditToken } from './audit-payload';
import { verifyTenantChain } from './chain-verifier';

/** Verifies one tenant's chain (R27); scheduled nightly for every tenant in `jobs/schedules/audit.ts`. */
export const verifyChainJob = defineJob({
  name: 'audit.verifyChain',
  description: "Verifies the tenant's audit chain and raises an alert naming the first failing entry.",
  payload: {},
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 3600,
});

@Injectable()
export class VerifyChainHandler implements JobHandler<typeof verifyChainJob> {
  items(_payload: PayloadOf<typeof verifyChainJob>, context: JobContext): Promise<readonly string[]> {
    return Promise.resolve([`verification:${context.jobId}`]);
  }

  async apply(
    item: string,
    _payload: PayloadOf<typeof verifyChainJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const { tenantId } = context.principal;
    const verification = await verifyTenantChain(context.database, tenantId);
    if (verification.ok) {
      await context.audit.record(auditToken('audit.chainVerified'), { length: verification.length });
      return success(undefined);
    }
    await raiseOperationalAlert(context.database, {
      tenantId,
      kind: 'chainVerificationFailed',
      key: item,
      params: { firstFailingSeq: verification.seq, reason: verification.reason },
      raisedByJobId: context.jobId,
      now: context.now,
    });
    await context.audit.record(auditToken('audit.chainVerificationFailed'), {
      firstFailingSeq: verification.seq,
      reason: auditToken(verification.reason),
    });
    return success(undefined);
  }
}
