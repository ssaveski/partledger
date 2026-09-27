import { describe, expect, it } from 'vitest';

import { InvalidConfigurationError, parseConfig } from './env.schema';

const databaseUrl = 'postgres://pl_app:placeholder@127.0.0.1:5432/partledger';
const ports = { STAFF_PORT: '3000', PORTAL_PORT: '3001', DROP_PORT: '3002', OPERATOR_PORT: '3003' };

describe('API configuration', () => {
  it('accepts a valid environment', () => {
    expect(parseConfig({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl })).toEqual({
      NODE_ENV: 'test',
      STAFF_PORT: 3000,
      PORTAL_PORT: 3001,
      DROP_PORT: 3002,
      OPERATOR_PORT: 3003,
      HOST: '127.0.0.1',
      OPERATOR_HOST: '127.0.0.1',
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_SIZE: 10,
    });
  });

  it('refuses an invalid STAFF_PORT and names the field', () => {
    expect(() => parseConfig({ NODE_ENV: 'test', ...ports, STAFF_PORT: 'eighty', DATABASE_URL: databaseUrl })).toThrow(
      /STAFF_PORT/,
    );
    expect(() => parseConfig({ NODE_ENV: 'test', ...ports, STAFF_PORT: '70000', DATABASE_URL: databaseUrl })).toThrow(
      InvalidConfigurationError,
    );
  });

  it('refuses a missing listener port and names the field', () => {
    try {
      parseConfig({ NODE_ENV: 'test', ...ports, OPERATOR_PORT: undefined, DATABASE_URL: databaseUrl });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['OPERATOR_PORT']);
    }
  });

  it('refuses two listeners on the same port and names the second one', () => {
    try {
      parseConfig({ NODE_ENV: 'test', ...ports, DROP_PORT: '3001', DATABASE_URL: databaseUrl });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['DROP_PORT']);
    }
  });

  it('refuses an unknown NODE_ENV and names the field', () => {
    try {
      parseConfig({ NODE_ENV: 'staging', ...ports, DATABASE_URL: databaseUrl });
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
        parseConfig({ NODE_ENV: 'test', ...ports, DATABASE_URL });
        expect.unreachable();
      } catch (error) {
        expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['DATABASE_URL']);
      }
    }
  });
});
