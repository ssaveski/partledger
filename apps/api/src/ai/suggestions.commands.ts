import { Inject, Injectable } from '@nestjs/common';
import {
  acceptSuggestionCommand,
  aiDisclosure,
  rejectSuggestionCommand,
  suggestionsQuery,
  type InputOf,
  type Suggestion,
} from '@partledger/contracts';
import { schema } from '@partledger/db';
import { refuse, success, versionConflict, failure } from '@partledger/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditId, auditToken } from '../audit/audit-payload';
import type {
  CommandContext,
  CommandHandler,
  HandlerResult,
  OperationContext,
  QueryHandler,
} from '../commands/handlers';
import type { AppDatabase } from '../db/tenant-transaction';
import type { Principal } from '../principals/principal';
import { suggestionTargets, type SuggestionTarget, type SuggestionTargets } from './suggestion-targets';

const { aiSuggestions } = schema;

/**
 * People decide AI suggestions (R31, KTD40). Accepting applies the value through the target's
 * own `apply`, in the person's command, and only while the record is still at the version the
 * suggestion was made against; rejecting leaves the record alone. Either decision is recorded
 * once, and the command's audit entry names the person.
 */

type StoredSuggestion = typeof aiSuggestions.$inferSelect;

type Decidable =
  | { readonly ok: true; readonly suggestion: StoredSuggestion; readonly target: SuggestionTarget }
  | { readonly ok: false; readonly refusal: 'notFound' | 'decided' | 'notPermitted' };

async function decidable(
  database: AppDatabase,
  targets: SuggestionTargets,
  principal: Principal,
  suggestionId: string,
): Promise<Decidable> {
  const [suggestion] = await database
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.tenantId, principal.tenantId), eq(aiSuggestions.id, suggestionId)))
    .for('update');
  const target = suggestion === undefined ? undefined : targets.find(suggestion.targetType, suggestion.targetEntity);
  if (suggestion === undefined || target === undefined) {
    return { ok: false, refusal: 'notFound' };
  }
  const roles = principal.type === 'person' ? principal.roles : [];
  if (!roles.some((role) => target.roles.includes(role))) {
    return { ok: false, refusal: 'notPermitted' };
  }
  if (suggestion.status !== 'pending') {
    return { ok: false, refusal: 'decided' };
  }
  return { ok: true, suggestion, target };
}

function refusalOf(refusal: 'notFound' | 'decided' | 'notPermitted') {
  switch (refusal) {
    case 'notFound':
      return refuse('NotFound', 'resource');
    case 'decided':
      return refuse('Conflict', 'transitionNotAllowed');
    case 'notPermitted':
      return refuse('Forbidden', 'notPermitted');
  }
}

async function recordDecision(
  database: AppDatabase,
  suggestion: StoredSuggestion,
  status: 'accepted' | 'rejected',
  deciderId: string | null,
  now: Date,
): Promise<void> {
  await database.execute(
    sql`update ai_suggestions set status = ${status}, decided_at = ${now.toISOString()}::timestamptz,
               decided_by = ${deciderId}
         where tenant_id = ${suggestion.tenantId} and id = ${suggestion.id} and status = 'pending'`,
  );
}

@Injectable()
export class AcceptSuggestionHandler implements CommandHandler<typeof acceptSuggestionCommand> {
  constructor(@Inject(suggestionTargets) private readonly targets: SuggestionTargets) {}

  async execute(
    input: InputOf<typeof acceptSuggestionCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof acceptSuggestionCommand>> {
    const found = await decidable(database, this.targets, principal, input.suggestionId);
    if (!found.ok) {
      return refusalOf(found.refusal);
    }
    const { suggestion, target } = found;
    const currentVersion = await target.currentVersion(database, suggestion.tenantId, suggestion.targetId);
    if (currentVersion === null) {
      return refuse('NotFound', 'resource');
    }
    const conflict = versionConflict(suggestion.baseVersion, currentVersion);
    if (conflict !== null) {
      return failure(conflict);
    }
    const valueSchema = target.valueSchema(suggestion.targetField);
    const value = valueSchema?.safeParse(suggestion.suggestedValue);
    if (value?.success !== true) {
      return refuse('Conflict', 'transitionNotAllowed');
    }
    const targetVersion = await target.apply(database, {
      tenantId: suggestion.tenantId,
      id: suggestion.targetId,
      field: suggestion.targetField,
      value: value.data,
      baseVersion: suggestion.baseVersion,
      now,
    });
    await recordDecision(database, suggestion, 'accepted', principal.type === 'person' ? principal.userId : null, now);
    audit.record({
      suggestion: auditId(suggestion.id),
      decision: 'accepted',
      targetEntity: auditToken(suggestion.targetEntity),
      targetId: auditId(suggestion.targetId),
      targetField: auditToken(suggestion.targetField),
      baseVersion: suggestion.baseVersion,
      targetVersion,
    });
    return success({ suggestionId: suggestion.id, status: 'accepted' });
  }
}

@Injectable()
export class RejectSuggestionHandler implements CommandHandler<typeof rejectSuggestionCommand> {
  constructor(@Inject(suggestionTargets) private readonly targets: SuggestionTargets) {}

  async execute(
    input: InputOf<typeof rejectSuggestionCommand>,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof rejectSuggestionCommand>> {
    const found = await decidable(database, this.targets, principal, input.suggestionId);
    if (!found.ok) {
      return refusalOf(found.refusal);
    }
    const { suggestion } = found;
    await recordDecision(database, suggestion, 'rejected', principal.type === 'person' ? principal.userId : null, now);
    audit.record({
      suggestion: auditId(suggestion.id),
      decision: 'rejected',
      targetEntity: auditToken(suggestion.targetEntity),
      targetId: auditId(suggestion.targetId),
      targetField: auditToken(suggestion.targetField),
    });
    return success({ suggestionId: suggestion.id, status: 'rejected' });
  }
}

const sourceLocationSchema = z.record(z.string(), z.union([z.string(), z.number()])).nullable();

@Injectable()
export class SuggestionsHandler implements QueryHandler<typeof suggestionsQuery> {
  async execute(
    input: InputOf<typeof suggestionsQuery>,
    { principal, database }: OperationContext,
  ): Promise<HandlerResult<typeof suggestionsQuery>> {
    const rows = await database
      .select()
      .from(aiSuggestions)
      .where(
        and(
          eq(aiSuggestions.tenantId, principal.tenantId),
          eq(aiSuggestions.targetEntity, input.targetEntity),
          eq(aiSuggestions.targetId, input.targetId),
        ),
      )
      .orderBy(desc(aiSuggestions.createdAt), desc(aiSuggestions.id))
      .limit(200);
    const suggestions: Suggestion[] = rows.map((row) => ({
      suggestionId: row.id,
      kind: row.kind,
      target: { type: row.targetType, entity: row.targetEntity, id: row.targetId, field: row.targetField },
      baseVersion: row.baseVersion,
      value: z.json().parse(row.suggestedValue),
      sourceHash: row.sourceHash.toString('hex'),
      sourceLocation: sourceLocationSchema.parse(row.sourceLocation),
      confidence: row.confidence,
      model: row.model,
      provider: row.provider,
      processingRegion: row.processingRegion,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      disclosure: aiDisclosure,
    }));
    return success({ suggestions });
  }
}
