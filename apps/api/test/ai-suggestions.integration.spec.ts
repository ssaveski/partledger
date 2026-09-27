import { randomUUID } from 'node:crypto';

import { aiDisclosureMessageKey, suggestionSchema } from '@partledger/contracts';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { encryptionContextOf } from '../src/ai/tenant-ai-configuration';
import { JobItemFailedError, JobRunner, type DeliveredJob } from '../src/jobs/job-runner';
import { keyService, type KeyService } from '../src/keys/key-service.port';
import {
  aiTestJobs,
  aiTestRegistry,
  betweenReadAndApply,
  StandInProviderNetwork,
  suggestTitleJob,
  testSuggestionTargets,
} from './support/ai-test-module';
import { startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';

const tenantKey = 'sk-ant-synthetic-tenant-key-7f3c9a1e5b';
const scriptedTitle = 'Synthetic bracket, anodised';

const suggestionRows = z.array(
  z.object({
    id: z.uuid(),
    status: z.enum(['pending', 'accepted', 'rejected']),
    provider: z.string(),
    processing_region: z.string(),
    configuration_source: z.string(),
    model: z.string(),
    base_version: z.number(),
    decided_by: z.uuid().nullable(),
  }),
);
const auditRows = z.array(
  z.object({
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    acted_under: z.record(z.string(), z.unknown()),
    payload: z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }).loose(),
    canonical: z.instanceof(Buffer),
  }),
);
const noteRows = z.array(z.object({ title: z.string(), version: z.number() }));
const idRows = z.tuple([z.object({ id: z.uuid() })]);
const outcomeRows = z.array(z.object({ status: z.string(), failure: z.string().nullable() }));

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  return (await databaseErrorOf(work))?.code;
}

async function databaseErrorOf(
  work: Promise<unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof pg.DatabaseError
      ? { code: error.code ?? '', message: error.message }
      : { code: String(error), message: String(error) };
  }
}

describe('the AI provider layer and suggestion store', () => {
  let harness: ApiHarness;
  let runner: JobRunner;
  let keys: KeyService;
  const network = new StandInProviderNetwork();
  let localAnswer = JSON.stringify({ title: scriptedTitle, confidence: 0.75 });
  let buyerA: IssuedToken;
  let qualityA: IssuedToken;
  let approverA: IssuedToken;
  const logged: string[] = [];

  beforeAll(async () => {
    const captured = (chunk: unknown): boolean => {
      logged.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(captured);
    vi.spyOn(process.stderr, 'write').mockImplementation(captured);
    harness = await startApiHarness({
      aiWorker: true,
      process: {
        registry: aiTestRegistry,
        jobs: aiTestJobs,
        workers: false,
        aiNetwork: network,
        aiLocalResponder: () => localAnswer,
        suggestionTargets: testSuggestionTargets,
      },
    });
    runner = harness.api.app.get(JobRunner);
    keys = harness.api.app.get<KeyService>(keyService);
    buyerA = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    qualityA = await harness.issue('staff_session', harness.tenantA, { roles: ['quality_engineer'] });
    approverA = await harness.issue('staff_session', harness.tenantA, { roles: ['approver'] });
  });

  afterAll(async () => {
    await harness.close();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localAnswer = JSON.stringify({ title: scriptedTitle, confidence: 0.75 });
    network.status = 200;
  });

  async function insertTenant(slug: string, region: 'ca' | 'eu', regionRestricted: boolean): Promise<string> {
    const result = await harness.superuser.query(
      `insert into tenants (slug, display_name, region, supplier_list_source, ai_provider, ai_region_restricted, base_currency)
       values ($1, $2, $3, 'platform', 'platform_default', $4, 'EUR') returning id`,
      [slug, `Synthetic ${slug}`, region, regionRestricted],
    );
    return idRows.parse(result.rows)[0].id;
  }

  async function insertNote(tenantId: string, title = 'Synthetic bracket'): Promise<string> {
    const result = await harness.superuser.query(
      `insert into internal_test_notes (tenant_id, title, actor_type) values ($1, $2, 'person') returning id`,
      [tenantId, title],
    );
    return idRows.parse(result.rows)[0].id;
  }

  function deliveredSuggestion(tenantId: string, noteId: string): DeliveredJob {
    return {
      id: randomUUID(),
      name: suggestTitleJob.name,
      data: { tenantId, cause: 'schedule', source: 'aiTest.manual', payload: { noteId } },
    };
  }

  async function suggestionsFor(noteId: string) {
    const result = await harness.superuser.query(
      `select id, status, provider, processing_region, configuration_source, model, base_version, decided_by
         from ai_suggestions where target_id = $1 order by created_at`,
      [noteId],
    );
    return suggestionRows.parse(result.rows);
  }

  async function auditEntries(tenantId: string, event: string) {
    const result = await harness.superuser.query(
      `select actor_type, actor_id, acted_under, payload, canonical from audit_entries
        where tenant_id = $1 and payload ->> 'event' = $2 order by seq`,
      [tenantId, event],
    );
    return auditRows.parse(result.rows);
  }

  async function noteOf(noteId: string) {
    return noteRows.parse(
      (await harness.superuser.query(`select title, version from internal_test_notes where id = $1`, [noteId])).rows,
    )[0];
  }

  /** A pending suggestion for a new note of tenant A, from the platform default's local model. */
  async function pendingSuggestion(): Promise<{ readonly noteId: string; readonly suggestionId: string }> {
    const noteId = await insertNote(harness.tenantA);
    await runner.run(deliveredSuggestion(harness.tenantA, noteId));
    const [suggestion] = await suggestionsFor(noteId);
    if (suggestion === undefined) {
      throw new Error('No suggestion was stored');
    }
    return { noteId, suggestionId: suggestion.id };
  }

  describe('the AI worker role', () => {
    it('pl_ai_worker cannot UPDATE a domain table, read suggestions, or change the audit chain', async () => {
      const noteId = await insertNote(harness.tenantA);
      const worker = await harness.database.connect('pl_ai_worker');
      try {
        const asWorker = async (statement: string, values: unknown[] = []) => {
          await worker.query('begin');
          try {
            await worker.query(`select set_config('app.tenant_id', $1, true)`, [harness.tenantA]);
            return await worker.query(statement, values);
          } finally {
            await worker.query('rollback');
          }
        };
        expect(
          await errorCodeOf(asWorker(`update tenants set display_name = 'Changed' where id = $1`, [harness.tenantA])),
        ).toBe('42501');
        expect(
          await errorCodeOf(asWorker(`update internal_test_notes set title = 'Changed' where id = $1`, [noteId])),
        ).toBe('42501');
        expect(await errorCodeOf(asWorker(`update ai_suggestions set status = 'accepted'`))).toBe('42501');
        expect(await errorCodeOf(asWorker(`select id from ai_suggestions`))).toBe('42501');
        expect(await errorCodeOf(asWorker(`select payload from audit_entries`))).toBe('42501');
        expect(await errorCodeOf(asWorker(`delete from audit_entries`))).toBe('42501');
        expect(await errorCodeOf(asWorker(`select sealed_secret from tenant_ai_keys`))).toBe('42501');
        expect(
          await errorCodeOf(
            asWorker(`insert into internal_test_notes (tenant_id, title, actor_type) values ($1, 'x', 'ai_agent')`, [
              harness.tenantA,
            ]),
          ),
        ).toBe('42501');
      } finally {
        await worker.end();
      }
    });

    it('cannot store a suggestion that is already decided', async () => {
      const worker = await harness.database.connect('pl_ai_worker');
      try {
        await worker.query('begin');
        await worker.query(`select set_config('app.tenant_id', $1, true)`, [harness.tenantA]);
        const inserted = worker.query(
          `insert into ai_suggestions (tenant_id, request_key, kind, target_type, target_entity, target_id, target_field,
             base_version, suggested_value, source_hash, confidence, model, provider, processing_region,
             configuration_source, status, created_at, decided_at, decided_by)
           values ($1, 'aiTest.decided', 'aiTest.noteTitle', 'entity_field', 'internalTestNote', $2, 'title', 1, '"x"',
             sha256('x'), 0.5, 'deterministic', 'local', 'local', 'platform', 'accepted', now(), now(), $2)`,
          [harness.tenantA, randomUUID()],
        );
        expect(await errorCodeOf(inserted)).toBe('42501');
        await worker.query('rollback');
      } finally {
        await worker.end();
      }
    });
  });

  describe('the suggestion and key guards', () => {
    async function inTenant<T>(client: pg.Client, tenantId: string, work: () => Promise<T>): Promise<T> {
      await client.query('begin');
      try {
        await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        return await work();
      } finally {
        await client.query('rollback');
      }
    }

    it('refuses to change the status of a decided suggestion, even for the app role', async () => {
      const { suggestionId } = await pendingSuggestion();
      await harness.command('staff', 'ai.rejectSuggestion', { suggestionId }, { token: buyerA.token });
      const app = await harness.database.connect('pl_app');
      try {
        const refused = await databaseErrorOf(
          inTenant(app, harness.tenantA, () =>
            app.query(`update ai_suggestions set status = 'accepted', decided_at = now() where id = $1`, [
              suggestionId,
            ]),
          ),
        );
        expect(refused?.code).toBe('42501');
        expect(refused?.message).toContain('pl.ai.suggestion_decided_once');
      } finally {
        await app.end();
      }
    });

    it('refuses to change what a pending suggestion suggests, for the app role and the owner alike', async () => {
      const { suggestionId } = await pendingSuggestion();
      const app = await harness.database.connect('pl_app');
      const owner = await harness.database.connect('pl_migrator');
      try {
        // The app role holds no UPDATE on the value at all.
        expect(
          await errorCodeOf(
            inTenant(app, harness.tenantA, () =>
              app.query(`update ai_suggestions set suggested_value = '"Changed"' where id = $1`, [suggestionId]),
            ),
          ),
        ).toBe('42501');
        // The app role may decide, but not change the value while deciding.
        const whileDeciding = await databaseErrorOf(
          inTenant(app, harness.tenantA, () =>
            app.query(
              `update ai_suggestions set status = 'accepted', decided_at = now(), decided_by = $2,
                      base_version = base_version + 1 where id = $1`,
              [suggestionId, buyerA.subjectId],
            ),
          ),
        );
        expect(whileDeciding?.code).toBe('42501');
        const byOwner = await databaseErrorOf(
          inTenant(owner, harness.tenantA, () =>
            owner.query(`update ai_suggestions set suggested_value = '"Changed"' where id = $1`, [suggestionId]),
          ),
        );
        expect(byOwner?.code).toBe('42501');
        expect(byOwner?.message).toContain('pl.ai.suggestion_decided_once');
      } finally {
        await app.end();
        await owner.end();
      }
    });

    it('refuses any change to a stored tenant key, even for the table owner', async () => {
      const tenant = await insertTenant(`key-fixed-${randomUUID().slice(0, 8)}`, 'ca', false);
      const sealed = await keys.encrypt(Buffer.from(tenantKey), encryptionContextOf(tenant, 'ai-key/fixed'));
      if (!sealed.ok) {
        throw new Error('sealing failed');
      }
      await harness.superuser.query(
        `insert into tenant_ai_keys (tenant_id, key_reference, provider, model, key_service_key_id, wrapped_data_key, sealed_secret, created_at)
         values ($1, 'ai-key/fixed', 'anthropic', 'claude-sonnet-4-5', $2, $3, $4, now())`,
        [tenant, sealed.value.keyId, sealed.value.wrappedDataKey, sealed.value.ciphertext],
      );
      const owner = await harness.database.connect('pl_migrator');
      try {
        const refused = await databaseErrorOf(
          inTenant(owner, tenant, () =>
            owner.query(`update tenant_ai_keys set model = 'claude-opus-4' where tenant_id = $1`, [tenant]),
          ),
        );
        expect(refused?.code).toBe('42501');
        expect(refused?.message).toContain('pl.ai.key_fixed');
      } finally {
        await owner.end();
      }
    });
  });

  describe('storing suggestions', () => {
    it('stores a suggestion with an ai_agent audit entry, and never its value in the chain', async () => {
      const noteId = await insertNote(harness.tenantA);
      const job = deliveredSuggestion(harness.tenantA, noteId);
      await runner.run(job);
      const [suggestion] = await suggestionsFor(noteId);
      expect(suggestion).toMatchObject({
        status: 'pending',
        provider: 'local',
        processing_region: 'local',
        configuration_source: 'platform',
        model: 'deterministic',
        base_version: 1,
        decided_by: null,
      });
      const entries = (await auditEntries(harness.tenantA, 'ai.suggestionRecorded')).filter(
        (entry) => entry.payload.data.suggestion === suggestion?.id,
      );
      expect(entries).toHaveLength(1);
      const [entry] = entries;
      expect(entry?.actor_type).toBe('ai_agent');
      expect(entry?.actor_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry?.acted_under).toMatchObject({
        grant: 'job',
        jobId: job.id,
        cause: 'schedule',
        source: 'aiTest.manual',
      });
      expect(entry?.payload.data).toMatchObject({
        targetId: noteId,
        targetField: 'title',
        baseVersion: 1,
        provider: 'local',
      });
      expect(
        z.object({ commitment: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(entry?.payload.data.value).success,
      ).toBe(true);
      expect(entry?.canonical.toString('utf8')).not.toContain(scriptedTitle);
    });

    it('stores a suggestion once however often its job is delivered', async () => {
      const noteId = await insertNote(harness.tenantA);
      await runner.run(deliveredSuggestion(harness.tenantA, noteId));
      await harness.superuser.query(`delete from job_item_outcomes where item_key = $1`, [`note:${noteId}`]);
      await runner.run(deliveredSuggestion(harness.tenantA, noteId));
      expect(await suggestionsFor(noteId)).toHaveLength(1);
    });

    it('turns model output that fails its schema into a failed item with no partial write', async () => {
      localAnswer = JSON.stringify({ title: '', confidence: 3 });
      const noteId = await insertNote(harness.tenantA);
      const before = (await auditEntries(harness.tenantA, 'ai.suggestionRecorded')).length;
      await expect(runner.run(deliveredSuggestion(harness.tenantA, noteId))).rejects.toThrow(JobItemFailedError);
      expect(await suggestionsFor(noteId)).toEqual([]);
      expect(await auditEntries(harness.tenantA, 'ai.suggestionRecorded')).toHaveLength(before);
      const outcomes = outcomeRows.parse(
        (
          await harness.superuser.query(`select status, failure from job_item_outcomes where item_key = $1`, [
            `note:${noteId}`,
          ])
        ).rows,
      );
      expect(outcomes).toEqual([{ status: 'failed', failure: 'Unprocessable.aiOutputInvalid' }]);
    });

    it('shows each suggestion labelled as AI-generated', async () => {
      const { noteId } = await pendingSuggestion();
      const response = await harness.query(
        'staff',
        'ai.suggestions',
        { targetEntity: 'internalTestNote', targetId: noteId },
        buyerA.token,
      );
      expect(response.status).toBe(200);
      const { suggestions } = z.object({ suggestions: z.array(suggestionSchema) }).parse(response.body);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({
        value: scriptedTitle,
        status: 'pending',
        disclosure: { generatedBy: 'ai', messageKey: aiDisclosureMessageKey },
      });
    });
  });

  describe('reading suggestions', () => {
    it("shows a target's suggestions only to the roles of that target", async () => {
      const noteId = await insertNote(harness.tenantA);
      const read = (entity: string, token: string) =>
        harness.query('staff', 'ai.suggestions', { targetEntity: entity, targetId: noteId }, token);
      expect((await read('internalTestNote', buyerA.token)).status).toBe(200);
      expect((await read('internalTestNoteReview', qualityA.token)).status).toBe(200);
      expect(await read('internalTestNoteReview', buyerA.token)).toMatchObject({
        status: 403,
        body: { message: 'pl.error.forbidden.notPermitted' },
      });
      expect(await read('unknownEntity', buyerA.token)).toMatchObject({
        status: 404,
        body: { message: 'pl.error.notFound.resource' },
      });
    });
  });

  describe('deciding suggestions', () => {
    it('applies an accepted suggestion and writes a person entry', async () => {
      const { noteId, suggestionId } = await pendingSuggestion();
      const response = await harness.command('staff', 'ai.acceptSuggestion', { suggestionId }, { token: buyerA.token });
      expect(response).toMatchObject({ status: 200, body: { suggestionId, status: 'accepted' } });
      expect(await noteOf(noteId)).toEqual({ title: scriptedTitle, version: 2 });
      expect((await suggestionsFor(noteId))[0]).toMatchObject({ status: 'accepted', decided_by: buyerA.subjectId });
      const decisions = (await auditEntries(harness.tenantA, 'ai.acceptSuggestion')).filter((entry) =>
        JSON.stringify(entry.payload.data).includes(suggestionId),
      );
      expect(decisions.map((entry) => [entry.actor_type, entry.actor_id])).toEqual([['person', buyerA.subjectId]]);
    });

    it('leaves the record alone when a suggestion is rejected, and writes a person entry', async () => {
      const { noteId, suggestionId } = await pendingSuggestion();
      const response = await harness.command(
        'staff',
        'ai.rejectSuggestion',
        { suggestionId },
        { token: qualityA.token },
      );
      expect(response).toMatchObject({ status: 200, body: { suggestionId, status: 'rejected' } });
      expect(await noteOf(noteId)).toEqual({ title: 'Synthetic bracket', version: 1 });
      const decisions = (await auditEntries(harness.tenantA, 'ai.rejectSuggestion')).filter((entry) =>
        JSON.stringify(entry.payload.data).includes(suggestionId),
      );
      expect(decisions.map((entry) => [entry.actor_type, entry.actor_id])).toEqual([['person', qualityA.subjectId]]);
    });

    it('returns Conflict when the record changed after the suggestion was made, and changes nothing', async () => {
      const { noteId, suggestionId } = await pendingSuggestion();
      await harness.superuser.query(
        `update internal_test_notes set title = 'Edited by a person', version = 2 where id = $1`,
        [noteId],
      );
      const response = await harness.command('staff', 'ai.acceptSuggestion', { suggestionId }, { token: buyerA.token });
      expect(response).toMatchObject({
        status: 409,
        body: { message: 'pl.error.conflict.versionMismatch', params: { expectedVersion: 1, actualVersion: 2 } },
      });
      expect(await noteOf(noteId)).toEqual({ title: 'Edited by a person', version: 2 });
      expect((await suggestionsFor(noteId))[0]?.status).toBe('pending');
    });

    it('returns Conflict when the record changes while a suggestion is being accepted', async () => {
      const { noteId, suggestionId } = await pendingSuggestion();
      betweenReadAndApply.run = async (id) => {
        await harness.superuser.query(
          `update internal_test_notes set title = 'Edited meanwhile', version = version + 1 where id = $1`,
          [id],
        );
      };
      const response = await harness.command('staff', 'ai.acceptSuggestion', { suggestionId }, { token: buyerA.token });
      expect(betweenReadAndApply.run).toBeNull();
      expect(response).toMatchObject({
        status: 409,
        body: { message: 'pl.error.conflict.versionMismatch', params: { expectedVersion: 1, actualVersion: 2 } },
      });
      expect(await noteOf(noteId)).toEqual({ title: 'Edited meanwhile', version: 2 });
      expect((await suggestionsFor(noteId))[0]?.status).toBe('pending');
    });

    it('decides a suggestion only once', async () => {
      const { suggestionId } = await pendingSuggestion();
      await harness.command('staff', 'ai.rejectSuggestion', { suggestionId }, { token: buyerA.token });
      const again = await harness.command('staff', 'ai.acceptSuggestion', { suggestionId }, { token: buyerA.token });
      expect(again).toMatchObject({ status: 409, body: { message: 'pl.error.conflict.transitionNotAllowed' } });
    });

    it('lets only the roles of the target decide, and never another tenant', async () => {
      const { suggestionId } = await pendingSuggestion();
      const approver = await harness.command(
        'staff',
        'ai.acceptSuggestion',
        { suggestionId },
        { token: approverA.token },
      );
      expect(approver.status).toBe(403);
      const buyerB = await harness.issue('staff_session', harness.tenantB, { roles: ['buyer'] });
      const otherTenant = await harness.command(
        'staff',
        'ai.acceptSuggestion',
        { suggestionId },
        { token: buyerB.token },
      );
      expect(otherTenant.status).toBe(404);
    });
  });

  describe('configuration and region policy', () => {
    it('gives a tenant restricted to the EU the region error for a non-EU provider, without calling it', async () => {
      const tenantEu = await insertTenant(`eu-restricted-${randomUUID().slice(0, 8)}`, 'eu', true);
      const admin = await harness.issue('staff_session', tenantEu, {
        roles: ['tenant_admin'],
        steppedUpAt: harness.clock.now(),
      });
      const refused = await harness.command(
        'staff',
        'ai.configureProvider',
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          resourceName: null,
          endpointRegion: null,
          apiKey: tenantKey,
          regionRestricted: true,
        },
        { token: admin.token },
      );
      expect(refused).toMatchObject({
        status: 422,
        body: {
          message: 'pl.error.unprocessable.aiRegionNotAllowed',
          params: { tenantRegion: 'eu', processingRegion: 'us' },
        },
      });

      // A configuration stored before the restriction was turned on is refused at call time.
      const reference = 'ai-key/stored-before-restriction';
      const sealed = await keys.encrypt(Buffer.from(tenantKey), encryptionContextOf(tenantEu, reference));
      if (!sealed.ok) {
        throw new Error('sealing failed');
      }
      await harness.superuser.query(
        `insert into tenant_ai_keys (tenant_id, key_reference, provider, model, key_service_key_id, wrapped_data_key, sealed_secret, created_at)
         values ($1, $2, 'anthropic', 'claude-sonnet-4-5', $3, $4, $5, now())`,
        [tenantEu, reference, sealed.value.keyId, sealed.value.wrappedDataKey, sealed.value.ciphertext],
      );
      await harness.superuser.query(
        `update tenants set ai_provider = 'anthropic', ai_key_reference = $2 where id = $1`,
        [tenantEu, reference],
      );
      const noteId = await insertNote(tenantEu);
      const requestsBefore = network.requests.length;
      const run = runner.run(deliveredSuggestion(tenantEu, noteId));
      await expect(run).rejects.toMatchObject({ failure: 'Unprocessable.aiRegionNotAllowed' });
      expect(network.requests.length).toBe(requestsBefore);
      expect(await suggestionsFor(noteId)).toEqual([]);
    });

    it('lets an unrestricted tenant use its own provider key through the provider’s fixed endpoint', async () => {
      const admin = await harness.issue('staff_session', harness.tenantB, {
        roles: ['tenant_admin'],
        steppedUpAt: harness.clock.now(),
      });
      const configured = await harness.command(
        'staff',
        'ai.configureProvider',
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          resourceName: null,
          endpointRegion: null,
          apiKey: tenantKey,
          regionRestricted: false,
        },
        { token: admin.token },
      );
      expect(configured).toMatchObject({ status: 200, body: { provider: 'anthropic', regionRestricted: false } });
      const noteId = await insertNote(harness.tenantB);
      network.answerText = JSON.stringify({ title: 'Synthetic flange, zinc plated', confidence: 0.6 });
      await runner.run(deliveredSuggestion(harness.tenantB, noteId));
      expect((await suggestionsFor(noteId))[0]).toMatchObject({
        provider: 'anthropic',
        processing_region: 'us',
        configuration_source: 'tenant',
        model: 'claude-sonnet-4-5',
      });
      const request = network.requests.at(-1);
      expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
      expect(request?.headers['x-api-key']).toBe(tenantKey);
      expect(request?.body).not.toContain('"tools"');
    });

    it('uses the platform default entirely for a partial tenant configuration, never the platform key with tenant fields', async () => {
      const tenant = await insertTenant(`partial-${randomUUID().slice(0, 8)}`, 'ca', false);
      await harness.superuser.query(
        `update tenants set ai_provider = 'mistral', ai_key_reference = 'ai-key/never-stored' where id = $1`,
        [tenant],
      );
      const noteId = await insertNote(tenant);
      const requestsBefore = network.requests.length;
      await runner.run(deliveredSuggestion(tenant, noteId));
      expect((await suggestionsFor(noteId))[0]).toMatchObject({
        provider: 'local',
        model: 'deterministic',
        configuration_source: 'platform',
      });

      // A stored key of another provider than the tenant's is just as partial.
      const reference = 'ai-key/other-provider';
      const sealed = await keys.encrypt(Buffer.from(tenantKey), encryptionContextOf(tenant, reference));
      if (!sealed.ok) {
        throw new Error('sealing failed');
      }
      await harness.superuser.query(
        `insert into tenant_ai_keys (tenant_id, key_reference, provider, model, key_service_key_id, wrapped_data_key, sealed_secret, created_at)
         values ($1, $2, 'anthropic', 'claude-sonnet-4-5', $3, $4, $5, now())`,
        [tenant, reference, sealed.value.keyId, sealed.value.wrappedDataKey, sealed.value.ciphertext],
      );
      await harness.superuser.query(`update tenants set ai_key_reference = $2 where id = $1`, [tenant, reference]);
      const secondNote = await insertNote(tenant);
      await runner.run(deliveredSuggestion(tenant, secondNote));
      expect((await suggestionsFor(secondNote))[0]).toMatchObject({
        provider: 'local',
        configuration_source: 'platform',
      });
      expect(network.requests.length).toBe(requestsBefore);
    });

    it("never falls back to the platform when a tenant's stored key cannot be decrypted", async () => {
      const tenant = await insertTenant(`undecryptable-${randomUUID().slice(0, 8)}`, 'ca', false);
      const reference = 'ai-key/undecryptable';
      // Sealed for another reference, so the key service cannot open it for this one.
      const sealed = await keys.encrypt(Buffer.from(tenantKey), encryptionContextOf(tenant, 'ai-key/elsewhere'));
      if (!sealed.ok) {
        throw new Error('sealing failed');
      }
      await harness.superuser.query(
        `insert into tenant_ai_keys (tenant_id, key_reference, provider, model, key_service_key_id, wrapped_data_key, sealed_secret, created_at)
         values ($1, $2, 'anthropic', 'claude-sonnet-4-5', $3, $4, $5, now())`,
        [tenant, reference, sealed.value.keyId, sealed.value.wrappedDataKey, sealed.value.ciphertext],
      );
      await harness.superuser.query(
        `update tenants set ai_provider = 'anthropic', ai_key_reference = $2 where id = $1`,
        [tenant, reference],
      );
      const noteId = await insertNote(tenant);
      const requestsBefore = network.requests.length;
      await expect(runner.run(deliveredSuggestion(tenant, noteId))).rejects.toMatchObject({
        failure: 'Unavailable.dependencyUnavailable',
      });
      expect(await suggestionsFor(noteId)).toEqual([]);
      expect(network.requests.length).toBe(requestsBefore);
    });

    it('never shows a tenant key in logs, API responses, the audit chain or the stored row', async () => {
      const tenant = await insertTenant(`key-leak-${randomUUID().slice(0, 8)}`, 'ca', false);
      const admin = await harness.issue('staff_session', tenant, {
        roles: ['tenant_admin'],
        steppedUpAt: harness.clock.now(),
      });
      const input = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        resourceName: null,
        endpointRegion: null,
        apiKey: tenantKey,
        regionRestricted: false,
      };
      const responses = [
        await harness.command('staff', 'ai.configureProvider', input, { token: admin.token }),
        await harness.command(
          'staff',
          'ai.configureProvider',
          { ...input, model: 'Not A Model' },
          { token: admin.token },
        ),
        await harness.command('staff', 'ai.configureProvider', input, {
          token: (await harness.issue('staff_session', tenant, { roles: ['tenant_admin'] })).token,
        }),
        await harness.query('staff', 'ai.settings', {}, admin.token),
      ];
      expect(responses.map((response) => response.status)).toEqual([200, 400, 401, 200]);
      expect(responses[3]?.body).toMatchObject({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        keyConfigured: true,
        effective: { source: 'tenant', provider: 'anthropic', processingRegion: 'us', allowed: true },
      });

      // A provider that refuses the call, and one that answers outside the schema.
      const noteId = await insertNote(tenant);
      network.status = 401;
      await expect(runner.run(deliveredSuggestion(tenant, noteId))).rejects.toMatchObject({
        failure: 'Unavailable.dependencyUnavailable',
      });

      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain(tenantKey);
        expect(JSON.stringify(Object.fromEntries(response.headers.entries()))).not.toContain(tenantKey);
      }
      expect(logged.join('')).not.toContain(tenantKey);
      const stored = await harness.superuser.query(
        `select sealed_secret, wrapped_data_key from tenant_ai_keys where tenant_id = $1`,
        [tenant],
      );
      for (const row of z
        .array(z.object({ sealed_secret: z.instanceof(Buffer), wrapped_data_key: z.instanceof(Buffer) }))
        .parse(stored.rows)) {
        expect(row.sealed_secret.includes(Buffer.from(tenantKey))).toBe(false);
        expect(row.wrapped_data_key.includes(Buffer.from(tenantKey))).toBe(false);
      }
      const chain = await harness.superuser.query(`select canonical from audit_entries where tenant_id = $1`, [tenant]);
      for (const row of z.array(z.object({ canonical: z.instanceof(Buffer) })).parse(chain.rows)) {
        expect(row.canonical.includes(Buffer.from(tenantKey))).toBe(false);
      }
      const configurations = await auditEntries(tenant, 'ai.configureProvider');
      expect(configurations.map((entry) => entry.actor_type)).toEqual(['person']);
      const idempotency = await harness.superuser.query(`select * from idempotency_keys where tenant_id = $1`, [
        tenant,
      ]);
      expect(JSON.stringify(idempotency.rows)).not.toContain(tenantKey);
    });
  });
});
