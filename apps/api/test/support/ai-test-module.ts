import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { failure, success, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { aiCommands, aiQueries } from '../../src/ai/ai-operations';
import { AiSuggestions } from '../../src/ai/ai-suggestions.service';
import type { EgressNetwork } from '../../src/ai/egress-allowlist';
import { SuggestionTargets, type SuggestionTarget } from '../../src/ai/suggestion-targets';
import type { OperationRegistry } from '../../src/commands/handlers';
import { combineModuleJobs, productionJobs } from '../../src/jobs/job-registry';
import {
  defineJob,
  jobField,
  registerJob,
  type JobItemContext,
  type JobHandler,
  type ModuleJobs,
  type PayloadOf,
} from '../../src/jobs/job.types';
import { internalTestRegistry } from './internal-test-module';

/**
 * Test-only wiring for the AI layer (U11): the AI operations beside the harness's own, a
 * suggestion target over the harness's synthetic notes, a job that asks the AI to suggest a
 * note's title, and a stand-in network that answers like a provider. Nothing here is part of
 * the production registries, and no request ever leaves the process.
 */

export const aiTestRegistry: OperationRegistry = {
  commands: [...internalTestRegistry.commands, ...aiCommands],
  queries: [...internalTestRegistry.queries, ...aiQueries],
};

const versionRows = z.array(z.object({ version: z.number().int() }));

/** The harness's notes, as a module would declare its records as a suggestion target. */
export const noteTitleTarget: SuggestionTarget = {
  type: 'entity_field',
  entity: 'internalTestNote',
  roles: ['buyer', 'quality_engineer'],
  valueSchema: (field) => (field === 'title' ? z.string().min(1).max(200) : null),
  async currentVersion(database, tenantId, id) {
    const rows = versionRows.parse(
      (
        await database.execute(
          sql`select version from internal_test_notes where tenant_id = ${tenantId} and id = ${id}`,
        )
      ).rows,
    );
    return rows[0]?.version ?? null;
  },
  async apply(database, change) {
    const rows = versionRows.parse(
      (
        await database.execute(
          sql`update internal_test_notes set title = ${z.string().parse(change.value)}, version = version + 1
               where tenant_id = ${change.tenantId} and id = ${change.id} and version = ${change.baseVersion}
               returning version`,
        )
      ).rows,
    );
    return rows[0]?.version ?? null;
  },
};

/**
 * Runs between the target's version read and its update, standing in for another person's
 * edit that commits in that gap. Tests set it and clear it.
 */
export const betweenReadAndApply: { run: ((noteId: string) => Promise<void>) | null } = { run: null };

/** The notes target, with the concurrent edit of `betweenReadAndApply` after each version read. */
const racingNoteTitleTarget: SuggestionTarget = {
  ...noteTitleTarget,
  async currentVersion(database, tenantId, id) {
    const version = await noteTitleTarget.currentVersion(database, tenantId, id);
    const edit = betweenReadAndApply.run;
    if (edit !== null) {
      betweenReadAndApply.run = null;
      await edit(id);
    }
    return version;
  },
};

/** The same notes, as a target only quality engineers may decide. */
export const noteReviewTarget: SuggestionTarget = {
  ...noteTitleTarget,
  entity: 'internalTestNoteReview',
  roles: ['quality_engineer'],
};

export const testSuggestionTargets = new SuggestionTargets([racingNoteTitleTarget, noteReviewTarget]);

export const suggestTitleJob = defineJob({
  name: 'aiTest.suggestTitle',
  description: 'Asks the AI for a better title of one synthetic note.',
  payload: { noteId: jobField.id() },
  retryLimit: 0,
});

export const titleAnswerSchema = z.object({
  title: z.string().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1),
});

const noteRows = z.array(z.object({ title: z.string(), version: z.number().int() }));

@Injectable()
export class SuggestTitleHandler implements JobHandler<typeof suggestTitleJob> {
  constructor(@Inject(AiSuggestions) private readonly suggestions: AiSuggestions) {}

  items(payload: PayloadOf<typeof suggestTitleJob>): Promise<readonly string[]> {
    return Promise.resolve([`note:${payload.noteId}`]);
  }

  async apply(
    _item: string,
    payload: PayloadOf<typeof suggestTitleJob>,
    context: JobItemContext,
  ): Promise<Result<void, DomainError>> {
    const [note] = noteRows.parse(
      (await context.database.execute(sql`select title, version from internal_test_notes where id = ${payload.noteId}`))
        .rows,
    );
    if (note === undefined) {
      return failure({ _tag: 'NotFound', reason: 'resource', params: {} });
    }
    const document = `Synthetic note: ${note.title}`;
    const suggested = await this.suggestions.suggest(context, {
      instructions: 'Suggest a clearer title for the note.',
      schema: titleAnswerSchema,
      document: { text: document, sha256: createHash('sha256').update(document).digest('hex') },
      toSuggestions: (answer) =>
        answer.title === null
          ? []
          : [
              {
                requestKey: `aiTest.suggestTitle:${payload.noteId}:v${note.version}`,
                kind: 'aiTest.noteTitle',
                target: { type: 'entity_field', entity: 'internalTestNote', id: payload.noteId, field: 'title' },
                baseVersion: note.version,
                value: answer.title,
                sourceLocation: { line: 1 },
                confidence: answer.confidence,
              },
            ],
    });
    return suggested.ok ? success(undefined) : suggested;
  }
}

export const aiTestJobs: ModuleJobs = combineModuleJobs([
  productionJobs,
  { jobs: [registerJob(suggestTitleJob, SuggestTitleHandler)], schedules: [] },
]);

export interface ProviderRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Stands in for the providers' networks: every host resolves to a public address and every
 * request gets an Anthropic-style answer whose text is `answerText`. Requests are recorded.
 */
export class StandInProviderNetwork implements EgressNetwork {
  readonly requests: ProviderRequest[] = [];
  answerText = JSON.stringify({ title: 'Synthetic bracket, anodised', confidence: 0.8 });
  status = 200;

  readonly resolve = () => Promise.resolve([{ address: '160.79.104.10', family: 4 }]);

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.requests.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const body = {
      id: 'msg_synthetic',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: this.answerText }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    return Promise.resolve(
      new Response(
        JSON.stringify(this.status === 200 ? body : { type: 'error', error: { type: 'invalid_request_error' } }),
        {
          status: this.status,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  };
}
