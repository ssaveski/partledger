import { randomUUID } from 'node:crypto';

import { correlationIdHeader } from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { verifyTenantChain } from '../src/audit/chain-verifier';
import { OperationExecutor, type Outcome } from '../src/commands/operation-executor';
import { TenantTransactions } from '../src/db/tenant-transaction';
import type { AuthenticatedPrincipal } from '../src/principals/principal';
import { internalTestRegistry } from './support/internal-test-module';
import { newIdempotencyKey, startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';

const createdNote = z.object({ noteId: z.uuid(), version: z.number().int() });

const entryRows = z.array(
  z.object({
    seq: z.coerce.number(),
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    acted_under: z.unknown(),
    correlation_id: z.string(),
    payload: z.object({
      event: z.string(),
      adapter: z.string(),
      correlationId: z.string(),
      data: z.object({ output: z.unknown(), changes: z.array(z.unknown()) }),
    }),
  }),
);

/** What one command did to the tenant's chain. */
interface Audited {
  readonly outcome: Outcome['kind'];
  readonly entries: z.infer<typeof entryRows>;
}

describe('the audit entry of every command', () => {
  let harness: ApiHarness;
  let executor: OperationExecutor;
  let buyer: IssuedToken;
  let tenantAdmin: IssuedToken;
  let approver: IssuedToken;
  let supplier: IssuedToken;

  beforeAll(async () => {
    harness = await startApiHarness();
    executor = harness.api.app.get(OperationExecutor);
    buyer = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    tenantAdmin = await harness.issue('staff_session', harness.tenantA, { roles: ['tenant_admin'] });
    approver = await harness.issue('staff_session', harness.tenantA, { roles: ['approver'] });
    supplier = await harness.issue('supplier_link', harness.tenantA);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function chainLength(): Promise<number> {
    return harness.count('select 1 from audit_entries where tenant_id = $1', [harness.tenantA]);
  }

  async function entriesAfter(seq: number) {
    const result = await harness.superuser.query(
      `select seq, actor_type, actor_id, acted_under, correlation_id, payload
         from audit_entries where tenant_id = $1 and seq > $2 order by seq`,
      [harness.tenantA, seq],
    );
    return entryRows.parse(result.rows);
  }

  async function audited(work: () => Promise<Outcome['kind']>): Promise<Audited> {
    const before = await chainLength();
    const outcome = await work();
    return { outcome, entries: await entriesAfter(before) };
  }

  async function overHttp(name: string, body: unknown, token: string, idempotencyKey?: string) {
    const response = await harness.command(
      'staff',
      name,
      body,
      idempotencyKey === undefined ? { token } : { token, idempotencyKey },
    );
    return response;
  }

  async function newNote(): Promise<string> {
    const response = await overHttp(
      'internalTest.createNote',
      { title: 'Synthetic audited bracket' },
      buyer.token,
      newIdempotencyKey(),
    );
    return createdNote.parse(response.body).noteId;
  }

  function steppedUpApprover(): AuthenticatedPrincipal {
    return {
      type: 'person',
      tenantId: harness.tenantA,
      userId: approver.subjectId,
      stepUp: { level: 'step-up', authenticatedAt: harness.clock.now() },
      actedUnder: { grant: 'staff_session', credentialId: approver.credentialId },
      adapter: 'staff',
      correlationId: randomUUID(),
    };
  }

  const jobPrincipal: AuthenticatedPrincipal = {
    type: 'system',
    tenantId: '00000000-0000-4000-8000-000000000000',
    actedUnder: { grant: 'job', jobId: randomUUID(), cause: 'schedule', source: 'internalTest.nightly' },
    adapter: 'jobs',
    correlationId: randomUUID(),
  };

  /** One run of each state-changing command in the test module, and how many entries it must append. */
  const samples: Record<string, { readonly expectedEntries: 0 | 1; run(): Promise<Outcome['kind']> }> = {
    'internalTest.createNote': {
      expectedEntries: 1,
      async run() {
        const response = await overHttp(
          'internalTest.createNote',
          { title: 'Synthetic gasket' },
          buyer.token,
          newIdempotencyKey(),
        );
        return response.status === 200 ? 'success' : 'failure';
      },
    },
    'internalTest.createNoteThenRefuse': {
      expectedEntries: 0,
      async run() {
        const response = await overHttp(
          'internalTest.createNoteThenRefuse',
          { title: 'Synthetic refused' },
          buyer.token,
        );
        return response.status === 200 ? 'success' : 'failure';
      },
    },
    'internalTest.renameNote': {
      expectedEntries: 1,
      async run() {
        const noteId = await newNote();
        const response = await overHttp(
          'internalTest.renameNote',
          { noteId, title: 'Synthetic renamed gasket', expectedVersion: 1 },
          buyer.token,
        );
        return response.status === 200 ? 'success' : 'failure';
      },
    },
    'internalTest.approveNote': {
      expectedEntries: 1,
      async run() {
        const noteId = await newNote();
        const outcome = await executor.runCommand(
          steppedUpApprover(),
          'internalTest.approveNote',
          { noteId, expectedVersion: 1 },
          newIdempotencyKey(),
        );
        return outcome.kind;
      },
    },
    'internalTest.setRetention': {
      expectedEntries: 1,
      async run() {
        const response = await overHttp('internalTest.setRetention', { days: 30 }, tenantAdmin.token);
        return response.status === 200 ? 'success' : 'failure';
      },
    },
    'internalTest.recordJobRun': {
      expectedEntries: 1,
      async run() {
        const outcome = await executor.runCommand(
          { ...jobPrincipal, tenantId: harness.tenantA },
          'internalTest.recordJobRun',
          { title: 'Synthetic job note' },
          undefined,
        );
        return outcome.kind;
      },
    },
  };

  it('has a sample for every command in the test module', () => {
    expect(Object.keys(samples).sort()).toEqual(
      internalTestRegistry.commands.map((registration) => registration.declaration.name).sort(),
    );
  });

  it.each(Object.keys(samples))(
    '%s appends exactly one entry when it succeeds and none when it fails',
    async (name) => {
      const sample = samples[name];
      if (sample === undefined) {
        throw new Error(`No sample for ${name}`);
      }
      // Arrange first: helpers such as newNote append entries of their own.
      const before = await chainLength();
      const result = await sample.run();
      const entries = (await entriesAfter(before)).filter((entry) => entry.payload.event === name);
      expect(result).toBe(sample.expectedEntries === 1 ? 'success' : 'failure');
      expect(entries).toHaveLength(sample.expectedEntries);
    },
  );

  it('records the principal, its grant, the listener and the correlation id of the request', async () => {
    const before = await chainLength();
    const response = await overHttp(
      'internalTest.createNote',
      { title: 'Synthetic flange' },
      buyer.token,
      newIdempotencyKey(),
    );
    const { noteId } = createdNote.parse(response.body);
    const [entry, ...others] = await entriesAfter(before);
    const { commitment } = z
      .tuple([z.object({ commitment: z.string() })])
      .parse(
        (
          await harness.superuser.query(
            `select encode(commitment, 'hex') as commitment from commitments where value = 'Synthetic flange'`,
          )
        ).rows,
      )[0];
    expect(others).toEqual([]);
    expect(entry).toEqual({
      seq: before + 1,
      actor_type: 'person',
      actor_id: buyer.subjectId,
      acted_under: { grant: 'staff_session', credentialId: buyer.credentialId },
      correlation_id: response.headers.get(correlationIdHeader),
      payload: {
        event: 'internalTest.createNote',
        adapter: 'staff',
        correlationId: response.headers.get(correlationIdHeader),
        data: {
          output: { noteId, version: 1 },
          changes: [{ kind: 'noteCreated', noteId, title: { commitment } }],
        },
      },
    });
    expect(await harness.count(`select 1 from audit_entries where payload::text like '%Synthetic flange%'`)).toBe(0);
    expect(await harness.count(`select 1 from commitments where value = 'Synthetic flange'`)).toBe(1);
  });

  it('records a supplier token and a background job as their own actor types', async () => {
    const fromSupplier = await audited(async () => {
      const response = await harness.command(
        'portal',
        'internalTest.createNote',
        { title: 'Synthetic washer' },
        { token: supplier.token, idempotencyKey: newIdempotencyKey() },
      );
      return response.status === 200 ? 'success' : 'failure';
    });
    expect(fromSupplier).toMatchObject({
      outcome: 'success',
      entries: [
        {
          actor_type: 'supplier_token',
          actor_id: supplier.subjectId,
          acted_under: { grant: 'supplier_link', credentialId: supplier.credentialId },
          payload: { adapter: 'portal' },
        },
      ],
    });
    const jobId = randomUUID();
    const fromJob = await audited(async () => {
      const outcome = await executor.runCommand(
        {
          ...jobPrincipal,
          tenantId: harness.tenantA,
          actedUnder: { grant: 'job', jobId, cause: 'command', source: 'internalTest.createNote' },
        },
        'internalTest.recordJobRun',
        { title: 'Synthetic nightly note' },
        undefined,
      );
      return outcome.kind;
    });
    expect(fromJob.entries).toMatchObject([
      {
        actor_type: 'system',
        actor_id: null,
        acted_under: { grant: 'job', jobId, cause: 'command', source: 'internalTest.createNote' },
        payload: { adapter: 'jobs' },
      },
    ]);
  });

  it('records an applied transition in the command entry', async () => {
    const noteId = await newNote();
    const approval = await audited(async () => {
      const outcome = await executor.runCommand(
        steppedUpApprover(),
        'internalTest.approveNote',
        { noteId, expectedVersion: 1 },
        newIdempotencyKey(),
      );
      return outcome.kind;
    });
    expect(approval.outcome).toBe('success');
    expect(approval.entries).toHaveLength(1);
    expect(approval.entries[0]?.payload.data.changes).toEqual([
      { kind: 'transition', aggregate: 'note', id: noteId, transition: 'approve', from: 'draft', to: 'approved' },
    ]);
  });

  it('appends nothing for an idempotent replay or a query', async () => {
    const idempotencyKey = newIdempotencyKey();
    await overHttp('internalTest.createNote', { title: 'Synthetic replayed nut' }, buyer.token, idempotencyKey);
    const replay = await audited(async () => {
      const response = await overHttp(
        'internalTest.createNote',
        { title: 'Synthetic replayed nut' },
        buyer.token,
        idempotencyKey,
      );
      return response.status === 200 ? 'success' : 'failure';
    });
    expect(replay).toEqual({ outcome: 'success', entries: [] });
    const noteId = await newNote();
    const query = await audited(async () => {
      const response = await harness.query('staff', 'internalTest.getNote', { noteId }, buyer.token);
      return response.status === 200 ? 'success' : 'failure';
    });
    expect(query).toEqual({ outcome: 'success', entries: [] });
  });

  it('leaves the tenant chain verifying after all of the above', async () => {
    const transactions = harness.api.app.get(TenantTransactions);
    const verification = await transactions.run(harness.tenantA, (database) =>
      verifyTenantChain(database, harness.tenantA),
    );
    expect(verification).toMatchObject({ ok: true, length: await chainLength() });
  });
});
