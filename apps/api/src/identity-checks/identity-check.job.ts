import { Inject, Injectable, Logger } from '@nestjs/common';
import { success, type DomainError, type Result } from '@partledger/domain';

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
import { applicableRegisters, identityRegisters, resultOf, type IdentityRegister } from './identity-standing';

/**
 * Checks a supplier against each register that applies to it (R10): VIES for an EU VAT id,
 * GLEIF for an LEI. Each register is one item, so a redelivered job asks each at most once.
 * A register that times out or fails is recorded as `notChecked` and the item still succeeds:
 * the check is informational and never blocks the supplier, and a later check can try again.
 */
export const identityCheckJob = defineJob({
  name: 'identityChecks.run',
  description: 'Checks a supplier against the EU VAT register and the LEI register, where they apply.',
  payload: { supplierId: jobField.id() },
  retryLimit: 3,
  retryDelaySeconds: 60,
  expireInSeconds: 300,
});

const itemPattern = new RegExp(`^(${identityRegisters.join('|')}):[0-9a-f-]{36}$`);

function registerOf(item: string): IdentityRegister | undefined {
  const register = itemPattern.exec(item)?.[1];
  return identityRegisters.find((candidate) => candidate === register);
}

@Injectable()
export class IdentityCheckHandler implements JobHandler<typeof identityCheckJob> {
  private readonly logger = new Logger('IdentityChecks');

  constructor(@Inject(identityRegistersPort) private readonly registers: IdentityRegisters) {}

  async items(payload: PayloadOf<typeof identityCheckJob>, context: JobContext): Promise<readonly string[]> {
    const supplier = await supplierStore.find(context.database, context.principal.tenantId, payload.supplierId);
    return supplier === undefined
      ? []
      : applicableRegisters(supplier).map(({ register }) => `${register}:${context.jobId}`);
  }

  async apply(
    item: string,
    payload: PayloadOf<typeof identityCheckJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const { tenantId } = context.principal;
    const supplier = await supplierStore.find(context.database, tenantId, payload.supplierId);
    const register = registerOf(item);
    const applicable =
      supplier === undefined ? undefined : applicableRegisters(supplier).find((entry) => entry.register === register);
    // The supplier's identifiers changed since the job was queued; the change queued its own check.
    if (supplier === undefined || applicable === undefined) {
      return success(undefined);
    }
    const answer = await this.registers.ask(applicable.register, applicable.identifier);
    if (answer.kind === 'unreachable') {
      this.logger.warn(`The ${applicable.register} register could not be reached; recorded as not checked`);
    }
    const result = resultOf(answer, supplier.name);
    await supplierStore.recordIdentityCheck(context.database, {
      tenantId,
      supplierId: supplier.id,
      register: applicable.register,
      identifier: applicable.identifier,
      result,
      checkedAt: context.now,
    });
    await context.audit.record(auditToken('suppliers.identityChecked'), {
      supplier: auditId(supplier.id),
      register: auditToken(applicable.register),
      result: auditToken(result),
    });
    return success(undefined);
  }
}
