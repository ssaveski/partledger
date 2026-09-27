import {
  refuse,
  success,
  transitionTarget,
  type DomainErrorOf,
  type Result,
  type TransitionTable,
} from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AuditDatabase } from '../audit/audit-writer';
import type { CommandAudit } from '../audit/command-audit';

/**
 * Moves one aggregate along its lifecycle (KTD13): a conditional
 * `UPDATE … SET status = :to WHERE id = :id AND status = :from`, and the transition recorded
 * in the command's audit entry, which the executor appends in the same transaction. When the
 * stored status is no longer `from`, because another request moved it first, nothing changes
 * and the transition is refused as a conflict.
 */

export interface TransitionRequest<Status extends string, Transition extends string> {
  /** The aggregate's table, a constant in code; row-level security scopes it to the tenant. */
  readonly table: string;
  readonly id: string;
  readonly transition: Transition;
  /** The status the caller read and decided on. */
  readonly from: Status;
  /** Whether the table has a `version` column that every change increments (R33). */
  readonly versioned: boolean;
}

export interface AppliedTransition<Status extends string> {
  readonly status: Status;
  /** The new version, for versioned aggregates. */
  readonly version: number | null;
}

export type TransitionRefusal = DomainErrorOf<{ readonly tag: 'Conflict'; readonly reason: 'transitionNotAllowed' }>;

export interface TransitionContext {
  readonly database: AuditDatabase;
  readonly audit: CommandAudit;
}

const updatedRows = z.array(z.object({ version: z.number().int().nullable() }));

export async function applyTransition<Status extends string, Transition extends string>(
  context: TransitionContext,
  lifecycle: TransitionTable<Status, Transition>,
  request: TransitionRequest<NoInfer<Status>, NoInfer<Transition>>,
): Promise<Result<AppliedTransition<Status>, TransitionRefusal>> {
  const params = { aggregate: lifecycle.aggregate, transition: request.transition, from: request.from };
  const to = transitionTarget(lifecycle, request.transition, request.from);
  if (to === null) {
    return refuse('Conflict', 'transitionNotAllowed', params);
  }
  const table = sql.identifier(request.table);
  const result = await context.database.execute(
    request.versioned
      ? sql`update ${table} set status = ${to}, version = version + 1
            where id = ${request.id} and status = ${request.from} returning version`
      : sql`update ${table} set status = ${to}
            where id = ${request.id} and status = ${request.from} returning null::integer as version`,
  );
  const [row] = updatedRows.parse(result.rows);
  if (row === undefined) {
    return refuse('Conflict', 'transitionNotAllowed', params);
  }
  const transition: string = request.transition;
  const from: string = request.from;
  const target: string = to;
  context.audit.record({
    kind: 'transition',
    aggregate: lifecycle.aggregate,
    id: request.id,
    transition,
    from,
    to: target,
  });
  return success({ status: to, version: row.version });
}
