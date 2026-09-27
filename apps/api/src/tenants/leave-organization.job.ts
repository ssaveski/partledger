import { Inject, Injectable } from '@nestjs/common';
import { refuse, success, type DomainError, type Result } from '@partledger/domain';

import { auditId, auditToken } from '../audit/audit-payload';
import { defineJob, jobField, type JobHandler, type JobItemContext, type PayloadOf } from '../jobs/job.types';
import { identityOrganizations, type IdentityOrganizations } from './identity-organizations';
import { membershipStore } from './membership-store';

/**
 * Takes a removed member out of the tenant's Keycloak organization and ends their Keycloak
 * sessions (KTD20). The removal itself has committed by then: roles revoked, membership ended,
 * API sessions ended, so the person has lost access whether Keycloak answers or not; this job
 * only tidies Keycloak, retrying until it does. A member already gone counts as done.
 */
export const leaveOrganizationJob = defineJob({
  name: 'members.leaveOrganization',
  description:
    'Removes a removed member from the tenant’s identity provider organization and ends their sessions there.',
  payload: { userId: jobField.id() },
  retryLimit: 20,
  retryDelaySeconds: 60,
  expireInSeconds: 120,
});

@Injectable()
export class LeaveOrganizationHandler implements JobHandler<typeof leaveOrganizationJob> {
  constructor(@Inject(identityOrganizations) private readonly organizations: IdentityOrganizations) {}

  items(payload: PayloadOf<typeof leaveOrganizationJob>): Promise<readonly string[]> {
    return Promise.resolve([`leave:${payload.userId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof leaveOrganizationJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const { tenantId } = context.principal;
    // Invited again meanwhile: the person belongs in the organization after all.
    if ((await membershipStore.findActive(context.database, tenantId, payload.userId)) !== undefined) {
      return success(undefined);
    }
    const organizationId = (await membershipStore.tenantOf(context.database, tenantId))?.identityOrganizationId ?? null;
    if (organizationId !== null) {
      const removed = await this.organizations.removeMember(organizationId, payload.userId);
      if (!removed.ok) {
        return refuse('Unavailable', 'dependencyUnavailable');
      }
    }
    await context.audit.record(auditToken('members.leftOrganization'), { member: auditId(payload.userId) });
    return success(undefined);
  }
}
