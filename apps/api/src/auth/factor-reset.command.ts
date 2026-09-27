import { Inject, Injectable } from '@nestjs/common';
import { resetSecondFactor, type InputOf } from '@partledger/contracts';
import { refuse, success } from '@partledger/domain';

import { auditId } from '../audit/audit-payload';
import type { CommandContext, CommandHandler, HandlerResult } from '../commands/handlers';
import { resetSecondFactorJob } from './factor-reset.job';
import { identityAdministration, type IdentityAdministration } from './identity-administration';
import { sessionStore } from './session.store';

/**
 * Resets a staff user's lost second factor (KTD20): the only way one is removed, since the
 * realm's forgot-password flow never touches it. A tenant admin with a fresh step-up may reset
 * the factor of another member of their own tenant who belongs to no other tenant. The user's staff sessions end in this
 * transaction, and `auth.resetSecondFactor` (a job enqueued in it, KTD16) removes the factor
 * and ends the Keycloak sessions once the command has committed, retrying while Keycloak is
 * unreachable. The command's audit entry names the admin as its actor and carries only ids
 * and counts; the job's entry records what it removed.
 */
@Injectable()
export class ResetSecondFactorHandler implements CommandHandler<typeof resetSecondFactor> {
  constructor(@Inject(identityAdministration) private readonly administration: IdentityAdministration) {}

  async execute(
    input: InputOf<typeof resetSecondFactor>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof resetSecondFactor>> {
    const { principal } = context;
    // Resetting one's own factor would let a hijacked, stepped-up session replace it.
    if (principal.type === 'person' && principal.userId === input.userId) {
      return refuse('Forbidden', 'notPermitted');
    }
    const tenants = await this.administration.tenantsOf(input.userId);
    if (!tenants.ok) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    if (!tenants.value.includes(principal.tenantId)) {
      return refuse('NotFound', 'resource', { resource: 'user' });
    }
    // This transaction can end the user's staff sessions in this tenant only; a user who also
    // belongs to another tenant would keep their sessions there, so one admin may not reset them.
    if (new Set(tenants.value).size > 1) {
      return refuse('Forbidden', 'notPermitted', { resource: 'user' });
    }
    const endedSessions = await sessionStore.endAllOf(
      context.database,
      { tenantId: principal.tenantId, subjectId: input.userId },
      'second_factor_reset',
      context.now,
    );
    const jobId = await context.jobs.enqueue(resetSecondFactorJob, { userId: input.userId });
    context.audit.record({
      kind: 'secondFactorReset',
      userId: auditId(input.userId),
      endedSessions,
      jobId: auditId(jobId),
    });
    return success({ userId: input.userId, endedSessions });
  }
}
