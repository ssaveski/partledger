import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { healthResponseSchema } from '@partledger/contracts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const apiDirectory = join(import.meta.dirname, '..');
const entryPoint = join(apiDirectory, 'dist', 'main.js');

function startWith(environment: Readonly<Record<string, string>>) {
  return spawnSync(process.execPath, [entryPoint], {
    env: { PATH: process.env.PATH, ...environment },
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

  beforeAll(() => {
    execFileSync('pnpm', ['build'], { cwd: apiDirectory, stdio: 'pipe' });
  });

  afterEach(() => {
    for (const child of running.splice(0)) {
      child.kill();
    }
  });

  it('refuses to boot on an invalid PORT and names the field', () => {
    const result = startWith({ NODE_ENV: 'test', PORT: 'eighty' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/PORT/);
  });

  it('refuses to boot on an unknown NODE_ENV and names the field', () => {
    const result = startWith({ NODE_ENV: 'staging', PORT: '3000' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/NODE_ENV/);
  });

  it('boots on a valid configuration and serves the health endpoint', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [entryPoint], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port) },
      stdio: 'pipe',
    });
    running.push(child);
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
  });
});
