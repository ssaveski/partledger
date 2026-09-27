import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { healthResponseSchema } from '@partledger/contracts';
import { startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { placeholderAuthEnvironment } from './support/auth-environment';

const apiDirectory = join(import.meta.dirname, '..');
const entryPoint = join(apiDirectory, 'dist', 'main.js');
const placeholderDatabaseUrl = 'postgres://pl_app:placeholder@127.0.0.1:1/partledger';
const placeholderJobsDatabaseUrl = 'postgres://pl_job_runner:placeholder@127.0.0.1:1/partledger';
const ports = { STAFF_PORT: '3000', PORTAL_PORT: '3001', DROP_PORT: '3002', OPERATOR_PORT: '3003' };

function startWith(environment: Readonly<Record<string, string>>) {
  return spawnSync(process.execPath, [entryPoint], {
    env: { PATH: process.env.PATH, ...placeholderAuthEnvironment(), ...environment },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('No port assigned'));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

describe('the built API entry point', () => {
  const running: { kill: () => boolean }[] = [];
  let database: TestDatabase;

  beforeAll(async () => {
    execFileSync('pnpm', ['build'], { cwd: apiDirectory, stdio: 'pipe' });
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(() => {
    for (const child of running.splice(0)) {
      child.kill();
    }
  });

  it('refuses to boot on an invalid STAFF_PORT and names the field', () => {
    const result = startWith({
      NODE_ENV: 'test',
      ...ports,
      STAFF_PORT: 'eighty',
      DATABASE_URL: placeholderDatabaseUrl,
      JOBS_DATABASE_URL: placeholderJobsDatabaseUrl,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/STAFF_PORT/);
  });

  it('refuses to boot on an unknown NODE_ENV and names the field', () => {
    const result = startWith({
      NODE_ENV: 'staging',
      ...ports,
      DATABASE_URL: placeholderDatabaseUrl,
      JOBS_DATABASE_URL: placeholderJobsDatabaseUrl,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/NODE_ENV/);
  });

  it('boots on a valid configuration and serves the health endpoint on each of its four listeners', async () => {
    const [staff, portal, drop, operator] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
    const child = spawn(process.execPath, [entryPoint], {
      env: {
        PATH: process.env.PATH,
        ...placeholderAuthEnvironment(),
        NODE_ENV: 'test',
        STAFF_PORT: String(staff),
        PORTAL_PORT: String(portal),
        DROP_PORT: String(drop),
        OPERATOR_PORT: String(operator),
        DATABASE_URL: database.connectionString('pl_app'),
        JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
      },
      stdio: 'pipe',
    });
    running.push(child);
    for (const port of [staff, portal, drop, operator]) {
      const deadline = Date.now() + 20_000;
      let body: unknown = null;
      while (body === null && Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
          body = await response.json();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      expect(healthResponseSchema.parse(body)).toEqual({ status: 'ok' });
    }
  });

  it('refuses to boot without a DATABASE_URL and names the field', () => {
    const result = startWith({ NODE_ENV: 'test', ...ports, JOBS_DATABASE_URL: placeholderJobsDatabaseUrl });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/DATABASE_URL/);
  });

  it('refuses to boot when the database fails the catalog check and names the violation', async () => {
    const superuser = await database.connect('superuser');
    try {
      await superuser.query('alter table credentials no force row level security');
      const result = startWith({
        NODE_ENV: 'test',
        ...ports,
        DATABASE_URL: database.connectionString('pl_app'),
        JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('row_security_not_forced: public.credentials');
    } finally {
      await superuser.query('alter table credentials force row level security');
      await superuser.end();
    }
  });

  it('refuses to boot when connected as the superuser, which bypasses row-level security', () => {
    const result = startWith({
      NODE_ENV: 'test',
      ...ports,
      DATABASE_URL: database.connectionString('superuser'),
      JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected_connection_role: bootstrap_admin');
  });

  it('refuses to boot when the job runner connects as pl_app instead of pl_job_runner', () => {
    const result = startWith({
      NODE_ENV: 'test',
      ...ports,
      DATABASE_URL: database.connectionString('pl_app'),
      JOBS_DATABASE_URL: database.connectionString('pl_app'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected_connection_role: pl_app');
  });

  it('refuses to boot when connected as the owning role pl_migrator', () => {
    const result = startWith({
      NODE_ENV: 'test',
      ...ports,
      DATABASE_URL: database.connectionString('pl_migrator'),
      JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected_connection_role: pl_migrator');
  });
});
