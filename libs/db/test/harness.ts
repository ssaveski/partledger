import { randomBytes } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { z } from 'zod';

import { describeViolations } from '../src/catalog-check.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { runtimeRoles, type RuntimeRole } from '../src/roles.ts';

export const databaseName = 'partledger';

export type ConnectingRole = RuntimeRole | 'pl_migrator' | 'superuser';

/**
 * PostgreSQL 18 in a container, bootstrapped like an environment: the container's superuser
 * creates `pl_migrator` and the database it owns, migrations run as `pl_migrator`, and
 * tests connect as the runtime roles. The superuser bypasses row-level security, so tests
 * use it only to arrange fixtures and to break the schema on purpose.
 */
export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  connectionString(role: ConnectingRole, database?: string): string;
  connect(role: ConnectingRole): Promise<pg.Client>;
  pool(role: ConnectingRole, options?: Omit<pg.PoolConfig, 'connectionString' | 'options'>): pg.Pool;
  /** Lets the runtime roles log in; they exist once the migrations have run. */
  enableRuntimeLogins(): Promise<void>;
  stop(): Promise<void>;
}

/** A bootstrapped database with no migrations applied. */
export async function startEmptyDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18')
    .withDatabase('bootstrap')
    .withUsername('bootstrap_admin')
    .withPassword(randomBytes(16).toString('hex'))
    .start();
  const passwords = new Map<string, string>();
  const passwordOf = (role: string) => {
    const existing = passwords.get(role);
    if (existing !== undefined) {
      return existing;
    }
    const created = randomBytes(16).toString('hex');
    passwords.set(role, created);
    return created;
  };

  const connectionString = (role: ConnectingRole, database = databaseName) => {
    const user = role === 'superuser' ? container.getUsername() : role;
    const password = role === 'superuser' ? container.getPassword() : passwordOf(role);
    return `postgres://${user}:${password}@${container.getHost()}:${container.getPort()}/${database}`;
  };

  async function asSuperuser(database: string, statements: readonly string[]): Promise<void> {
    const client = new pg.Client({ connectionString: connectionString('superuser', database) });
    await client.connect();
    try {
      for (const statement of statements) {
        await client.query(statement);
      }
    } finally {
      await client.end();
    }
  }

  await asSuperuser('bootstrap', [
    `create role pl_migrator login createrole nobypassrls password '${passwordOf('pl_migrator')}'`,
    `create database ${databaseName} owner pl_migrator`,
  ]);

  return {
    container,
    connectionString,
    async connect(role) {
      const client = new pg.Client({ connectionString: connectionString(role), options: '-c TimeZone=UTC' });
      await client.connect();
      return client;
    },
    pool(role, options = {}) {
      return new pg.Pool({ ...options, connectionString: connectionString(role), options: '-c TimeZone=UTC' });
    },
    async enableRuntimeLogins() {
      await asSuperuser(
        databaseName,
        runtimeRoles.map((role) => `alter role ${role} password '${passwordOf(role)}'`),
      );
    },
    async stop() {
      await container.stop();
    },
  };
}

/** A database migrated as `pl_migrator` that passes the catalog check, with runtime logins enabled. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const database = await startEmptyDatabase();
  const migration = await migrateDatabase(database.connectionString('pl_migrator'));
  if (!migration.ok) {
    await database.stop();
    throw new Error(`The shipped schema fails the catalog check:\n${describeViolations(migration.violations)}`);
  }
  await database.enableRuntimeLogins();
  return database;
}

const insertedId = z.tuple([z.object({ id: z.uuid() })]);

/** Inserts a synthetic tenant through a superuser connection, which bypasses row-level security. */
export async function insertTenant(superuser: pg.Client, slug: string): Promise<string> {
  const result = await superuser.query(
    `insert into tenants (slug, display_name, region, supplier_list_source, ai_provider, ai_region_restricted, base_currency)
     values ($1, $2, 'ca', 'platform', 'platform_default', false, 'CAD') returning id`,
    [slug, `Synthetic ${slug}`],
  );
  return insertedId.parse(result.rows)[0].id;
}

export interface SyntheticMember {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly email?: string;
  readonly displayName?: string;
}

/**
 * Makes a person a current member of a tenant holding exactly `roles`, through a superuser
 * connection, which bypasses row-level security; an existing membership keeps its row.
 */
export async function insertMember(superuser: pg.Client, member: SyntheticMember): Promise<void> {
  await superuser.query(
    `insert into memberships (tenant_id, user_id, email, display_name, invited_at)
     values ($1, $2, $3, $4, now())
     on conflict (tenant_id, user_id) where removed_at is null do nothing`,
    [
      member.tenantId,
      member.userId,
      member.email ?? `member.${member.userId}@synthetic.test`,
      member.displayName ?? 'Synthetic Member',
    ],
  );
  const membershipId = insertedId.parse(
    (
      await superuser.query(`select id from memberships where tenant_id = $1 and user_id = $2 and removed_at is null`, [
        member.tenantId,
        member.userId,
      ])
    ).rows,
  )[0].id;
  await superuser.query(`delete from role_assignments where tenant_id = $1 and membership_id = $2`, [
    member.tenantId,
    membershipId,
  ]);
  for (const role of member.roles) {
    await superuser.query(
      `insert into role_assignments (tenant_id, membership_id, role, granted_at) values ($1, $2, $3, now())`,
      [member.tenantId, membershipId, role],
    );
  }
}

/**
 * Runs fixture writes in one transaction that declares itself the ERP import, which the
 * database requires for ERP-sourced rows and for an approved-supplier list mirrored from the
 * ERP (migration 0023). Fixtures stand in for the import; application code never does this.
 */
export async function asErpImport<T>(client: pg.Client, work: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('app.master_data_writer', 'erp_import', true)`);
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export interface SyntheticPart {
  readonly tenantId: string;
  readonly partNumber: string;
  readonly revision?: string;
  readonly description?: string;
  readonly category?: string;
  readonly unit?: string;
  readonly source?: 'erp' | 'platform';
  readonly active?: boolean;
}

/** Inserts a synthetic part as the ERP import would, through a superuser connection. */
export async function insertPart(superuser: pg.Client, part: SyntheticPart): Promise<string> {
  const result = await asErpImport(superuser, () =>
    superuser.query(
      `insert into parts (tenant_id, part_number, revision, description, category, unit, source, active, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now()) returning id`,
      [
        part.tenantId,
        part.partNumber,
        part.revision ?? 'A',
        part.description ?? `Synthetic part ${part.partNumber}`,
        part.category ?? 'castings',
        part.unit ?? 'each',
        part.source ?? 'erp',
        part.active ?? true,
      ],
    ),
  );
  return insertedId.parse(result.rows)[0].id;
}

export interface SyntheticSupplier {
  readonly tenantId: string;
  readonly code: string;
  readonly name?: string;
  readonly country?: string;
  readonly vatId?: string | null;
  readonly lei?: string | null;
  readonly source?: 'erp' | 'platform';
  /** An entry on the approved-supplier list; none when left out. */
  readonly approval?: {
    readonly status: string;
    readonly scope: readonly string[];
    readonly expiresOn?: string | null;
  };
}

/** Inserts a synthetic supplier, with its approval if given, as the ERP import would. */
export async function insertSupplier(superuser: pg.Client, supplier: SyntheticSupplier): Promise<string> {
  return asErpImport(superuser, () => insertSupplierRows(superuser, supplier));
}

async function insertSupplierRows(superuser: pg.Client, supplier: SyntheticSupplier): Promise<string> {
  const result = await superuser.query(
    `insert into suppliers (tenant_id, code, name, country, vat_id, lei, status, source, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, now(), now()) returning id`,
    [
      supplier.tenantId,
      supplier.code,
      supplier.name ?? `Synthetic Supplier ${supplier.code}`,
      supplier.country ?? 'CA',
      supplier.vatId ?? null,
      supplier.lei ?? null,
      supplier.source ?? 'erp',
    ],
  );
  const supplierId = insertedId.parse(result.rows)[0].id;
  if (supplier.approval !== undefined) {
    await superuser.query(
      `insert into approved_supplier_entries (tenant_id, supplier_id, status, scope, expires_on, updated_at)
       values ($1, $2, $3, $4, $5, now())`,
      [
        supplier.tenantId,
        supplierId,
        supplier.approval.status,
        supplier.approval.scope,
        supplier.approval.expiresOn ?? null,
      ],
    );
  }
  return supplierId;
}
