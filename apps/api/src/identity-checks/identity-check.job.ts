import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { supplierStore } from '../suppliers/supplier-store';
import { identityRegisters as identityRegistersPort, type IdentityRegisters } from './identity-registers';
import {
  applicableRegisters,
  identityRegisters,
  resultOf,
  type IdentityCheckResult,
  type RegisterAnswer,
} from './identity-standing';

/**
 * A register that does not answer is asked again on each of this many attempts; the last one
 * records "not checked". The job's retry limit leaves room above it, so the last attempt always
 * runs under pg-boss.
 */
export const maximumCheckAttempts = 3;

/**
 * Checks a supplier against one register (R10): VIES for an EU VAT id, GLEIF for an LEI. One
 * job per register, so each has its own retries and one register's outage never delays the
 * other's answer. The check is informational and never blocks the supplier.
 */
export const identityCheckJob = defineJob({
  name: 'identityChecks.run',
  description: 'Checks a supplier against the EU VAT register or the LEI register.',
  payload: { supplierId: jobField.id(), register: jobField.oneOf(identityRegisters) },
  retryLimit: maximumCheckAttempts + 2,
  retryDelaySeconds: 60,
  expireInSeconds: 300,
});

export type CheckOutcome =
  | { readonly kind: 'retry' }
  | { readonly kind: 'keepPrevious' }
  | { readonly kind: 'record'; readonly result: IdentityCheckResult };

/**
 * What one attempt does with a register's answer. An unreachable register is asked again until
 * the last attempt, which records "not checked" unless an earlier check of the same identifier
 * exists: an outage never hides a result the register gave before.
 */
export function checkOutcome(
  answer: RegisterAnswer,
  attempt: number,
  checkedBefore: boolean,
  supplierName: string,
): CheckOutcome {
  if (answer.kind !== 'unreachable') {
    return { kind: 'record', result: resultOf(answer, supplierName) };
  }
  if (attempt < maximumCheckAttempts) {
    return { kind: 'retry' };
  }
  return checkedBefore ? { kind: 'keepPrevious' } : { kind: 'record', result: 'notChecked' };
}

@Injectable()
export class IdentityCheckHandler implements JobHandler<typeof identityCheckJob> {
  private readonly logger = new Logger('IdentityChecks');

  constructor(@Inject(identityRegistersPort) private readonly registers: IdentityRegisters) {}

  async items(payload: PayloadOf<typeof identityCheckJob>, context: JobContext): Promise<readonly string[]> {
    const supplier = await supplierStore.find(context.database, context.principal.tenantId, payload.supplierId);
    const applies =
      supplier !== undefined && applicableRegisters(supplier).some((entry) => entry.register === payload.register);
    return applies ? [`${payload.register}:${context.jobId}`] : [];
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof identityCheckJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const { tenantId } = context.principal;
    const supplier = await supplierStore.find(context.database, tenantId, payload.supplierId);
    const applicable =
      supplier === undefined
        ? undefined
        : applicableRegisters(supplier).find((entry) => entry.register === payload.register);
    // The supplier's identifiers changed since the job was queued; the change queued its own check.
    if (supplier === undefined || applicable === undefined) {
      return success(undefined);
    }
    const check = {
      tenantId,
      supplierId: supplier.id,
      register: applicable.register,
      identifier: applicable.identifier,
    };
    const answer = await this.registers.ask(applicable.register, applicable.identifier);
    const outcome = checkOutcome(
      answer,
      context.attempt,
      await supplierStore.hasIdentityCheck(context.database, check),
      supplier.name,
    );
    if (outcome.kind === 'retry') {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    if (outcome.kind === 'keepPrevious') {
      this.logger.warn(`The ${applicable.register} register did not answer; the previous check stands`);
      await context.audit.record(auditToken('suppliers.identityCheckUnanswered'), {
        supplier: auditId(supplier.id),
        register: auditToken(applicable.register),
      });
      return success(undefined);
    }
    await supplierStore.recordIdentityCheck(context.database, {
      ...check,
      result: outcome.result,
      checkedAt: context.now,
    });
    await context.audit.record(auditToken('suppliers.identityChecked'), {
      supplier: auditId(supplier.id),
      register: auditToken(applicable.register),
      result: auditToken(outcome.result),
    });
    return success(undefined);
  }
}
