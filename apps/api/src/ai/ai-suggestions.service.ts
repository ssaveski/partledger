import { Inject, Injectable } from '@nestjs/common';
import { domainError, failure, success, type DomainErrorOf, type Result } from '@partledger/domain';
import { z } from 'zod';

import type { JobItemContext } from '../jobs/job.types';
import type { AiAgentPrincipal } from '../principals/principal';
import { clock, type Clock } from '../time/clock';
import { AiWorkerDatabase } from './ai-worker-database';
import type { EgressNetwork } from './egress-allowlist';
import type { LocalResponder } from './local-model';
import { createModel } from './provider-factory';
import { checkRegionPolicy } from './region-policy';
import { structuredCall } from './structured-call';
import { recordSuggestions, suggestionDraftSchema, type RecordedSuggestions } from './suggestion-store';
import { AiConfigurations } from './tenant-ai-configuration';

/** How AI calls reach the network, the local model's responder, and how long a call may take. */
export interface AiCallSettings {
  readonly network: EgressNetwork;
  readonly localResponder: LocalResponder | undefined;
  readonly timeoutMilliseconds: number;
}

export const aiCallSettings = Symbol('AiCallSettings');

/** The AI agent every suggestion is recorded as (R26); the audit entry also names the model. */
export const suggestionAgentId = '6f1c2a4e-8b7d-4c5e-9a3f-0d2e1b4c6a01';

export type SuggestFailure =
  | DomainErrorOf<{ readonly tag: 'Unprocessable'; readonly reason: 'aiRegionNotAllowed' }>
  | DomainErrorOf<{ readonly tag: 'Unprocessable'; readonly reason: 'aiOutputInvalid' }>
  | DomainErrorOf<{ readonly tag: 'Unavailable'; readonly reason: 'dependencyUnavailable' }>;

export interface SuggestRequest<Schema extends z.ZodType> {
  /** What the model is asked to do; written by the platform. */
  readonly instructions: string;
  /** The schema of the model's answer (see structured-call.ts). */
  readonly schema: Schema;
  /** The untrusted document and the SHA-256 of the bytes it was read from. */
  readonly document: { readonly text: string; readonly sha256: string };
  /** Turns the parsed answer into suggestions; each is parsed again before it is stored. */
  readonly toSuggestions: (answer: z.output<Schema>) => readonly z.input<typeof suggestionDraftSchema>[];
}

/**
 * The one way AI output reaches people (R31): a background job asks for suggestions about a
 * document, and gets them stored, pending, for a person to accept or reject. The tenant's
 * configuration is read in the job's transaction; the region policy is checked before any
 * call; the model is built for this call only; and the answer is stored through the AI worker's
 * connection, all of it or none of it.
 *
 * A job calls `suggest` before it appends anything to the audit chain in its own transaction:
 * the worker's appends take the same per-tenant chain lock, in a transaction of their own.
 */
@Injectable()
export class AiSuggestions {
  constructor(
    @Inject(AiConfigurations) private readonly configurations: AiConfigurations,
    @Inject(AiWorkerDatabase) private readonly worker: AiWorkerDatabase,
    @Inject(aiCallSettings) private readonly settings: AiCallSettings,
    @Inject(clock) private readonly time: Clock,
  ) {}

  async suggest<Schema extends z.ZodType>(
    context: Pick<JobItemContext, 'principal' | 'database'>,
    request: SuggestRequest<Schema>,
  ): Promise<Result<RecordedSuggestions, SuggestFailure>> {
    const { principal, database } = context;
    const resolved = await this.configurations.resolve(database, principal.tenantId);
    if (!resolved.ok) {
      return failure(domainError('Unavailable', 'dependencyUnavailable'));
    }
    const { configuration, source, tenant } = resolved.value;
    const model = createModel(configuration, {
      network: this.settings.network,
      localResponder: this.settings.localResponder,
    });
    if (!model.ok) {
      return failure(domainError('Unavailable', 'dependencyUnavailable'));
    }
    const allowed = checkRegionPolicy(tenant, model.value.processingRegion);
    if (!allowed.ok) {
      return allowed;
    }
    const answer = await structuredCall({
      model: model.value,
      schema: request.schema,
      instructions: request.instructions,
      document: request.document.text,
      timeoutMilliseconds: this.settings.timeoutMilliseconds,
    });
    if (!answer.ok) {
      return answer;
    }
    const drafts = z.array(suggestionDraftSchema).safeParse(request.toSuggestions(answer.value.value));
    if (!drafts.success) {
      return failure(domainError('Unprocessable', 'aiOutputInvalid'));
    }
    const agent: AiAgentPrincipal = {
      type: 'ai_agent',
      tenantId: principal.tenantId,
      agentId: suggestionAgentId,
      actedUnder: principal.actedUnder,
      adapter: principal.adapter,
      correlationId: principal.correlationId,
    };
    const recorded = await recordSuggestions(
      this.worker,
      agent,
      drafts.data,
      {
        sourceHash: request.document.sha256,
        model: model.value.modelId,
        provider: model.value.provider,
        processingRegion: model.value.processingRegion,
        configurationSource: source,
      },
      this.time,
    );
    return recorded.ok ? success(recorded.value) : failure(domainError('Unavailable', 'dependencyUnavailable'));
  }
}
