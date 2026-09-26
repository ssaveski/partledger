import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkCatalog, type CatalogCheckResult, type CatalogExpectations } from '../src/catalog-check.ts';
import { tableAccessManifest } from '../src/schema/index.ts';
import { defineTableAccess } from '../src/table-access.ts';
import { startTestDatabase, type TestDatabase } from './harness.ts';

const fixtureTables = `
  create table fixture_parents (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id),
    code text not null,
    constraint fixture_parents_tenant_id_id_key unique (tenant_id, id),
    constraint fixture_parents_tenant_id_code_key unique (tenant_id, code)
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
  grant select, insert, update on fixture_parents, fixture_children to pl_app;
  grant select on fixture_parents, fixture_children to pl_backup;
`;

const withFixtures: CatalogExpectations = {
  tables: [
    ...tableAccessManifest,
    defineTableAccess({
      table: 'fixture_parents',
      tenantKey: 'tenant_id',
      grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE'] },
    }),
    defineTableAccess({
      table: 'fixture_children',
      tenantKey: 'tenant_id',
      grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE'] },
    }),
  ],
};

const auditFixture = `
  create table fixture_audit (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id),
    parent_id uuid not null,
    constraint fixture_audit_parent_fkey foreign key (tenant_id, parent_id)
      references fixture_parents (tenant_id, id)
  );
  call pl_migration.enable_tenant_row_security('public.fixture_audit');
  grant select, insert on fixture_audit to pl_app;
  grant select on fixture_audit to pl_backup;
  create function pl_migration.refuse_change() returns trigger language plpgsql
    set search_path = pg_catalog, pg_temp
    as $$ begin raise exception 'insert-only'; end $$;
  create trigger fixture_audit_no_update before update or delete on fixture_audit
    for each row execute function pl_migration.refuse_change();
  create trigger fixture_audit_no_truncate before truncate on fixture_audit
    for each statement execute function pl_migration.refuse_change();
`;

const withAuditFixture: CatalogExpectations = {
  tables: [
    ...withFixtures.tables,
    defineTableAccess({
      table: 'fixture_audit',
      tenantKey: 'tenant_id',
      grants: { pl_app: ['SELECT', 'INSERT'] },
      insertOnly: true,
    }),
  ],
};

describe('the catalog check', () => {
  let database: TestDatabase;
  let superuser: pg.Client;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
  });

  afterAll(async () => {
    await superuser.end();
    await database.stop();
  });

  /**
   * Applies a change as the superuser inside a transaction, runs the check as pl_app in the
   * same transaction, and rolls everything back, roles included.
   */
  async function checkAfter(change: string, expectations?: CatalogExpectations): Promise<CatalogCheckResult> {
    await superuser.query('begin');
    try {
      await superuser.query('set local role pl_migrator');
      await superuser.query(fixtureTables);
      await superuser.query('reset role');
      await superuser.query(change);
      await superuser.query('set local role pl_app');
      return await checkCatalog(superuser, expectations ?? withFixtures);
    } finally {
      await superuser.query('rollback');
    }
  }

  function codesOf(result: CatalogCheckResult): string[] {
    return result.ok ? [] : result.violations.map((violation) => `${violation.code} ${violation.object}`);
  }

  it('passes on the shipped schema when run as pl_app', async () => {
    const app = await database.connect('pl_app');
    try {
      expect(await checkCatalog(app)).toEqual({ ok: true });
    } finally {
      await app.end();
    }
  });

  it('passes on tenant tables shaped like the shipped ones, including an insert-only table', async () => {
    expect(await checkAfter('select 1', withFixtures)).toEqual({ ok: true });
    expect(await checkAfter(`set local role pl_migrator; ${auditFixture}`, withAuditFixture)).toEqual({ ok: true });
  });

  it('fails when a tenant table lacks FORCE ROW LEVEL SECURITY', async () => {
    const result = await checkAfter('alter table credentials no force row level security');
    expect(codesOf(result)).toEqual(['row_security_not_forced public.credentials']);
  });

  it('fails when a tenant table has row-level security disabled', async () => {
    const result = await checkAfter('alter table fixture_parents disable row level security');
    expect(codesOf(result)).toContain('row_security_not_enabled public.fixture_parents');
  });

  it('fails when a role has BYPASSRLS', async () => {
    const result = await checkAfter('create role catalog_probe bypassrls');
    expect(codesOf(result)).toEqual(['role_bypasses_row_security catalog_probe']);
  });

  it('fails when a runtime role can become another role', async () => {
    const result = await checkAfter('grant pl_credential_resolver to pl_app');
    expect(codesOf(result)).toEqual(['runtime_role_has_membership pl_app']);
  });

  it('fails when an extra definer function exists', async () => {
    const result = await checkAfter(`
      create function public.probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      alter function public.probe() owner to pl_migrator;
      revoke all on function public.probe() from public;
    `);
    expect(codesOf(result)).toEqual(['unexpected_definer_function public.probe()']);
  });

  it('fails when the credential resolver loses its pinned search_path', async () => {
    const result = await checkAfter('alter function resolve_credential(text, uuid) reset search_path');
    expect(codesOf(result)).toEqual([
      'definer_search_path_not_pinned public.resolve_credential(requested_kind text, requested_id uuid)',
    ]);
  });

  it('fails when PUBLIC may execute a function', async () => {
    const result = await checkAfter('grant execute on function resolve_credential(text, uuid) to public');
    expect(codesOf(result)).toEqual([
      'function_executable_by_public public.resolve_credential(requested_kind text, requested_id uuid)',
    ]);
  });

  it('fails when a unique constraint on a tenant table lacks tenant_id', async () => {
    const result = await checkAfter(
      'alter table fixture_parents add constraint fixture_parents_code_key unique (code)',
    );
    expect(codesOf(result)).toEqual(['unique_key_without_tenant fixture_parents.fixture_parents_code_key']);
  });

  it('fails when a unique index on a tenant table lacks tenant_id', async () => {
    const result = await checkAfter('create unique index credentials_subject_index on credentials (subject_id)');
    expect(codesOf(result)).toEqual(['unique_key_without_tenant credentials.credentials_subject_index']);
  });

  it('fails when a foreign key between tenant tables is not composite', async () => {
    const result = await checkAfter(`
      alter table fixture_children drop constraint fixture_children_parent_fkey;
      alter table fixture_parents add constraint fixture_parents_id_key unique (id);
      alter table fixture_children add constraint fixture_children_parent_fkey
        foreign key (parent_id) references fixture_parents (id);
    `);
    expect(codesOf(result)).toEqual([
      'unique_key_without_tenant fixture_parents.fixture_parents_id_key',
      'foreign_key_not_composite fixture_children.fixture_children_parent_fkey',
    ]);
  });

  it('fails when a policy has a branch around the tenant context', async () => {
    const result = await checkAfter(`
      create policy fixture_parents_open on fixture_parents
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
               or current_setting('app.tenant_id', true) is null);
    `);
    expect(codesOf(result)).toEqual(['policy_not_tenant_scoped fixture_parents.fixture_parents_open']);
  });

  it('fails when a read-all policy is granted to a role other than pl_backup', async () => {
    const result = await checkAfter(
      'create policy fixture_parents_read_all on fixture_parents for select to pl_app using (true)',
    );
    expect(codesOf(result)).toEqual(['policy_not_tenant_scoped fixture_parents.fixture_parents_read_all']);
  });

  it('fails when pl_backup loses its read-all policy', async () => {
    const result = await checkAfter('drop policy credentials_backup_read on credentials');
    expect(codesOf(result)).toEqual(['missing_backup_policy credentials']);
  });

  it('fails when a table has no tenant policy', async () => {
    const result = await checkAfter('drop policy fixture_children_tenant_isolation on fixture_children');
    expect(codesOf(result)).toEqual(['missing_tenant_policy fixture_children']);
  });

  it('fails when pl_app gains TRUNCATE, SELECT on credentials, or a column privilege', async () => {
    const result = await checkAfter(`
      grant truncate on tenants to pl_app;
      grant select on credentials to pl_app;
      grant update (display_name) on tenants to pl_portal;
    `);
    expect(codesOf(result)).toEqual([
      'unexpected_grant tenants',
      'unexpected_column_grant tenants',
      'unexpected_grant credentials',
    ]);
  });

  it('fails when a table is owned by another role', async () => {
    const result = await checkAfter('alter table fixture_children owner to pl_app');
    expect(codesOf(result)).toContain('wrong_owner public.fixture_children');
  });

  it('fails when a table is not in the expected manifest', async () => {
    const result = await checkAfter('select 1', { tables: tableAccessManifest });
    expect(codesOf(result)).toEqual(['unknown_table public.fixture_parents', 'unknown_table public.fixture_children']);
  });

  it('fails when a column holds a timestamp without time zone', async () => {
    const result = await checkAfter('alter table fixture_parents add column seen_at timestamp');
    expect(codesOf(result)).toEqual(['timestamp_without_time_zone fixture_parents.seen_at']);
  });

  it('fails when a foreign-key action would cascade into an insert-only table', async () => {
    const result = await checkAfter(
      `set local role pl_migrator; ${auditFixture}
       alter table fixture_audit drop constraint fixture_audit_parent_fkey;
       alter table fixture_audit add constraint fixture_audit_parent_fkey foreign key (tenant_id, parent_id)
         references fixture_parents (tenant_id, id) on delete cascade;`,
      withAuditFixture,
    );
    expect(codesOf(result)).toEqual(['foreign_key_action_not_allowed fixture_audit.fixture_audit_parent_fkey']);
  });

  it('fails when an insert-only table lacks its guard triggers or is disabled', async () => {
    const result = await checkAfter(
      `set local role pl_migrator; ${auditFixture}
       drop trigger fixture_audit_no_truncate on fixture_audit;
       alter table fixture_audit disable trigger fixture_audit_no_update;`,
      withAuditFixture,
    );
    expect(codesOf(result)).toEqual([
      'missing_insert_only_trigger fixture_audit',
      'missing_insert_only_trigger fixture_audit',
      'missing_insert_only_trigger fixture_audit',
      'trigger_disabled fixture_audit.fixture_audit_no_update',
    ]);
  });

  it('fails when an insert-only table grants UPDATE', async () => {
    const result = await checkAfter(
      `set local role pl_migrator; ${auditFixture} grant update on fixture_audit to pl_app;`,
      {
        tables: withAuditFixture.tables.map((access) =>
          access.table === 'fixture_audit' ? { ...access, grants: { pl_app: ['SELECT', 'INSERT', 'UPDATE'] } } : access,
        ),
      },
    );
    expect(codesOf(result)).toEqual(['insert_only_table_writable fixture_audit']);
  });
});
