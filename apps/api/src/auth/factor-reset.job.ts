import { Inject, Injectable } from '@nestjs/common';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';

import { auditId, auditToken } from '../audit/audit-payload';
import {
  defineJob,
  jobField,
  type JobContext,
  type JobHandler,
  type JobItemContext,
  type PayloadOf,
} from '../jobs/job.types';
import { identityAdministration, type IdentityAdministration } from './identity-administration';

/**
 * The Keycloak half of a second-factor reset (KTD20, KTD16). `auth.resetSecondFactor` ends the
 * user's API sessions and enqueues this job in its own transaction, so the change in Keycloak
 * happens only if the command committed, and happens even if Keycloak is briefly unreachable:
 * the job retries until it removes the user's one-time-code credentials and ends their
 * Keycloak sessions. Removing a factor twice is harmless, so a redelivered job is safe.
 */
export const resetSecondFactorJob = defineJob({
  name: 'auth.resetSecondFactor',
  description: "Removes a staff user's one-time-code credentials and ends their Keycloak sessions.",
  payload: { userId: jobField.id() },
  retryLimit: 10,
  retryDelaySeconds: 30,
});

@Injectable()
export class ResetSecondFactorJobHandler implements JobHandler<typeof resetSecondFactorJob> {
  constructor(@Inject(identityAdministration) private readonly administration: IdentityAdministration) {}

  items(_payload: PayloadOf<typeof resetSecondFactorJob>, context: JobContext): Promise<readonly string[]> {
    return Promise.resolve([`secondFactorReset:${context.jobId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof resetSecondFactorJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const reset = await this.administration.resetSecondFactor(payload.userId);
    if (!reset.ok) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    await context.audit.record(auditToken('auth.secondFactorRemoved'), {
      userId: auditId(payload.userId),
      removedFactors: reset.value.removedFactors,
    });
    return success(undefined);
  }
}
