import { randomBytes, randomUUID } from 'node:crypto';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { credentialKinds } from '../src/schema/credentials.ts';
import { tableAccessManifest } from '../src/schema/index.ts';
import { hashCredentialSecret, issueCredential, verifyCredential } from '../src/credentials/credential-store.ts';
import { insertTenant, startTestDatabase, type TestDatabase } from './harness.ts';

const tenantRows = z.array(z.object({ id: z.uuid() }));
const tenantIdRows = z.array(z.object({ tenant_id: z.uuid() }));
const fixtureTables = ['fixture_parents', 'fixture_children'];
const countRows = z.tuple([z.object({ count: z.coerce.number() })]);

async function withTenant<T>(
  client: pg.Client,
  tenantId: string,
  work: () => Promise<T>,
  outcome: 'commit' | 'rollback' = 'rollback',
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await work();
    await client.query(outcome);
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    // Drizzle wraps the driver's error in its own, with the original as the cause.
    const databaseError = error instanceof Error && error.cause instanceof pg.DatabaseError ? error.cause : error;
    return databaseError instanceof pg.DatabaseError ? databaseError.code : String(error);
  }
}

/** A structurally valid chain entry and commitment; their hashes are not checked here. */
async function insertAuditRows(client: pg.Client, tenantId: string): Promise<void> {
  await client.query(
    `insert into audit_entries (tenant_id, seq, prev_hash, entry_hash, canonical, actor_type, actor_id, acted_under,
                                correlation_id, time, schema_version, payload)
     values ($1::uuid, 1, decode(repeat('00', 32), 'hex'), sha256(convert_to($3, 'UTF8')), convert_to('{}', 'UTF8'),
             'system', null, '{"grant": "job"}', $2, now(), 1, '{}')`,
    [tenantId, randomUUID(), tenantId],
  );
  await client.query(
    `insert into commitments (tenant_id, commitment, salt, value, created_at)
     values ($1::uuid, sha256(convert_to($2::text, 'UTF8')), sha256(convert_to($3, 'UTF8')), 'Synthetic value', now())`,
    [tenantId, randomUUID(), tenantId],
  );
}

/** A job item outcome and an operational alert, as a background job records them. */
async function insertJobRows(client: pg.Client, tenantId: string): Promise<void> {
  await client.query(
    `insert into job_item_outcomes (tenant_id, job, item_key, status, attempts, last_job_id, updated_at)
     values ($1, 'fixtures.run', 'item-1', 'done', 1, $2, now())`,
    [tenantId, randomUUID()],
  );
  await client.query(
    `insert into operational_alerts (tenant_id, kind, key, params, raised_at)
     values ($1, 'fixtureAlert', 'alert-1', '{}', now())`,
    [tenantId],
  );
}

/** A notification delivering an operational alert to an alert recipient, both of the tenant. */
async function insertNotificationRows(client: pg.Client, tenantId: string): Promise<void> {
  const recipient = await client.query(
    `insert into alert_recipients (tenant_id, email_address, added_at)
     values ($1, 'ops@example.test', now()) returning id`,
    [tenantId],
  );
  await client.query(
    `insert into notifications (tenant_id, channel, template, recipient_kind, recipient_id, alert_recipient_id,
                                params, operational_alert_id, status, created_at)
     select $1, 'email', 'alertFixture', 'alertRecipient', $2, $2, '{}', id, 'pending', now()
       from operational_alerts where tenant_id = $1`,
    [tenantId, z.tuple([z.object({ id: z.uuid() })]).parse(recipient.rows)[0].id],
  );
}

async function insertIdempotencyKey(client: pg.Client, tenantId: string, credentialId: string): Promise<void> {
  await client.query(
    `insert into idempotency_keys (tenant_id, credential_id, command, key, fingerprint, result, created_at, expires_at)
     values ($1, $2, 'fixtures.create', $3, $4, '{}', now(), now() + interval '1 day')`,
    [tenantId, credentialId, randomUUID(), hashCredentialSecret(randomUUID())],
  );
}

async function insertStaffSession(client: pg.Client, tenantId: string, credentialId: string): Promise<void> {
  await client.query(
    `insert into staff_sessions (tenant_id, credential_id, subject_id, refresh_token_ciphertext, started_at, last_seen_at, refreshed_at)
     values ($1, $2, $3, $4, now(), now(), now())`,
    [tenantId, credentialId, randomUUID(), randomBytes(64)],
  );
}

describe('row-level security as pl_app', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let app: pg.Client;
  let migrator: pg.Client;
  let appDatabase: NodePgDatabase;
  let tenantA: string;
  let tenantB: string;
  const credentialOf = new Map<string, string>();
  const inOneHour = () => new Date(Date.now() + 3_600_000);

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    tenantA = await insertTenant(superuser, 'tenant-a');
    tenantB = await insertTenant(superuser, 'tenant-b');
    app = await database.connect('pl_app');
    appDatabase = drizzle({ client: app });
    migrator = await database.connect('pl_migrator');

    // A parent and child pair shaped like every later tenant-owned table.
    await migrator.query(`
      create table fixture_parents (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references tenants (id),
        constraint fixture_parents_tenant_id_id_key unique (tenant_id, id)
      );
      create table fixture_children (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references tenants (id),
        parent_id uuid not null,
        constraint fixture_children_parent_fkey foreign key (tenant_id, parent_id)
          references fixture_parents (tenant_id, id)
      );
      call pl_migration.enable_tenant_row_security('public.fixture_parents');
      call pl_migration.enable_tenant_row_security('public.fixture_children');
      grant select, insert on fixture_parents, fixture_children to pl_app;
      grant select on fixture_parents, fixture_children to pl_backup;
    `);

    // Every tenant-owned table holds rows of both tenants, so a missing policy or FORCE shows.
    const superuserDatabase = drizzle({ client: superuser });
    for (const tenant of [tenantA, tenantB]) {
      const parent = z
        .tuple([z.object({ id: z.uuid() })])
        .parse(
          (await superuser.query('insert into fixture_parents (tenant_id) values ($1) returning id', [tenant])).rows,
        )[0].id;
      await superuser.query('insert into fixture_children (tenant_id, parent_id) values ($1, $2)', [tenant, parent]);
      const credential = await issueCredential(superuserDatabase, {
        tenantId: tenant,
        kind: 'staff_session',
        subjectId: null,
        expiresAt: inOneHour(),
      });
      credentialOf.set(tenant, credential.id);
      await insertIdempotencyKey(superuser, tenant, credential.id);
      await insertAuditRows(superuser, tenant);
      await insertStaffSession(superuser, tenant, credential.id);
      await insertJobRows(superuser, tenant);
      await insertNotificationRows(superuser, tenant);
    }
  });

  afterAll(async () => {
    await Promise.all([superuser.end(), app.end(), migrator.end()]);
    await database.stop();
  });

  it('with tenant A context, selecting tenant B rows returns none', async () => {
    const rows = await withTenant(app, tenantA, async () =>
      tenantRows.parse((await app.query('select id from tenants')).rows),
    );
    expect(rows).toEqual([{ id: tenantA }]);
  });

  it('with tenant A context, inserting a row with tenant B id fails the policy check', async () => {
    const code = await withTenant(app, tenantA, () =>
      errorCodeOf(
        issueCredential(appDatabase, {
          tenantId: tenantB,
          kind: 'staff_session',
          subjectId: null,
          expiresAt: inOneHour(),
        }),
      ),
    );
    expect(code).toBe('42501');
  });

  it('with tenant A context, inserting a row with tenant A id succeeds', async () => {
    const issued = await withTenant(app, tenantA, () =>
      issueCredential(appDatabase, {
        tenantId: tenantA,
        kind: 'staff_session',
        subjectId: null,
        expiresAt: inOneHour(),
      }),
    );
    expect(issued.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('with tenant A context, selecting a tenant_id-keyed table returns only tenant A rows', async () => {
    for (const table of fixtureTables) {
      const rows = await withTenant(app, tenantA, async () =>
        tenantIdRows.parse((await app.query(`select tenant_id from ${table}`)).rows),
      );
      expect(rows, table).toEqual([{ tenant_id: tenantA }]);
    }
  });

  it('with no tenant context set, tenant-owned tables return no rows', async () => {
    const readable = tableAccessManifest.filter((access) => access.grants.pl_app?.includes('SELECT') === true);
    for (const table of [...readable.map((access) => access.table), ...fixtureTables]) {
      const result = countRows.parse((await app.query(`select count(*) from ${table}`)).rows);
      expect(result[0].count, table).toBe(0);
    }
  });

  it('with an empty tenant context set, tenant-owned tables return no rows', async () => {
    const result = await withTenant(app, '', async () =>
      countRows.parse((await app.query('select count(*) from tenants')).rows),
    );
    expect(result[0].count).toBe(0);
  });

  it('the owning role is bound by the policies too and sees no rows of any tenant-owned table without a tenant context', async () => {
    for (const table of [...tableAccessManifest.map((access) => access.table), ...fixtureTables]) {
      const stored = countRows.parse((await superuser.query(`select count(*) from ${table}`)).rows);
      expect(stored[0].count, `${table} holds committed rows`).toBeGreaterThan(0);
      const visible = countRows.parse((await migrator.query(`select count(*) from ${table}`)).rows);
      expect(visible[0].count, table).toBe(0);
    }
  });

  it("a notification delivering another tenant's operational alert fails its composite foreign key", async () => {
    const code = await errorCodeOf(
      superuser.query(
        `insert into notifications (tenant_id, channel, template, recipient_kind, recipient_id, params,
                                    operational_alert_id, status, created_at)
         select $1, 'email', 'alertFixture', 'person', gen_random_uuid(), '{}', id, 'pending', now()
           from operational_alerts where tenant_id = $2`,
        [tenantA, tenantB],
      ),
    );
    expect(code).toBe('23503');
  });

  it('a notification to an alert recipient that does not exist, or belongs to another tenant, fails its composite foreign key', async () => {
    const insert = (recipientId: string) =>
      superuser.query(
        `insert into notifications (tenant_id, channel, template, recipient_kind, recipient_id, alert_recipient_id,
                                    params, status, created_at)
         values ($1, 'email', 'alertFixture', 'alertRecipient', $2, $2, '{}', 'pending', now())`,
        [tenantA, recipientId],
      );
    expect(await errorCodeOf(insert(randomUUID()))).toBe('23503');
    const ofB = await superuser.query('select id from alert_recipients where tenant_id = $1', [tenantB]);
    expect(await errorCodeOf(insert(z.array(z.object({ id: z.uuid() })).parse(ofB.rows)[0]?.id ?? ''))).toBe('23503');
  });

  it('a notification to an alert recipient must name it in the checked column', async () => {
    const code = await errorCodeOf(
      superuser.query(
        `insert into notifications (tenant_id, channel, template, recipient_kind, recipient_id, params, status, created_at)
         select tenant_id, 'email', 'alertFixture', 'alertRecipient', id, '{}', 'pending', now()
           from alert_recipients where tenant_id = $1`,
        [tenantA],
      ),
    );
    expect(code).toBe('23514');
  });

  it('an idempotency key referencing another tenant credential fails its composite foreign key', async () => {
    const code = await errorCodeOf(insertIdempotencyKey(superuser, tenantA, credentialOf.get(tenantB) ?? ''));
    expect(code).toBe('23503');
  });

  it('a staff session referencing another tenant credential fails its composite foreign key', async () => {
    const code = await errorCodeOf(insertStaffSession(superuser, tenantA, credentialOf.get(tenantB) ?? ''));
    expect(code).toBe('23503');
  });

  it('pl_app can end a staff session but cannot move it to another subject or credential, or delete it', async () => {
    const credentialId = credentialOf.get(tenantA) ?? '';
    const ended = await withTenant(app, tenantA, async () =>
      app.query(
        `update staff_sessions set ended_at = now(), end_reason = 'signed_out' where credential_id = $1 and ended_at is null`,
        [credentialId],
      ),
    );
    expect(ended.rowCount).toBe(1);
    for (const statement of [
      `update staff_sessions set subject_id = gen_random_uuid() where credential_id = '${credentialId}'`,
      `update staff_sessions set credential_id = gen_random_uuid() where credential_id = '${credentialId}'`,
      `update staff_sessions set tenant_id = '${tenantB}' where credential_id = '${credentialId}'`,
      `delete from staff_sessions where credential_id = '${credentialId}'`,
    ]) {
      const code = await withTenant(app, tenantA, () => errorCodeOf(app.query(statement)));
      expect(code, statement).toBe('42501');
    }
  });

  it('an ended staff session cannot be reopened or changed, by pl_app or by the owner', async () => {
    const credential = await issueCredential(drizzle({ client: superuser }), {
      tenantId: tenantA,
      kind: 'staff_session',
      subjectId: null,
      expiresAt: inOneHour(),
    });
    await insertStaffSession(superuser, tenantA, credential.id);
    await withTenant(
      app,
      tenantA,
      () =>
        app.query(`update staff_sessions set ended_at = now(), end_reason = 'signed_out' where credential_id = $1`, [
          credential.id,
        ]),
      'commit',
    );
    for (const statement of [
      `update staff_sessions set ended_at = null, end_reason = null where credential_id = '${credential.id}'`,
      `update staff_sessions set last_seen_at = now() where credential_id = '${credential.id}'`,
      `update staff_sessions set end_reason = 'idle_timeout' where credential_id = '${credential.id}'`,
    ]) {
      const code = await withTenant(app, tenantA, () => errorCodeOf(app.query(statement)));
      expect(code, statement).toBe('42501');
    }
    const asOwner = await withTenant(migrator, tenantA, () =>
      errorCodeOf(
        migrator.query(`update staff_sessions set ended_at = null, end_reason = null where credential_id = $1`, [
          credential.id,
        ]),
      ),
    );
    expect(asOwner).toBe('42501');
  });

  it('a row referencing another tenant parent row fails its composite foreign key', async () => {
    const parentOfB = z
      .tuple([z.object({ id: z.uuid() })])
      .parse(
        (await superuser.query('insert into fixture_parents (tenant_id) values ($1) returning id', [tenantB])).rows,
      )[0].id;
    const code = await withTenant(app, tenantA, () =>
      errorCodeOf(
        app.query('insert into fixture_children (tenant_id, parent_id) values ($1, $2)', [tenantA, parentOfB]),
      ),
    );
    expect(code).toBe('23503');
  });

  it('pl_app cannot TRUNCATE or ALTER tenant tables', async () => {
    for (const statement of [
      'truncate tenants cascade',
      'truncate credentials',
      'alter table tenants no force row level security',
      'alter table credentials disable row level security',
      'drop policy credentials_tenant_isolation on credentials',
    ]) {
      const code = await withTenant(app, tenantA, () => errorCodeOf(app.query(statement)));
      expect(code, statement).toBe('42501');
    }
  });

  it('pl_app cannot SELECT the credential table directly', async () => {
    const code = await withTenant(app, tenantA, () => errorCodeOf(app.query('select id from credentials')));
    expect(code).toBe('42501');
  });

  it('resolve_credential returns exactly one row by id and nothing for unknown ids', async () => {
    const issued = await withTenant(
      app,
      tenantB,
      () =>
        issueCredential(appDatabase, {
          tenantId: tenantB,
          kind: 'supplier_link',
          subjectId: null,
          expiresAt: inOneHour(),
        }),
      'commit',
    );
    const found = await app.query('select * from resolve_credential($1, $2)', ['supplier_link', issued.id]);
    expect(found.rows).toHaveLength(1);
    expect(z.object({ id: z.uuid(), tenant_id: z.uuid() }).parse(found.rows[0])).toMatchObject({
      id: issued.id,
      tenant_id: tenantB,
    });

    const unknown = await app.query('select * from resolve_credential($1, $2)', ['supplier_link', crypto.randomUUID()]);
    expect(unknown.rows).toHaveLength(0);
    const wrongKind = await app.query('select * from resolve_credential($1, $2)', ['staff_session', issued.id]);
    expect(wrongKind.rows).toHaveLength(0);
  });

  it('a presented credential verifies only with its own secret, before expiry and while unrevoked', async () => {
    const expiresAt = inOneHour();
    const issued = await withTenant(
      app,
      tenantA,
      () => issueCredential(appDatabase, { tenantId: tenantA, kind: 'drop_credential', subjectId: null, expiresAt }),
      'commit',
    );
    const presented = { kind: 'drop_credential' as const, id: issued.id, secret: issued.secret };

    expect(await verifyCredential(app, presented, new Date())).toMatchObject({
      ok: true,
      credential: { id: issued.id, tenantId: tenantA, kind: 'drop_credential' },
    });
    expect(await verifyCredential(app, { ...presented, secret: 'A'.repeat(43) }, new Date())).toEqual({
      ok: false,
      reason: 'secret_mismatch',
    });
    expect(await verifyCredential(app, { ...presented, kind: 'staff_session' }, new Date())).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await verifyCredential(app, { ...presented, id: 'not-a-uuid' }, new Date())).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await verifyCredential(app, presented, new Date(expiresAt.getTime() + 1))).toEqual({
      ok: false,
      reason: 'expired',
    });
    await superuser.query('update credentials set revoked_at = now() where id = $1', [issued.id]);
    expect(await verifyCredential(app, presented, new Date())).toEqual({ ok: false, reason: 'revoked' });
  });

  it('the credential table stores only SHA-256 hashes of secrets, for every credential kind', async () => {
    for (const kind of credentialKinds) {
      const issued = await withTenant(
        app,
        tenantA,
        () => issueCredential(appDatabase, { tenantId: tenantA, kind, subjectId: null, expiresAt: inOneHour() }),
        'commit',
      );
      const stored = z
        .tuple([z.object({ secret_hash: z.instanceof(Buffer), row_text: z.string() })])
        .parse(
          (
            await superuser.query(
              'select secret_hash, credential::text as row_text from credentials credential where id = $1',
              [issued.id],
            )
          ).rows,
        )[0];
      expect(stored.secret_hash.equals(hashCredentialSecret(issued.secret)), kind).toBe(true);
      expect(stored.secret_hash).toHaveLength(32);
      expect(stored.row_text, kind).not.toContain(issued.secret);
    }
    const code = await errorCodeOf(
      superuser.query(
        `insert into credentials (tenant_id, kind, secret_hash, expires_at) values ($1, 'staff_session', 'plain-secret'::bytea, now() + interval '1 hour')`,
        [tenantA],
      ),
    );
    expect(code).toBe('23514');
  });

  it('a timestamp bound through raw SQL round-trips as the same UTC instant', async () => {
    const instant = new Date('2026-03-08T10:30:15.123Z');
    await app.query(`set time zone 'America/Vancouver'`);
    try {
      const result = z
        .tuple([z.object({ value: z.date(), text: z.string() })])
        .parse(
          (
            await app.query("select $1::timestamptz as value, ($1::timestamptz at time zone 'UTC')::text as text", [
              instant.toISOString(),
            ])
          ).rows,
        );
      expect(result[0].value.toISOString()).toBe(instant.toISOString());
      expect(result[0].text).toBe('2026-03-08 10:30:15.123');
    } finally {
      await app.query('reset time zone');
    }
  });
});
