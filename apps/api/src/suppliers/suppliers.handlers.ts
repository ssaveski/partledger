import { Injectable } from '@nestjs/common';
import {
  addContactCommand,
  checkIdentityCommand,
  createSupplierCommand,
  erpOwnedSupplierFields,
  removeContactCommand,
  setApprovalCommand,
  setSupplierStatusCommand,
  supplierDetailQuery,
  supplierListQuery,
  updateSupplierCommand,
  type InputOf,
  type SupplierChanges,
} from '@partledger/contracts';
import { failure, refuse, success, versionConflict } from '@partledger/domain';

import {
  auditId,
  auditToken,
  checkedAuditObject,
  type CheckedAuditObject,
  type Commitment,
} from '../audit/audit-payload';
import type { CommandAudit } from '../audit/command-audit';
import type {
  CommandContext,
  CommandHandler,
  HandlerResult,
  OperationContext,
  QueryHandler,
} from '../commands/handlers';
import type { CommandJobs } from '../jobs/enqueue';
import { identityCheckJob } from '../identity-checks/identity-check.job';
import {
  applicableRegisters,
  identitySummary,
  latestChecks,
  type IdentityRegister,
} from '../identity-checks/identity-standing';
import { approvalRead, calendarDateOf, notOnTheList } from './approval-standing';
import { supplierStore, type StoredSupplier, type SupplierFields } from './supplier-store';

/**
 * Suppliers, their contacts and the approved-supplier list (U10, R9, R10). Every change runs in
 * the caller's tenant transaction and lands in that command's audit entry; names, codes,
 * identifiers and addresses enter the chain only as commitments.
 */

/** The ERP-owned fields a change would alter on an `erp` supplier; unchanged values pass. */
export function erpOwnedSupplierFieldsChanged(supplier: StoredSupplier, changes: SupplierChanges): string[] {
  if (supplier.source !== 'erp') {
    return [];
  }
  return erpOwnedSupplierFields.filter((field) => changes[field] !== undefined && changes[field] !== supplier[field]);
}

/** The given fields as commitments, with a cleared identifier as null. */
async function recordFields(audit: CommandAudit, fields: Partial<SupplierFields>): Promise<CheckedAuditObject> {
  const recorded: Record<string, Commitment | null> = {};
  for (const field of ['code', 'name', 'country', 'vatId', 'lei'] as const) {
    const value = fields[field];
    if (value !== undefined) {
      recorded[field] = value === null ? null : await audit.commit(value);
    }
  }
  return checkedAuditObject(recorded);
}

/** However often a check is asked for, a register is asked about a supplier at most once per slot. */
const identityCheckSlotSeconds = 300;

/**
 * Queues a check against each register that applies; returns those registers. After a change
 * (`nextSlot`), a check already queued in this slot is followed by one in the next, so the
 * changed details are checked too; a plain request joins the check already queued.
 */
async function queueIdentityChecks(
  jobs: CommandJobs,
  supplier: { readonly id: string } & Pick<SupplierFields, 'vatId' | 'lei'>,
  after: 'change' | 'request',
): Promise<IdentityRegister[]> {
  const registers = applicableRegisters(supplier).map((entry) => entry.register);
  for (const register of registers) {
    await jobs.enqueue(
      identityCheckJob,
      { supplierId: supplier.id, register },
      {
        singletonKey: `identity:${supplier.id}:${register}`,
        singletonSeconds: identityCheckSlotSeconds,
        singletonNextSlot: after === 'change',
      },
    );
  }
  return registers;
}

@Injectable()
export class CreateSupplierHandler implements CommandHandler<typeof createSupplierCommand> {
  async execute(
    input: InputOf<typeof createSupplierCommand>,
    { principal, database, now, audit, jobs }: CommandContext,
  ): Promise<HandlerResult<typeof createSupplierCommand>> {
    const created = await supplierStore.insert(database, { ...input, tenantId: principal.tenantId, now });
    if (created === undefined) {
      return refuse('Conflict', 'alreadyExists');
    }
    const registers = await queueIdentityChecks(jobs, { id: created.id, ...input }, 'change');
    audit.record({
      supplier: auditId(created.id),
      source: auditToken('platform'),
      identityChecks: registers.map((register) => auditToken(register)),
      fields: await recordFields(audit, input),
    });
    return success({ supplierId: created.id, version: created.version });
  }
}

@Injectable()
export class UpdateSupplierHandler implements CommandHandler<typeof updateSupplierCommand> {
  async execute(
    input: InputOf<typeof updateSupplierCommand>,
    { principal, database, now, audit, jobs }: CommandContext,
  ): Promise<HandlerResult<typeof updateSupplierCommand>> {
    const { tenantId } = principal;
    const supplier = await supplierStore.find(database, tenantId, input.supplierId);
    if (supplier === undefined) {
      return refuse('NotFound', 'resource');
    }
    const stale = versionConflict(input.expectedVersion, supplier.version);
    if (stale !== null) {
      return failure(stale);
    }
    const [erpOwned] = erpOwnedSupplierFieldsChanged(supplier, input.changes);
    if (erpOwned !== undefined) {
      return refuse('Unprocessable', 'sourceOwned', { field: erpOwned });
    }
    const { code } = input.changes;
    if (code !== undefined && code !== supplier.code && (await supplierStore.codeInUse(database, tenantId, code))) {
      return refuse('Conflict', 'alreadyExists');
    }
    const change = await supplierStore.update(database, {
      tenantId,
      supplierId: supplier.id,
      expectedVersion: input.expectedVersion,
      now,
      set: input.changes,
    });
    if (change.kind === 'duplicate') {
      return refuse('Conflict', 'alreadyExists');
    }
    if (change.kind === 'stale') {
      return refuse('Conflict', 'versionMismatch');
    }
    const { version } = change;
    const updated = { ...supplier, ...input.changes };
    // A register's answer depends on the identifier and on the name it is compared with.
    const identityChanged =
      updated.vatId !== supplier.vatId || updated.lei !== supplier.lei || updated.name !== supplier.name;
    const registers = identityChanged ? await queueIdentityChecks(jobs, updated, 'change') : [];
    audit.record({
      supplier: auditId(supplier.id),
      version,
      identityChecks: registers.map((register) => auditToken(register)),
      fields: await recordFields(audit, input.changes),
    });
    return success({ supplierId: supplier.id, version });
  }
}

@Injectable()
export class SetSupplierStatusHandler implements CommandHandler<typeof setSupplierStatusCommand> {
  async execute(
    input: InputOf<typeof setSupplierStatusCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof setSupplierStatusCommand>> {
    const { tenantId } = principal;
    const supplier = await supplierStore.find(database, tenantId, input.supplierId);
    if (supplier === undefined) {
      return refuse('NotFound', 'resource');
    }
    const stale = versionConflict(input.expectedVersion, supplier.version);
    if (stale !== null) {
      return failure(stale);
    }
    if (supplier.source === 'erp') {
      return refuse('Unprocessable', 'sourceOwned', { field: 'status' });
    }
    const change = await supplierStore.update(database, {
      tenantId,
      supplierId: supplier.id,
      expectedVersion: input.expectedVersion,
      now,
      set: { status: input.status },
    });
    // No unique key changes here, so the only way to miss is a version that moved on.
    if (change.kind !== 'updated') {
      return refuse('Conflict', 'versionMismatch');
    }
    const { version } = change;
    audit.record({ supplier: auditId(supplier.id), version, status: auditToken(input.status) });
    return success({ supplierId: supplier.id, version });
  }
}

@Injectable()
export class AddContactHandler implements CommandHandler<typeof addContactCommand> {
  async execute(
    input: InputOf<typeof addContactCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof addContactCommand>> {
    const { tenantId } = principal;
    if ((await supplierStore.find(database, tenantId, input.supplierId)) === undefined) {
      return refuse('NotFound', 'resource');
    }
    const contactId = await supplierStore.insertContact(database, { ...input, tenantId, addedAt: now });
    if (contactId === undefined) {
      return refuse('Conflict', 'alreadyExists');
    }
    audit.record({
      supplier: auditId(input.supplierId),
      contact: auditId(contactId),
      role: auditToken(input.role),
      name: await audit.commit(input.name),
      email: await audit.commit(input.email),
    });
    return success({ supplierId: input.supplierId, contactId });
  }
}

@Injectable()
export class RemoveContactHandler implements CommandHandler<typeof removeContactCommand> {
  async execute(
    input: InputOf<typeof removeContactCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof removeContactCommand>> {
    const { tenantId } = principal;
    const contact = await supplierStore.findCurrentContact(database, tenantId, input.contactId);
    if (contact === undefined) {
      return refuse('NotFound', 'resource');
    }
    if (!(await supplierStore.removeContact(database, tenantId, contact.id, now))) {
      return refuse('NotFound', 'resource');
    }
    audit.record({ supplier: auditId(contact.supplierId), contact: auditId(contact.id) });
    return success({ supplierId: contact.supplierId, contactId: contact.id });
  }
}

@Injectable()
export class SetApprovalHandler implements CommandHandler<typeof setApprovalCommand> {
  async execute(
    input: InputOf<typeof setApprovalCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof setApprovalCommand>> {
    const { tenantId } = principal;
    const supplier = await supplierStore.find(database, tenantId, input.supplierId);
    if (supplier === undefined) {
      return refuse('NotFound', 'resource');
    }
    // R9: an ERP-owned list is a read-only mirror, whoever asks.
    if ((await supplierStore.approvedListSource(database, tenantId)) === 'erp') {
      return refuse('Unprocessable', 'approvedListErpOwned');
    }
    const current = await supplierStore.approval(database, tenantId, supplier.id);
    const stale = versionConflict(input.expectedVersion, current?.version ?? 0);
    if (stale !== null) {
      return failure(stale);
    }
    const version = await supplierStore.setApproval(database, {
      tenantId,
      supplierId: supplier.id,
      expectedVersion: input.expectedVersion,
      now,
      status: input.status,
      scope: input.scope,
      expiresOn: input.expiresOn,
    });
    if (version === undefined) {
      return refuse('Conflict', 'versionMismatch');
    }
    audit.record({
      supplier: auditId(supplier.id),
      version,
      previousStatus: auditToken((current ?? notOnTheList).status),
      status: auditToken(input.status),
      scope: input.scope.map((category) => auditToken(category)),
      expiresOn: input.expiresOn === null ? null : await audit.commit(input.expiresOn),
    });
    return success({ supplierId: supplier.id, version });
  }
}

@Injectable()
export class CheckIdentityHandler implements CommandHandler<typeof checkIdentityCommand> {
  async execute(
    input: InputOf<typeof checkIdentityCommand>,
    { principal, database, audit, jobs }: CommandContext,
  ): Promise<HandlerResult<typeof checkIdentityCommand>> {
    const supplier = await supplierStore.find(database, principal.tenantId, input.supplierId);
    if (supplier === undefined) {
      return refuse('NotFound', 'resource');
    }
    const registers = await queueIdentityChecks(jobs, supplier, 'request');
    audit.record({ supplier: auditId(supplier.id), identityChecks: registers.map((register) => auditToken(register)) });
    return success({ supplierId: supplier.id, registers });
  }
}

@Injectable()
export class SupplierListHandler implements QueryHandler<typeof supplierListQuery> {
  async execute(
    _input: InputOf<typeof supplierListQuery>,
    { principal, database, now }: OperationContext,
  ): Promise<HandlerResult<typeof supplierListQuery>> {
    const { tenantId } = principal;
    const asOf = calendarDateOf(now);
    const suppliers = await supplierStore.list(database, tenantId);
    const approvals = await supplierStore.approvals(database, tenantId);
    const checks = await supplierStore.identityChecks(
      database,
      tenantId,
      suppliers.map((supplier) => supplier.id),
    );
    return success({
      asOf,
      approvedListSource: await supplierStore.approvedListSource(database, tenantId),
      suppliers: suppliers.map((supplier) => ({
        supplierId: supplier.id,
        code: supplier.code,
        name: supplier.name,
        country: supplier.country,
        approval: approvalRead(approvals.get(supplier.id) ?? notOnTheList, asOf),
        identityCheck: identitySummary(supplier, checks.get(supplier.id) ?? []),
        // The evidence vault (U15) assesses suppliers; until it does, the status is unknown.
        evidence: null,
      })),
    });
  }
}

@Injectable()
export class SupplierDetailHandler implements QueryHandler<typeof supplierDetailQuery> {
  async execute(
    input: InputOf<typeof supplierDetailQuery>,
    { principal, database, now }: OperationContext,
  ): Promise<HandlerResult<typeof supplierDetailQuery>> {
    const { tenantId } = principal;
    const supplier = await supplierStore.find(database, tenantId, input.supplierId);
    if (supplier === undefined) {
      return refuse('NotFound', 'resource');
    }
    const asOf = calendarDateOf(now);
    const approval = await supplierStore.approval(database, tenantId, supplier.id);
    const checks = await supplierStore.identityChecks(database, tenantId, [supplier.id]);
    const contacts = await supplierStore.currentContacts(database, tenantId, supplier.id);
    return success({
      asOf,
      approvedListSource: await supplierStore.approvedListSource(database, tenantId),
      supplier: {
        supplierId: supplier.id,
        code: supplier.code,
        name: supplier.name,
        country: supplier.country,
        vatId: supplier.vatId,
        lei: supplier.lei,
        status: supplier.status,
        source: supplier.source,
        version: supplier.version,
        approval: approvalRead(approval ?? notOnTheList, asOf),
        approvalVersion: approval?.version ?? 0,
        identityChecks: latestChecks(supplier, checks.get(supplier.id) ?? []),
        contacts: contacts.map((contact) => ({
          contactId: contact.id,
          name: contact.name,
          email: contact.email,
          role: contact.role,
          addedAt: contact.addedAt.toISOString(),
        })),
      },
    });
  }
}
