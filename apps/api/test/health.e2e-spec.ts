import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@partledger/contracts';
import { startTestDatabase, type TestDatabase } from '@partledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap';
import { parseConfig } from '../src/config/env.schema';

describe('health endpoint', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createApp(
      parseConfig({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL: database.connectionString('pl_app') }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
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
});
