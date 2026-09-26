import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { migrationsFolder } from '../src/migrate.ts';
import { startEmptyDatabase, type TestDatabase } from './harness.ts';

const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
const journal = z
  .object({ entries: z.array(z.object({ tag: z.string() })) })
  .parse(JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')));

describe('pnpm db:migrate', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startEmptyDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  function runMigrations() {
    const url = new URL(database.connectionString('pl_migrator'));
    return spawnSync('pnpm', ['db:migrate'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        PGHOST: url.hostname,
        PGPORT: url.port,
        PGDATABASE: url.pathname.slice(1),
        PGUSER: url.username,
        PGPASSWORD: url.password,
      },
    });
  }

  it('applies every migration as pl_migrator and reports a passing catalog check', async () => {
    const result = runMigrations();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('the catalog check passes');

    const migrator = await database.connect('pl_migrator');
    try {
      const applied = z
        .array(z.object({ count: z.coerce.number() }))
        .parse((await migrator.query('select count(*) from drizzle.__drizzle_migrations')).rows);
      expect(applied).toEqual([{ count: journal.entries.length }]);
    } finally {
      await migrator.end();
    }
  });

  it('is a no-op when run again on a migrated database', () => {
    const result = runMigrations();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('the catalog check passes');
  });

  it('exits non-zero when the migrated database fails the catalog check', async () => {
    const superuser = await database.connect('superuser');
    try {
      await superuser.query('alter table tenants no force row level security');
      const result = runMigrations();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('row_security_not_forced: public.tenants');
    } finally {
      await superuser.query('alter table tenants force row level security');
      await superuser.end();
    }
  });
});
