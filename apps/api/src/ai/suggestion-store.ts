import { randomUUID } from 'node:crypto';

import { aiProcessingRegions, tenantAiProviders } from '@partledger/contracts';
import { failure, success, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditHash, auditId, auditToken, auditTokenPattern } from '../audit/audit-payload';
import { appendAuditEntry, auditActorOf } from '../audit/audit-writer';
import { commitValue } from '../audit/commitments';
import type { AiAgentPrincipal } from '../principals/principal';
import type { Clock } from '../time/clock';
import type { AiWorkerDatabase } from './ai-worker-database';

const token = z.string().max(100).regex(auditTokenPattern);

/** One suggestion as a feature proposes it (KTD40); parsed before anything is stored. */
export const suggestionDraftSchema = z.strictObject({
  /** Unique per tenant: a redelivered job proposing the same key stores nothing again. */
  requestKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/),
  kind: token,
  target: z.strictObject({
    type: z.enum(['entity_field', 'import_mapping']),
    entity: token,
    id: z.uuid().transform((value) => value.toLowerCase()),
    field: token,
  }),
  baseVersion: z.number().int().min(0),
  value: z.json(),
  sourceLocation: z.record(z.string().max(100), z.union([z.string().max(200), z.number()])).nullable(),
  confidence: z.number().min(0).max(1),
});

export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;

/** Where every suggestion of one AI call came from. */
export const suggestionProvenanceSchema = z.strictObject({
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  model: token,
  provider: z.enum([...tenantAiProviders, 'local']),
  processingRegion: z.enum(aiProcessingRegions),
  configurationSource: z.enum(['tenant', 'platform']),
});

export type SuggestionProvenance = z.infer<typeof suggestionProvenanceSchema>;

export interface RecordedSuggestions {
  /** The suggestions stored by this call. */
  readonly stored: readonly string[];
  /** Drafts whose request key was already stored, by an earlier delivery of the same job. */
  readonly alreadyStored: number;
}

/**
 * Stores AI suggestions through the AI worker's connection (R31, KTD17): every suggestion is
 * stored pending with its own audit entry, whose actor is the AI agent and whose value is a
 * commitment. One call's suggestions are stored together or not at all.
 */
export async function recordSuggestions(
  worker: AiWorkerDatabase,
  agent: AiAgentPrincipal,
  drafts: readonly SuggestionDraft[],
  provenance: SuggestionProvenance,
  time: Clock,
): Promise<Result<RecordedSuggestions, 'unavailable'>> {
  const { tenantId } = agent;
  const result = await worker.run(tenantId, async (transaction) => {
    const stored: string[] = [];
    let alreadyStored = 0;
    const now = time.now();
    for (const draft of drafts) {
      const id = randomUUID();
      // No RETURNING and no conflict target, which would each need SELECT: the AI worker may insert
      // suggestions but never read them. The only possible conflict is the request key.
      const inserted = await transaction.execute(
        sql`insert into ai_suggestions
              (id, tenant_id, request_key, kind, target_type, target_entity, target_id, target_field, base_version,
               suggested_value, source_hash, source_location, confidence, model, provider, processing_region,
               configuration_source, created_at)
            values (${id}, ${tenantId}, ${draft.requestKey}, ${draft.kind}, ${draft.target.type},
                    ${draft.target.entity}, ${draft.target.id}, ${draft.target.field}, ${draft.baseVersion},
                    ${JSON.stringify(draft.value)}::jsonb, ${Buffer.from(provenance.sourceHash, 'hex')},
                    ${draft.sourceLocation === null ? null : JSON.stringify(draft.sourceLocation)}::jsonb,
                    ${draft.confidence}, ${provenance.model}, ${provenance.provider}, ${provenance.processingRegion},
                    ${provenance.configurationSource}, ${now.toISOString()}::timestamptz)
            on conflict do nothing`,
      );
      if (inserted.rowCount !== 1) {
        alreadyStored += 1;
        continue;
      }
      const value = await commitValue(transaction, { tenantId, value: JSON.stringify(draft.value), now });
      await appendAuditEntry(
        transaction,
        {
          tenantId,
          actor: auditActorOf(agent),
          event: auditToken('ai.suggestionRecorded'),
          data: {
            suggestion: auditId(id),
            kind: auditToken(draft.kind),
            targetType: auditToken(draft.target.type),
            targetEntity: auditToken(draft.target.entity),
            targetId: auditId(draft.target.id),
            targetField: auditToken(draft.target.field),
            baseVersion: draft.baseVersion,
            confidence: draft.confidence,
            value,
            sourceHash: auditHash(provenance.sourceHash),
            model: auditToken(provenance.model),
            provider: auditToken(provenance.provider),
            processingRegion: auditToken(provenance.processingRegion),
            configurationSource: auditToken(provenance.configurationSource),
          },
        },
        time,
      );
      stored.push(id);
    }
    return { stored, alreadyStored };
  });
  return result.ok ? success(result.value) : failure('unavailable');
}
