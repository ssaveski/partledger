import { Injectable } from '@nestjs/common';
import {
  createPartCommand,
  erpOwnedPartFields,
  partListQuery,
  setPartActiveCommand,
  updatePartCommand,
  type InputOf,
  type PartChanges,
} from '@partledger/contracts';
import { refuse, success, versionConflict, failure } from '@partledger/domain';

import { auditId, auditToken } from '../audit/audit-payload';
import type { CommandAudit } from '../audit/command-audit';
import type {
  CommandContext,
  CommandHandler,
  HandlerResult,
  OperationContext,
  QueryHandler,
} from '../commands/handlers';
import { calendarDateOf } from '../suppliers/approval-standing';
import { partStore, type PartFields, type StoredPart } from './part-store';

/**
 * The parts list (U10, R6). Every change runs in the caller's tenant transaction and lands in
 * that command's audit entry; part numbers and descriptions enter the chain only as commitments.
 */

/** The ERP-owned fields a change would alter on an `erp` part; unchanged values pass. */
export function erpOwnedFieldsChanged(part: StoredPart, changes: PartChanges): string[] {
  if (part.source !== 'erp') {
    return [];
  }
  return erpOwnedPartFields.filter((field) => changes[field] !== undefined && changes[field] !== part[field]);
}

async function recordFields(audit: CommandAudit, fields: Partial<PartFields>) {
  return {
    ...(fields.partNumber === undefined ? {} : { partNumber: await audit.commit(fields.partNumber) }),
    ...(fields.revision === undefined ? {} : { revision: await audit.commit(fields.revision) }),
    ...(fields.description === undefined ? {} : { description: await audit.commit(fields.description) }),
    ...(fields.category === undefined ? {} : { category: auditToken(fields.category) }),
    ...(fields.unit === undefined ? {} : { unit: auditToken(fields.unit) }),
  };
}

@Injectable()
export class CreatePartHandler implements CommandHandler<typeof createPartCommand> {
  async execute(
    input: InputOf<typeof createPartCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof createPartCommand>> {
    const created = await partStore.insert(database, { ...input, tenantId: principal.tenantId, now });
    if (created === undefined) {
      return refuse('Conflict', 'alreadyExists');
    }
    audit.record({
      part: auditId(created.id),
      source: auditToken('platform'),
      fields: await recordFields(audit, input),
    });
    return success({ partId: created.id, version: created.version });
  }
}

@Injectable()
export class UpdatePartHandler implements CommandHandler<typeof updatePartCommand> {
  async execute(
    input: InputOf<typeof updatePartCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof updatePartCommand>> {
    const { tenantId } = principal;
    const part = await partStore.find(database, tenantId, input.partId);
    if (part === undefined) {
      return refuse('NotFound', 'resource');
    }
    const stale = versionConflict(input.expectedVersion, part.version);
    if (stale !== null) {
      return failure(stale);
    }
    const [erpOwned] = erpOwnedFieldsChanged(part, input.changes);
    if (erpOwned !== undefined) {
      return refuse('Unprocessable', 'sourceOwned', { field: erpOwned });
    }
    const { partNumber } = input.changes;
    if (
      partNumber !== undefined &&
      partNumber !== part.partNumber &&
      (await partStore.numberInUse(database, tenantId, partNumber))
    ) {
      return refuse('Conflict', 'alreadyExists');
    }
    const version = await partStore.update(database, {
      tenantId,
      partId: part.id,
      expectedVersion: input.expectedVersion,
      now,
      set: input.changes,
    });
    if (version === undefined) {
      return refuse('Conflict', 'versionMismatch');
    }
    audit.record({ part: auditId(part.id), version, fields: await recordFields(audit, input.changes) });
    return success({ partId: part.id, version });
  }
}

@Injectable()
export class SetPartActiveHandler implements CommandHandler<typeof setPartActiveCommand> {
  async execute(
    input: InputOf<typeof setPartActiveCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof setPartActiveCommand>> {
    const { tenantId } = principal;
    const part = await partStore.find(database, tenantId, input.partId);
    if (part === undefined) {
      return refuse('NotFound', 'resource');
    }
    const stale = versionConflict(input.expectedVersion, part.version);
    if (stale !== null) {
      return failure(stale);
    }
    if (part.source === 'erp') {
      return refuse('Unprocessable', 'sourceOwned', { field: 'active' });
    }
    const version = await partStore.update(database, {
      tenantId,
      partId: part.id,
      expectedVersion: input.expectedVersion,
      now,
      set: { active: input.active },
    });
    if (version === undefined) {
      return refuse('Conflict', 'versionMismatch');
    }
    audit.record({ part: auditId(part.id), version, active: input.active });
    return success({ partId: part.id, version });
  }
}

@Injectable()
export class PartListHandler implements QueryHandler<typeof partListQuery> {
  async execute(
    _input: InputOf<typeof partListQuery>,
    { principal, database, now }: OperationContext,
  ): Promise<HandlerResult<typeof partListQuery>> {
    const rows = await partStore.list(database, principal.tenantId, calendarDateOf(now));
    return success({
      parts: rows.map((row) => ({
        partId: row.id,
        partNumber: row.partNumber,
        revision: row.revision,
        description: row.description,
        category: row.category,
        unit: row.unit,
        source: row.source,
        active: row.active,
        approvedSupplierCount: row.approvedSupplierCount,
        updatedAt: row.updatedAt.toISOString(),
        version: row.version,
      })),
    });
  }
}
