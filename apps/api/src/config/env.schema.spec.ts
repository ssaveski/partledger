import { describe, expect, it } from 'vitest';

import { InvalidConfigurationError, parseConfig } from './env.schema';

const databaseUrl = 'postgres://pl_app:placeholder@127.0.0.1:5432/partledger';
const jobsDatabaseUrl = 'postgres://pl_job_runner:placeholder@127.0.0.1:5432/partledger';
const ports = { STAFF_PORT: '3000', PORTAL_PORT: '3001', DROP_PORT: '3002', OPERATOR_PORT: '3003' };
const sessionKey = Buffer.alloc(32, 7);
const auth = {
  STAFF_APP_ORIGIN: 'http://127.0.0.1:5173',
  KEYCLOAK_ISSUER: 'http://127.0.0.1:8080/realms/partledger/',
  KEYCLOAK_CLIENT_SECRET: 'placeholder-client-secret',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'placeholder-admin-secret',
  SESSION_TOKEN_KEY: sessionKey.toString('base64'),
  JOBS_DATABASE_URL: jobsDatabaseUrl,
};

function fieldsRefusedIn(environment: Readonly<Record<string, string | undefined>>): readonly string[] {
  try {
    parseConfig(environment);
  } catch (error) {
    return error instanceof InvalidConfigurationError ? error.fields : [];
  }
  return [];
}

describe('API configuration', () => {
  it('accepts a valid environment', () => {
    expect(parseConfig({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth })).toEqual({
      NODE_ENV: 'test',
      STAFF_PORT: 3000,
      PORTAL_PORT: 3001,
      DROP_PORT: 3002,
      OPERATOR_PORT: 3003,
      HOST: '127.0.0.1',
      OPERATOR_HOST: '127.0.0.1',
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_SIZE: 10,
      STAFF_APP_ORIGIN: 'http://127.0.0.1:5173',
      KEYCLOAK_ISSUER: 'http://127.0.0.1:8080/realms/partledger',
      KEYCLOAK_CLIENT_ID: 'partledger-api',
      KEYCLOAK_CLIENT_SECRET: 'placeholder-client-secret',
      KEYCLOAK_ADMIN_CLIENT_ID: 'partledger-api-admin',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'placeholder-admin-secret',
      STEP_UP_ACR: 'step-up',
      STEP_UP_FRESHNESS_SECONDS: 300,
      KEYCLOAK_JWKS_COOLDOWN_SECONDS: 30,
      SESSION_TOKEN_KEY: sessionKey,
      STAFF_SESSION_IDLE_TIMEOUT_MINUTES: 30,
      STAFF_SESSION_ABSOLUTE_TIMEOUT_HOURS: 10,
      STAFF_SESSION_REFRESH_INTERVAL_SECONDS: 60,
      JOBS_DATABASE_URL: jobsDatabaseUrl,
      JOBS_DATABASE_POOL_SIZE: 5,
      JOBS_WORKERS: 'on',
      PORTAL_APP_ORIGIN: 'http://127.0.0.1:5174',
      EMAIL_LOCAL_INBOX_DIRECTORY: 'local-dev/email-inbox',
      EMAIL_FROM_ADDRESS: 'notifications@partledger.invalid',
    });
  });

  it('refuses an invalid STAFF_PORT and names the field', () => {
    expect(() =>
      parseConfig({ NODE_ENV: 'test', ...ports, STAFF_PORT: 'eighty', DATABASE_URL: databaseUrl, ...auth }),
    ).toThrow(/STAFF_PORT/);
    expect(() =>
      parseConfig({ NODE_ENV: 'test', ...ports, STAFF_PORT: '70000', DATABASE_URL: databaseUrl, ...auth }),
    ).toThrow(InvalidConfigurationError);
  });

  it('refuses a missing listener port and names the field', () => {
    expect(
      fieldsRefusedIn({ NODE_ENV: 'test', ...ports, OPERATOR_PORT: undefined, DATABASE_URL: databaseUrl, ...auth }),
    ).toEqual(['OPERATOR_PORT']);
  });

  it('refuses two listeners on the same port and names the second one', () => {
    expect(
      fieldsRefusedIn({ NODE_ENV: 'test', ...ports, DROP_PORT: '3001', DATABASE_URL: databaseUrl, ...auth }),
    ).toEqual(['DROP_PORT']);
  });

  it('refuses an unknown NODE_ENV and names the field', () => {
    try {
      parseConfig({ NODE_ENV: 'staging', ...ports, DATABASE_URL: databaseUrl, ...auth });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['NODE_ENV']);
      expect(String(error)).toMatch(/NODE_ENV/);
    }
  });

  it('refuses a missing or non-PostgreSQL DATABASE_URL and names the field', () => {
    for (const DATABASE_URL of [undefined, 'https://127.0.0.1/partledger', 'not a url']) {
      expect(fieldsRefusedIn({ NODE_ENV: 'test', ...ports, DATABASE_URL, ...auth })).toEqual(['DATABASE_URL']);
    }
  });

  it('refuses a missing JOBS_DATABASE_URL or an unknown JOBS_WORKERS setting and names the field', () => {
    expect(
      fieldsRefusedIn({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth, JOBS_DATABASE_URL: undefined }),
    ).toEqual(['JOBS_DATABASE_URL']);
    expect(
      fieldsRefusedIn({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth, JOBS_WORKERS: 'sometimes' }),
    ).toEqual(['JOBS_WORKERS']);
  });

  it('refuses a staff app origin with a path or trailing slash', () => {
    for (const STAFF_APP_ORIGIN of ['https://app.example/', 'https://app.example/staff', 'app.example']) {
      expect(
        fieldsRefusedIn({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth, STAFF_APP_ORIGIN }),
      ).toEqual(['STAFF_APP_ORIGIN']);
    }
  });

  it('refuses a session token key that is not 32 bytes of base64 and never echoes it', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');
    try {
      parseConfig({ NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth, SESSION_TOKEN_KEY: shortKey });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['SESSION_TOKEN_KEY']);
      expect(String(error)).not.toContain(shortKey);
    }
  });

  it('refuses a missing Keycloak client secret', () => {
    expect(
      fieldsRefusedIn({
        NODE_ENV: 'test',
        ...ports,
        DATABASE_URL: databaseUrl,
        ...auth,
        KEYCLOAK_CLIENT_SECRET: undefined,
      }),
    ).toEqual(['KEYCLOAK_CLIENT_SECRET']);
  });

  it('refuses a missing admin client secret, a step-up level that is not a token and a freshness window out of range', () => {
    expect(
      fieldsRefusedIn({
        NODE_ENV: 'test',
        ...ports,
        DATABASE_URL: databaseUrl,
        ...auth,
        KEYCLOAK_ADMIN_CLIENT_SECRET: undefined,
        STEP_UP_ACR: 'step up',
        STEP_UP_FRESHNESS_SECONDS: '3600',
      }),
    ).toEqual(['KEYCLOAK_ADMIN_CLIENT_SECRET', 'STEP_UP_ACR', 'STEP_UP_FRESHNESS_SECONDS']);
  });

  it('requires https for the staff app, the supplier portal and Keycloak in production', () => {
    expect(fieldsRefusedIn({ NODE_ENV: 'production', ...ports, DATABASE_URL: databaseUrl, ...auth })).toEqual([
      'STAFF_APP_ORIGIN',
      'PORTAL_APP_ORIGIN',
      'KEYCLOAK_ISSUER',
      'EMAIL_ADAPTER',
      'OPERATIONAL_ALERT_FALLBACK_EMAIL',
    ]);
    expect(
      fieldsRefusedIn({
        NODE_ENV: 'production',
        ...ports,
        DATABASE_URL: databaseUrl,
        ...auth,
        STAFF_APP_ORIGIN: 'https://app.example',
        PORTAL_APP_ORIGIN: 'https://suppliers.example',
        KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
        OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
      }),
      // Only a sending adapter is missing: U24 adds the production provider's.
    ).toEqual(['EMAIL_ADAPTER']);
  });

  it('refuses the local email adapter in production, even when named explicitly, and accepts it elsewhere', () => {
    const production = {
      NODE_ENV: 'production',
      ...ports,
      DATABASE_URL: databaseUrl,
      ...auth,
      STAFF_APP_ORIGIN: 'https://app.example',
      PORTAL_APP_ORIGIN: 'https://suppliers.example',
      KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
      OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
    };
    expect(fieldsRefusedIn({ ...production, EMAIL_ADAPTER: 'local' })).toEqual(['EMAIL_ADAPTER']);
    expect(fieldsRefusedIn({ ...production, NODE_ENV: 'development', EMAIL_ADAPTER: 'local' })).toEqual([]);
    expect(fieldsRefusedIn({ ...production, NODE_ENV: 'development' })).toEqual([]);
  });
});
