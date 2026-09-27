import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { insertTenant, startTestDatabase, type TestDatabase } from './harness.ts';

const slugRows = z.array(z.object({ slug: z.string(), region: z.string() }));

async function errorOf(work: Promise<unknown>): Promise<{ code: string | undefined; message: string } | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof pg.DatabaseError
      ? { code: error.code, message: error.message }
      : { code: undefined, message: String(error) };
  }
}

/** Runs statements with `app.tenant_id` set, then rolls back unless told to commit. */
async function inTenant<T>(
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

async function insertMember(client: pg.Client, tenantId: string, userId = randomUUID()): Promise<string> {
  await client.query(
    `insert into memberships (tenant_id, user_id, email, display_name, invited_at)
     values ($1, $2, $3, 'Synthetic Member', now())`,
    [tenantId, userId, `member.${userId.slice(0, 8)}@synthetic.test`],
  );
  return userId;
}

/** A chain entry that names `userId` in its payload; its hashes are not checked here. */
async function insertAuditEntryNaming(client: pg.Client, tenantId: string, userId: string, asActor: boolean) {
  const sequence = z
    .tuple([z.object({ next: z.coerce.number() })])
    .parse(
      (
        await client.query('select coalesce(max(seq), 0) + 1 as next from audit_entries where tenant_id = $1', [
          tenantId,
        ])
      ).rows,
    )[0].next;
  await client.query(
    `insert into audit_entries (tenant_id, seq, prev_hash, entry_hash, canonical, actor_type, actor_id, acted_under,
                                correlation_id, time, schema_version, payload)
     values ($1::uuid, $2, sha256(convert_to($3 || 'prev', 'UTF8')), sha256(convert_to($3, 'UTF8')),
             convert_to('{}', 'UTF8'), 'person', $4, '{"grant": "staff_session"}', $5, now(), 1, $6::jsonb)`,
    [
      tenantId,
      sequence,
      randomUUID(),
      asActor ? userId : null,
      randomUUID(),
      JSON.stringify({ event: 'members.grantRole', data: { output: asActor ? {} : { userId } } }),
    ],
  );
}

describe('tenants, memberships and the directory in the database', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let app: pg.Client;
  let migrator: pg.Client;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    tenantA = await insertTenant(superuser, 'tenancy-a');
    tenantB = await insertTenant(superuser, 'tenancy-b');
    app = await database.connect('pl_app');
    migrator = await database.connect('pl_migrator');
  });

  afterAll(async () => {
    await Promise.all([superuser.end(), app.end(), migrator.end()]);
    await database.stop();
  });

  it("changing a tenant's region is refused for the app role and for the owner", async () => {
    const asApp = await inTenant(app, tenantA, () => errorOf(app.query(`update tenants set region = 'eu'`)));
    expect(asApp?.code).toBe('42501');
    const asOwner = await inTenant(migrator, tenantA, () =>
      errorOf(migrator.query(`update tenants set region = 'eu' where id = $1`, [tenantA])),
    );
    expect(asOwner?.message).toContain('pl.tenants.identity_fixed');
    const asSuperuser = await errorOf(superuser.query(`update tenants set slug = 'renamed' where id = $1`, [tenantA]));
    expect(asSuperuser?.message).toContain('pl.tenants.identity_fixed');
  });

  it('a tenant can be inserted by the app role only in a transaction whose tenant is the new tenant', async () => {
    const newTenant = randomUUID();
    const insert = `insert into tenants (id, slug, display_name, region, supplier_list_source, ai_provider,
                                         ai_region_restricted, base_currency)
                    values ($1, $2, 'Synthetic Tenant', 'ca', 'erp', 'platform_default', false, 'CAD')`;
    const elsewhere = await inTenant(app, tenantA, () => errorOf(app.query(insert, [newTenant, 'tenancy-c'])));
    expect(elsewhere?.code).toBe('42501');
    const own = await inTenant(app, newTenant, () => errorOf(app.query(insert, [newTenant, 'tenancy-c'])));
    expect(own).toBeUndefined();
  });

  it('an AI key reference is required exactly when the tenant brings its own provider', async () => {
    for (const [provider, reference, accepted] of [
      ['platform_default', null, true],
      ['platform_default', 'kms/tenant-key', false],
      ['anthropic', null, false],
      ['anthropic', 'kms/tenant-key', true],
    ] as const) {
      const failure = await errorOf(
        superuser.query(
          `insert into tenants (slug, display_name, region, supplier_list_source, ai_provider, ai_key_reference,
                                ai_region_restricted, base_currency)
           values ($1, 'Synthetic Tenant', 'eu', 'platform', $2, $3, true, 'EUR')`,
          [`ai-${randomUUID().slice(0, 8)}`, provider, reference],
        ),
      );
      expect(failure === undefined, `${provider} with ${reference ?? 'no reference'}`).toBe(accepted);
    }
  });

  it('a membership records its removal once and never changes afterwards', async () => {
    const userId = await insertMember(superuser, tenantA);
    const renamed = await inTenant(app, tenantA, () =>
      errorOf(app.query(`update memberships set email = 'other@synthetic.test' where user_id = $1`, [userId])),
    );
    expect(renamed?.code).toBe('42501');
    await inTenant(
      app,
      tenantA,
      () => app.query(`update memberships set removed_at = now() where user_id = $1`, [userId]),
      'commit',
    );
    const reopened = await inTenant(app, tenantA, () =>
      errorOf(app.query(`update memberships set removed_at = null where user_id = $1`, [userId])),
    );
    expect(reopened?.message).toContain('pl.tenants.membership_fixed');
  });

  it('a removed member cannot be granted a role', async () => {
    const userId = await insertMember(superuser, tenantA);
    await superuser.query(`update memberships set removed_at = now() where user_id = $1`, [userId]);
    const granted = await inTenant(app, tenantA, () =>
      errorOf(
        app.query(
          `insert into role_assignments (tenant_id, user_id, role, granted_at) values ($1, $2, 'buyer', now())`,
          [tenantA, userId],
        ),
      ),
    );
    expect(granted?.message).toContain('pl.tenants.member_removed');
  });

  it("a role assignment for another tenant's member fails its composite foreign key", async () => {
    const memberOfB = await insertMember(superuser, tenantB);
    const failure = await errorOf(
      superuser.query(
        `insert into role_assignments (tenant_id, user_id, role, granted_at) values ($1, $2, 'approver', now())`,
        [tenantA, memberOfB],
      ),
    );
    expect(failure?.code).toBe('23503');
  });

  it('deleting a user referenced by audit entries fails, as their actor or in a payload', async () => {
    const actor = await insertMember(superuser, tenantA);
    const subject = await insertMember(superuser, tenantA);
    await insertAuditEntryNaming(superuser, tenantA, actor, true);
    await insertAuditEntryNaming(superuser, tenantA, subject, false);

    const asApp = await inTenant(app, tenantA, () =>
      errorOf(app.query(`delete from memberships where user_id = $1`, [actor])),
    );
    expect(asApp?.code).toBe('42501');
    for (const userId of [actor, subject]) {
      const asOwner = await inTenant(migrator, tenantA, () =>
        errorOf(migrator.query(`delete from memberships where user_id = $1`, [userId])),
      );
      expect(asOwner?.message).toContain('pl.tenants.member_referenced');
    }
    const unreferenced = await insertMember(superuser, tenantA);
    const deleted = await inTenant(migrator, tenantA, () =>
      migrator.query(`delete from memberships where user_id = $1`, [unreferenced]),
    );
    expect(deleted.rowCount).toBe(1);
  });

  it("the directory registers only the provisioning tenant's own slug and region", async () => {
    const foreign = await inTenant(app, tenantA, () =>
      errorOf(app.query(`insert into directory_entries (slug, region) values ('tenancy-b', 'ca')`)),
    );
    expect(foreign?.code).toBe('42501');
    const wrongRegion = await inTenant(app, tenantA, () =>
      errorOf(app.query(`insert into directory_entries (slug, region) values ('tenancy-a', 'eu')`)),
    );
    expect(wrongRegion?.code).toBe('42501');
    await inTenant(
      app,
      tenantA,
      () => app.query(`insert into directory_entries (slug, region) values ('tenancy-a', 'ca')`),
      'commit',
    );
    // The lookup happens before any tenant is known.
    const found = slugRows.parse(
      (await app.query(`select slug, region from directory_entries where slug = 'tenancy-a'`)).rows,
    );
    expect(found).toEqual([{ slug: 'tenancy-a', region: 'ca' }]);
    const changed = await errorOf(app.query(`update directory_entries set region = 'eu'`));
    expect(changed?.code).toBe('42501');
  });
});
