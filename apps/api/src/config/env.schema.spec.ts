import { describe, expect, it } from 'vitest';

import { InvalidConfigurationError, parseConfig } from './env.schema';

const databaseUrl = 'postgres://pl_app:placeholder@127.0.0.1:5432/partledger';

describe('API configuration', () => {
  it('accepts a valid environment', () => {
    expect(parseConfig({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL: databaseUrl })).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_SIZE: 10,
    });
  });

  it('refuses an invalid PORT and names the field', () => {
    expect(() => parseConfig({ NODE_ENV: 'test', PORT: 'eighty', DATABASE_URL: databaseUrl })).toThrow(/PORT/);
    expect(() => parseConfig({ NODE_ENV: 'test', PORT: '70000', DATABASE_URL: databaseUrl })).toThrow(
      InvalidConfigurationError,
    );
  });

  it('refuses an unknown NODE_ENV and names the field', () => {
    try {
      parseConfig({ NODE_ENV: 'staging', PORT: '3000', DATABASE_URL: databaseUrl });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['NODE_ENV']);
      expect(String(error)).toMatch(/NODE_ENV/);
    }
  });

  it('refuses a missing or non-PostgreSQL DATABASE_URL and names the field', () => {
    for (const DATABASE_URL of [undefined, 'https://127.0.0.1/partledger', 'not a url']) {
      try {
        parseConfig({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL });
        expect.unreachable();
      } catch (error) {
        expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['DATABASE_URL']);
      }
    }
  });
});
