import { healthResponseSchema } from '@partledger/contracts';
import { startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type RunningApi } from '../src/bootstrap';
import { parseConfig } from '../src/config/env.schema';

describe('health endpoint', () => {
  let database: TestDatabase;
  let api: RunningApi;
  let baseUrl: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    const loopback = { host: '127.0.0.1', port: 0 };
    api = await startApi(
      parseConfig({
        NODE_ENV: 'test',
        STAFF_PORT: '3000',
        PORTAL_PORT: '3001',
        DROP_PORT: '3002',
        OPERATOR_PORT: '3003',
        DATABASE_URL: database.connectionString('pl_app'),
      }),
      { staff: loopback, portal: loopback, drop: loopback, operator: loopback },
    );
    baseUrl = api.listeners.urls.staff;
  });

  afterAll(async () => {
    await api.close();
    await database.stop();
  });

  it('answers 200 on /api/v1/health with a body its schema parses', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });

  it('answers 404 on the unprefixed /health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
  });

  it('answers an unknown path under /api/v1 with 404 and a message key', async () => {
    const response = await fetch(`${baseUrl}/api/v1/nothing-here`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'NotFound', message: 'pl.error.notFound.route', params: {} });
  });
});
