import { randomUUID } from 'node:crypto';

import { defineTransitions } from '@partledger/domain';
import { insertTenant, startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { auditId, auditToken, UnsafeAuditPayloadError } from '../src/audit/audit-payload';
import { appendAuditEntry, readChainHead, type AppendedEntry, type AuditActor } from '../src/audit/audit-writer';
import { verifyTenantChain } from '../src/audit/chain-verifier';
import { CommandAudit } from '../src/audit/command-audit';
import { commitValue, eraseCommitment, revealCommitment } from '../src/audit/commitments';
import type { Clock } from '../src/time/clock';
import { applyTransition } from '../src/transitions/apply-transition';

const countRows = z.tuple([z.object({ count: z.coerce.number() })]);

const systemClock: Clock = { now: () => new Date() };

const sampleEvent = auditToken('internalTest.sample');

function personActor(): AuditActor {
  return {
    type: 'person',
    id: randomUUID(),
    actedUnder: { grant: 'staff_session', credentialId: randomUUID() },
    adapter: 'staff',
    correlationId: randomUUID(),
  };
}

function supplierActor(): AuditActor {
  return {
    type: 'supplier_token',
    id: randomUUID(),
    actedUnder: { grant: 'supplier_link', credentialId: randomUUID() },
    adapter: 'portal',
    correlationId: randomUUID(),
  };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** The messages of an error and its causes: Drizzle wraps the database error as the cause. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause === undefined ? error.message : `${error.message}: ${describeError(error.cause)}`;
}

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return describeError(error);
  }
  throw new Error('The work was expected to fail');
}

type Database = NodePgDatabase;

/** An open tenant transaction on one pooled connection, committed or rolled back by the test. */
interface OpenTransaction {
  readonly database: Database;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

async function openTransaction(pool: pg.Pool, tenantId: string): Promise<OpenTransaction> {
  const client = await pool.connect();
  await client.query('begin');
  await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
  const finish = async (statement: 'commit' | 'rollback') => {
    try {
      await client.query(statement);
    } finally {
      client.release();
    }
  };
  return { database: drizzle({ client }), commit: () => finish('commit'), rollback: () => finish('rollback') };
}

async function inTenant<T>(pool: pg.Pool, tenantId: string, work: (database: Database) => Promise<T>): Promise<T> {
  const transaction = await openTransaction(pool, tenantId);
  try {
    const result = await work(transaction.database);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

describe('the audit chain', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let appPool: pg.Pool;
  let portalPool: pg.Pool;
  let aiWorkerPool: pg.Pool;
  let verifierPool: pg.Pool;
  let migratorPool: pg.Pool;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    appPool = database.pool('pl_app', { max: 6 });
    portalPool = database.pool('pl_portal', { max: 2 });
    aiWorkerPool = database.pool('pl_ai_worker', { max: 2 });
    verifierPool = database.pool('pl_verifier', { max: 2 });
    migratorPool = database.pool('pl_migrator', { max: 2 });
  });

  afterAll(async () => {
    await Promise.all([appPool.end(), portalPool.end(), aiWorkerPool.end(), verifierPool.end(), migratorPool.end()]);
    await superuser.end();
    await database.stop();
  });

  let tenantCount = 0;
  function newTenant(): Promise<string> {
    tenantCount += 1;
    return insertTenant(superuser, `audit-tenant-${tenantCount}`);
  }

  function append(
    pool: pg.Pool,
    tenantId: string,
    version: number,
    clock: Clock = systemClock,
    actor: AuditActor = personActor(),
  ): Promise<AppendedEntry> {
    return inTenant(pool, tenantId, (transaction) =>
      appendAuditEntry(
        transaction,
        { tenantId, actor, event: sampleEvent, data: { output: { noteId: auditId(randomUUID()), version } } },
        clock,
      ),
    );
  }

  async function appendMany(tenantId: string, count: number): Promise<AppendedEntry[]> {
    const entries: AppendedEntry[] = [];
    for (let version = 1; version <= count; version += 1) {
      entries.push(await append(appPool, tenantId, version));
    }
    return entries;
  }

  function verify(tenantId: string) {
    return inTenant(verifierPool, tenantId, (transaction) => verifyTenantChain(transaction, tenantId));
  }

  /** Changes the chain as a superuser would, with the guard triggers disabled for the change only. */
  async function tamper(statements: readonly string[], values: unknown[]): Promise<void> {
    await superuser.query('begin');
    try {
      await superuser.query('alter table audit_entries disable trigger audit_entries_refuse_update_delete');
      for (const statement of statements) {
        await superuser.query(statement, values);
      }
      await superuser.query('alter table audit_entries enable always trigger audit_entries_refuse_update_delete');
      await superuser.query('commit');
    } catch (error) {
      await superuser.query('rollback');
      throw error;
    }
  }

  async function count(text: string, values: unknown[]): Promise<number> {
    return countRows.parse(
      (await superuser.query(`select count(*) as count from (${text}) as counted`, values)).rows,
    )[0].count;
  }

  describe('appends', () => {
    it('start from the genesis constant and chain each entry to the one before it', async () => {
      const tenantId = await newTenant();
      const [first, second] = await appendMany(tenantId, 2);
      expect(first?.seq).toBe(1);
      expect(second?.seq).toBe(2);
      const links = z.array(z.object({ seq: z.coerce.number(), prev_hash: z.string(), entry_hash: z.string() })).parse(
        (
          await superuser.query(
            `select seq, encode(prev_hash, 'hex') as prev_hash, encode(entry_hash, 'hex') as entry_hash
                 from audit_entries where tenant_id = $1 order by seq`,
            [tenantId],
          )
        ).rows,
      );
      expect(links).toEqual([
        { seq: 1, prev_hash: '0'.repeat(64), entry_hash: first?.entryHash },
        { seq: 2, prev_hash: first?.entryHash, entry_hash: second?.entryHash },
      ]);
      expect(await verify(tenantId)).toEqual({
        ok: true,
        length: 2,
        head: { seq: 2, entryHash: second?.entryHash, time: second?.time },
      });
    });

    it('two concurrent appends for one tenant produce n and n+1, the second chained to the first', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      const holder = await openTransaction(appPool, tenantId);
      const first = await appendAuditEntry(
        holder.database,
        { tenantId, actor: personActor(), event: sampleEvent, data: { output: { version: 2 } } },
        systemClock,
      );
      let secondSettled = false;
      const second = append(appPool, tenantId, 3).finally(() => {
        secondSettled = true;
      });
      await pause(300);
      expect(secondSettled).toBe(false);
      await holder.commit();
      const appended = await second;
      expect(first.seq).toBe(2);
      expect(appended.seq).toBe(3);
      const link = z
        .tuple([z.object({ prev_hash: z.string() })])
        .parse(
          (
            await superuser.query(
              `select encode(prev_hash, 'hex') as prev_hash from audit_entries where tenant_id = $1 and seq = 3`,
              [tenantId],
            )
          ).rows,
        );
      expect(link[0].prev_hash).toBe(first.entryHash);
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 3 });
    });

    it('a rolled-back append leaves no gap in the sequence numbers', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      const abandoned = await openTransaction(appPool, tenantId);
      const rolledBack = await appendAuditEntry(
        abandoned.database,
        { tenantId, actor: personActor(), event: sampleEvent, data: { output: { version: 2 } } },
        systemClock,
      );
      await abandoned.rollback();
      const next = await append(appPool, tenantId, 2);
      expect(rolledBack.seq).toBe(2);
      expect(next.seq).toBe(2);
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 2 });
    });

    it('appends for different tenants do not block each other', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      const holder = await openTransaction(appPool, tenantA);
      await appendAuditEntry(
        holder.database,
        { tenantId: tenantA, actor: personActor(), event: sampleEvent, data: { output: { version: 1 } } },
        systemClock,
      );
      try {
        const other = await Promise.race([append(appPool, tenantB, 1), pause(5_000).then(() => 'blocked' as const)]);
        expect(other).toMatchObject({ tenantId: tenantB, seq: 1 });
      } finally {
        await holder.commit();
      }
    });

    it('take the time after the lock and never let it run backwards along the chain', async () => {
      const tenantId = await newTenant();
      const later: Clock = { now: () => new Date('2031-01-01T00:00:00.000Z') };
      const earlier: Clock = { now: () => new Date('2030-12-31T23:59:59.000Z') };
      const first = await append(appPool, tenantId, 1, later);
      const second = await append(appPool, tenantId, 2, earlier);
      expect(first.time).toBe('2031-01-01T00:00:00.000Z');
      expect(second.time).toBe('2031-01-01T00:00:00.000Z');
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 2 });
    });

    it('record the actor type, actor, grant and correlation id of every entry', async () => {
      const tenantId = await newTenant();
      const actor = supplierActor();
      await append(appPool, tenantId, 1, systemClock, actor);
      const stored = z
        .tuple([
          z.object({
            actor_type: z.string(),
            actor_id: z.string().nullable(),
            acted_under: z.unknown(),
            correlation_id: z.string(),
            payload: z.unknown(),
          }),
        ])
        .parse(
          (
            await superuser.query(
              `select actor_type, actor_id, acted_under, correlation_id, payload from audit_entries where tenant_id = $1`,
              [tenantId],
            )
          ).rows,
        );
      const { noteId } = z
        .object({ data: z.object({ output: z.object({ noteId: z.uuid() }) }) })
        .parse(stored[0].payload).data.output;
      expect(stored[0]).toEqual({
        actor_type: 'supplier_token',
        actor_id: actor.id,
        acted_under: actor.actedUnder,
        correlation_id: actor.correlationId,
        payload: {
          event: sampleEvent,
          adapter: 'portal',
          correlationId: actor.correlationId,
          data: { output: { noteId, version: 1 } },
        },
      });
    });
  });

  describe('insert-only tables', () => {
    it('refuse UPDATE, DELETE and TRUNCATE on audit entries for pl_app, through its grants', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      for (const statement of [
        `update audit_entries set correlation_id = 'changed'`,
        'delete from audit_entries',
        'truncate audit_entries',
      ]) {
        expect(await failureOf(inTenant(appPool, tenantId, (transaction) => transaction.execute(statement)))).toMatch(
          /permission denied/,
        );
      }
    });

    it('refuse UPDATE, DELETE and TRUNCATE on audit entries for the owner, through the triggers', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      for (const statement of [
        `update audit_entries set correlation_id = 'changed'`,
        'delete from audit_entries',
        'truncate audit_entries',
      ]) {
        expect(
          await failureOf(inTenant(migratorPool, tenantId, (transaction) => transaction.execute(statement))),
        ).toMatch(/pl\.audit\.insert_only/);
      }
      expect(await count('select 1 from audit_entries where tenant_id = $1', [tenantId])).toBe(1);
    });

    it('allow a commitment only to be erased, for pl_app and the owner alike', async () => {
      const tenantId = await newTenant();
      await inTenant(appPool, tenantId, (transaction) =>
        commitValue(transaction, { tenantId, value: 'Synthetic Guarded Value', now: new Date() }),
      );
      expect(
        await failureOf(inTenant(appPool, tenantId, (transaction) => transaction.execute('delete from commitments'))),
      ).toMatch(/permission denied/);
      expect(
        await failureOf(
          inTenant(appPool, tenantId, (transaction) =>
            transaction.execute(`update commitments set value = 'Replaced'`),
          ),
        ),
      ).toMatch(/pl\.audit\.erase_only/);
      for (const statement of [
        'delete from commitments',
        `update commitments set created_at = created_at - interval '1 day'`,
        'truncate commitments',
      ]) {
        expect(
          await failureOf(inTenant(migratorPool, tenantId, (transaction) => transaction.execute(statement))),
        ).toMatch(/pl\.audit\.(erase_only|insert_only)/);
      }
      expect(await count(`select 1 from commitments where value = 'Synthetic Guarded Value'`, [])).toBe(1);
    });
  });

  describe('restricted appenders', () => {
    it('let pl_portal and pl_ai_worker append and commit values, reading only the chain head', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      const fromPortal = await append(portalPool, tenantId, 2, systemClock, supplierActor());
      const fromWorker = await inTenant(aiWorkerPool, tenantId, async (transaction) => {
        const commitment = await commitValue(transaction, {
          tenantId,
          value: 'Synthetic suggested reason',
          now: new Date(),
        });
        return appendAuditEntry(
          transaction,
          {
            tenantId,
            actor: {
              type: 'ai_agent',
              id: randomUUID(),
              actedUnder: { grant: 'job', jobId: randomUUID(), cause: 'schedule', source: 'internalTest.nightly' },
              adapter: 'jobs',
              correlationId: randomUUID(),
            },
            event: auditToken('internalTest.suggestion'),
            data: { reason: commitment },
          },
          systemClock,
        );
      });
      expect([fromPortal.seq, fromWorker.seq]).toEqual([2, 3]);
      expect(await inTenant(portalPool, tenantId, (transaction) => readChainHead(transaction, tenantId))).toEqual({
        seq: 3,
        entryHash: fromWorker.entryHash,
        time: fromWorker.time,
      });
      for (const pool of [portalPool, aiWorkerPool]) {
        for (const statement of [
          'select payload from audit_entries',
          'select canonical from audit_entries',
          'select value from commitments',
        ]) {
          expect(await failureOf(inTenant(pool, tenantId, (transaction) => transaction.execute(statement)))).toMatch(
            /permission denied/,
          );
        }
      }
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 3 });
    });

    it('keep pl_verifier read-only', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 1);
      expect(await failureOf(append(verifierPool, tenantId, 2))).toMatch(/permission denied/);
      expect(
        await failureOf(
          inTenant(verifierPool, tenantId, (transaction) => transaction.execute('select value from commitments')),
        ),
      ).toMatch(/permission denied/);
    });

    it('keep one tenant from appending to another tenant chain', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      expect(
        await failureOf(
          inTenant(appPool, tenantA, (transaction) =>
            appendAuditEntry(
              transaction,
              { tenantId: tenantB, actor: personActor(), event: sampleEvent, data: {} },
              systemClock,
            ),
          ),
        ),
      ).toMatch(/row-level security/);
      expect(await count('select 1 from audit_entries where tenant_id = $1', [tenantB])).toBe(0);
    });
  });

  describe('personal and free-text values', () => {
    it('a payload with a raw name or any other free string is refused and nothing is appended', async () => {
      const tenantId = await newTenant();
      const freeText: string = 'Synthetic free text';
      await expect(
        inTenant(appPool, tenantId, (transaction) =>
          appendAuditEntry(
            transaction,
            {
              tenantId,
              actor: personActor(),
              event: sampleEvent,
              // @ts-expect-error A plain string is refused under any key.
              data: { title: freeText },
            },
            systemClock,
          ),
        ),
      ).rejects.toThrow(UnsafeAuditPayloadError);
      await expect(
        inTenant(appPool, tenantId, (transaction) =>
          appendAuditEntry(
            transaction,
            { tenantId, actor: { ...personActor(), correlationId: freeText }, event: sampleEvent, data: {} },
            systemClock,
          ),
        ),
      ).rejects.toThrow();
      await expect(
        inTenant(appPool, tenantId, (transaction) =>
          appendAuditEntry(
            transaction,
            {
              tenantId,
              actor: personActor(),
              event: sampleEvent,
              // @ts-expect-error A personal field must hold a commitment, never the raw value.
              data: { contactName: 'Synthetic Person' },
            },
            systemClock,
          ),
        ),
      ).rejects.toThrow(UnsafeAuditPayloadError);
      await expect(
        inTenant(appPool, tenantId, (transaction) =>
          appendAuditEntry(
            transaction,
            {
              tenantId,
              actor: personActor(),
              event: sampleEvent,
              // @ts-expect-error Nested personal fields are checked too.
              data: { changes: [{ kind: 'void', justification: 'Synthetic free text' }] },
            },
            systemClock,
          ),
        ),
      ).rejects.toThrow(UnsafeAuditPayloadError);
      expect(await count('select 1 from audit_entries where tenant_id = $1', [tenantId])).toBe(0);
    });

    it('erasing a commitment salt and value leaves the chain verifying', async () => {
      const tenantId = await newTenant();
      const commitment = await inTenant(appPool, tenantId, async (transaction) => {
        const committed = await commitValue(transaction, {
          tenantId,
          value: 'Synthetic Contact Person',
          now: new Date(),
        });
        await appendAuditEntry(
          transaction,
          { tenantId, actor: personActor(), event: sampleEvent, data: { contactName: committed } },
          systemClock,
        );
        return committed;
      });
      await appendMany(tenantId, 1);
      expect(
        await inTenant(appPool, tenantId, (transaction) => revealCommitment(transaction, tenantId, commitment)),
      ).toEqual({ state: 'present', value: 'Synthetic Contact Person' });

      const erased = await inTenant(appPool, tenantId, (transaction) =>
        eraseCommitment(transaction, tenantId, commitment, new Date()),
      );
      expect(erased).toBe(true);
      expect(
        await inTenant(appPool, tenantId, (transaction) => revealCommitment(transaction, tenantId, commitment)),
      ).toEqual({ state: 'erased' });
      expect(
        await inTenant(appPool, tenantId, (transaction) =>
          eraseCommitment(transaction, tenantId, commitment, new Date()),
        ),
      ).toBe(false);
      expect(await count(`select 1 from commitments where value = 'Synthetic Contact Person'`, [])).toBe(0);
      expect(
        await count(`select 1 from audit_entries where convert_from(canonical, 'UTF8') like '%Synthetic Contact%'`, []),
      ).toBe(0);
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 2 });
    });
  });

  describe('verification', () => {
    it('detects a modified payload column, naming its sequence number', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 5);
      await tamper(
        [
          `update audit_entries set payload = jsonb_set(payload, '{data,output,version}', '99')
            where tenant_id = $1 and seq = 3`,
        ],
        [tenantId],
      );
      expect(await verify(tenantId)).toEqual({ ok: false, seq: 3, reason: 'record_mismatch' });
    });

    it('detects modified hashed bytes, naming their sequence number', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 5);
      await tamper(
        [
          `update audit_entries
              set canonical = convert_to(replace(convert_from(canonical, 'UTF8'), '"version":4', '"version":7'), 'UTF8')
            where tenant_id = $1 and seq = 4`,
        ],
        [tenantId],
      );
      expect(await verify(tenantId)).toEqual({ ok: false, seq: 4, reason: 'entry_hash_mismatch' });
    });

    it('detects a deleted middle entry, naming the missing sequence number', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 5);
      await tamper(['delete from audit_entries where tenant_id = $1 and seq = 3'], [tenantId]);
      expect(await verify(tenantId)).toEqual({ ok: false, seq: 3, reason: 'missing_entry' });
    });

    it('detects reordered entries, naming the first reordered sequence number', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 5);
      await tamper(
        [
          'update audit_entries set seq = 1002 where tenant_id = $1 and seq = 2',
          'update audit_entries set seq = 2 where tenant_id = $1 and seq = 3',
          'update audit_entries set seq = 3 where tenant_id = $1 and seq = 1002',
        ],
        [tenantId],
      );
      expect(await verify(tenantId)).toEqual({ ok: false, seq: 2, reason: 'sequence_mismatch' });
    });

    it('fails at a row a superuser rewrote consistently, at the entry after it', async () => {
      const tenantId = await newTenant();
      await appendMany(tenantId, 3);
      // Rewriting the bytes and recomputing their hash still breaks the next entry's link.
      await tamper(
        [
          `update audit_entries
              set canonical = convert_to(replace(convert_from(canonical, 'UTF8'), '"version":2', '"version":8'), 'UTF8'),
                  payload = jsonb_set(payload, '{data,output,version}', '8')
            where tenant_id = $1 and seq = 2`,
          `update audit_entries
              set entry_hash = sha256(convert_to('partledger/chain/v1', 'UTF8') || '\\x00'::bytea || canonical)
            where tenant_id = $1 and seq = 2`,
        ],
        [tenantId],
      );
      expect(await verify(tenantId)).toEqual({ ok: false, seq: 3, reason: 'prev_hash_mismatch' });
    });

    it('verifies a chain longer than one read batch', async () => {
      const tenantId = await newTenant();
      await inTenant(appPool, tenantId, async (transaction) => {
        for (let version = 1; version <= 520; version += 1) {
          await appendAuditEntry(
            transaction,
            { tenantId, actor: personActor(), event: sampleEvent, data: { output: { version } } },
            systemClock,
          );
        }
      });
      expect(await verify(tenantId)).toMatchObject({ ok: true, length: 520, head: { seq: 520 } });
    });
  });

  describe('applyTransition', () => {
    const sampleLifecycle = defineTransitions({
      aggregate: 'sample',
      statuses: ['draft', 'approved', 'cancelled'],
      transitions: {
        approve: { from: ['draft'], to: 'approved' },
        cancel: { from: ['draft', 'approved'], to: 'cancelled' },
      },
    });
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await newTenant();
      await inTenant(migratorPool, tenantId, (transaction) =>
        transaction.execute(`
          create table transition_samples (
            id uuid primary key default gen_random_uuid(),
            tenant_id uuid not null references tenants (id),
            status text not null default 'draft',
            version integer not null default 1
          );
          call pl_migration.enable_tenant_row_security('public.transition_samples');
          grant select, insert, update on transition_samples to pl_app;
        `),
      );
    });

    async function insertSample(): Promise<string> {
      const result = await inTenant(appPool, tenantId, (transaction) =>
        transaction.execute(sql`insert into transition_samples (tenant_id) values (${tenantId}) returning id`),
      );
      return z.tuple([z.object({ id: z.uuid() })]).parse(result.rows)[0].id;
    }

    async function statusOf(id: string) {
      const result = await superuser.query('select status, version from transition_samples where id = $1', [id]);
      return z.tuple([z.object({ status: z.string(), version: z.number() })]).parse(result.rows)[0];
    }

    it('updates the status conditionally and records the transition for the command entry', async () => {
      const id = await insertSample();
      const { applied, changes } = await inTenant(appPool, tenantId, async (transaction) => {
        const audit = new CommandAudit(transaction, tenantId, new Date());
        const result = await applyTransition({ database: transaction, audit }, sampleLifecycle, {
          table: 'transition_samples',
          id,
          transition: 'approve',
          from: 'draft',
          versioned: true,
        });
        return { applied: result, changes: audit.changes };
      });
      expect(applied).toEqual({ ok: true, value: { status: 'approved', version: 2 } });
      expect(changes).toEqual([
        { kind: 'transition', aggregate: 'sample', id, transition: 'approve', from: 'draft', to: 'approved' },
      ]);
      expect(await statusOf(id)).toEqual({ status: 'approved', version: 2 });
    });

    it('refuses a transition whose from state no longer matches, changing nothing', async () => {
      const id = await insertSample();
      const first = await openTransaction(appPool, tenantId);
      const firstAudit = new CommandAudit(first.database, tenantId, new Date());
      await applyTransition({ database: first.database, audit: firstAudit }, sampleLifecycle, {
        table: 'transition_samples',
        id,
        transition: 'cancel',
        from: 'draft',
        versioned: true,
      });
      // A second request read 'draft' too; its update waits for the first, then matches nothing.
      let secondChanges: readonly unknown[] = [];
      const second = inTenant(appPool, tenantId, async (transaction) => {
        const audit = new CommandAudit(transaction, tenantId, new Date());
        const result = await applyTransition({ database: transaction, audit }, sampleLifecycle, {
          table: 'transition_samples',
          id,
          transition: 'approve',
          from: 'draft',
          versioned: true,
        });
        secondChanges = audit.changes;
        return result;
      });
      await pause(200);
      await first.commit();
      expect(await second).toEqual({
        ok: false,
        error: {
          _tag: 'Conflict',
          reason: 'transitionNotAllowed',
          params: { aggregate: 'sample', transition: 'approve', from: 'draft' },
        },
      });
      expect(secondChanges).toEqual([]);
      expect(await statusOf(id)).toEqual({ status: 'cancelled', version: 2 });
    });

    it('refuses a transition the table does not allow from the given state without touching the row', async () => {
      const id = await insertSample();
      const result = await inTenant(appPool, tenantId, (transaction) =>
        applyTransition(
          { database: transaction, audit: new CommandAudit(transaction, tenantId, new Date()) },
          sampleLifecycle,
          { table: 'transition_samples', id, transition: 'approve', from: 'cancelled', versioned: true },
        ),
      );
      expect(result).toMatchObject({ ok: false, error: { _tag: 'Conflict', reason: 'transitionNotAllowed' } });
      expect(await statusOf(id)).toEqual({ status: 'draft', version: 1 });
    });
  });
});
