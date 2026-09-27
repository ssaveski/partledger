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
  CELL_REGION: 'ca',
  DIRECTORY_REGION_URLS: 'ca=https://ca.example.test,eu=https://eu.example.test',
  KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET: 'placeholder-organizations-secret',
  OPERATOR_KEYCLOAK_ISSUER: 'http://127.0.0.1:8080/realms/partledger-operators',
};

/** The key service and AI settings production requires (U11). */
const productionKeysAndAi = {
  KEY_SERVICE_ADAPTER: 'ovh_kms',
  OVH_KMS_ENDPOINT: 'https://ca-east-bhs.okms.ovh.net',
  OVH_KMS_ID: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  OVH_KMS_ENCRYPTION_KEY_ID: '4a2b3c5d-6e7f-4b8c-9d0e-1f2a3b4c5d6e',
  OVH_KMS_SIGNING_KEY_ID: '5b3c4d6e-7f80-4c9d-8e1f-2a3b4c5d6e7f',
  OVH_KMS_CLIENT_CERTIFICATE_FILE: '/run/secrets/kms-client.crt',
  OVH_KMS_CLIENT_KEY_FILE: '/run/secrets/kms-client.key',
  AI_PLATFORM_PROVIDER: 'none',
  AI_WORKER_DATABASE_URL: 'postgres://pl_ai_worker:placeholder@127.0.0.1:5432/partledger',
};

/** Object storage and the malware scanner as production must name them (U14). */
const productionUploads = {
  STORAGE_ADAPTER: 's3',
  S3_ENDPOINT: 'https://s3.bhs.example.test',
  S3_ACCESS_KEY_ID: 'placeholder-access-key',
  S3_SECRET_ACCESS_KEY: 'placeholder-secret-key',
  MALWARE_SCANNER: 'clamd',
  CLAMD_HOST: 'clamd',
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
      CELL_REGION: 'ca',
      DIRECTORY_REGION_URLS: { ca: 'https://ca.example.test', eu: 'https://eu.example.test' },
      KEYCLOAK_ORGANIZATIONS_CLIENT_ID: 'partledger-api-organizations',
      KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET: 'placeholder-organizations-secret',
      OPERATOR_KEYCLOAK_ISSUER: 'http://127.0.0.1:8080/realms/partledger-operators',
      OPERATOR_KEYCLOAK_CLIENT_ID: 'partledger-operator-console',
      OPERATOR_KEYCLOAK_AUDIENCE: 'partledger-operator-api',
      AI_WORKER_DATABASE_POOL_SIZE: 2,
      AI_CALL_TIMEOUT_SECONDS: 120,
      STORAGE_LOCAL_DIRECTORY: 'local-dev/object-storage',
      STORAGE_QUARANTINE_BUCKET: 'partledger-quarantine',
      STORAGE_EVIDENCE_BUCKET: 'partledger-evidence',
      STORAGE_IMPORTS_BUCKET: 'partledger-imports',
      S3_REGION: 'bhs',
      S3_FORCE_PATH_STYLE: 'off',
      CLAMD_PORT: 3310,
      CLAMD_TIMEOUT_SECONDS: 60,
      UPLOAD_LINK_QUOTA_FILES: 25,
      UPLOAD_LINK_QUOTA_BYTES: 250 * 1024 * 1024,
      UPLOAD_TENANT_DAILY_QUOTA_FILES: 2_000,
      UPLOAD_TENANT_DAILY_QUOTA_BYTES: 4 * 1024 * 1024 * 1024,
    });
  });

  it('refuses directory region URLs that do not name this deployment’s region or are not origins', () => {
    const base = { NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth };
    expect(fieldsRefusedIn({ ...base, DIRECTORY_REGION_URLS: 'eu=https://eu.example.test' })).toContain(
      'DIRECTORY_REGION_URLS',
    );
    expect(fieldsRefusedIn({ ...base, DIRECTORY_REGION_URLS: 'ca=https://ca.example.test/path' })).toContain(
      'DIRECTORY_REGION_URLS',
    );
    expect(fieldsRefusedIn({ ...base, DIRECTORY_REGION_URLS: 'ca=https://a.test,ca=https://b.test' })).toContain(
      'DIRECTORY_REGION_URLS',
    );
    expect(fieldsRefusedIn({ ...base, CELL_REGION: 'us' })).toContain('CELL_REGION');
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

  it('requires https for the staff app, the supplier portal, both Keycloak realms and the directory in production', () => {
    expect(
      fieldsRefusedIn({
        NODE_ENV: 'production',
        ...ports,
        DATABASE_URL: databaseUrl,
        ...auth,
        DIRECTORY_REGION_URLS: 'ca=http://ca.example.test',
      }),
    ).toEqual([
      'STAFF_APP_ORIGIN',
      'PORTAL_APP_ORIGIN',
      'KEYCLOAK_ISSUER',
      'OPERATOR_KEYCLOAK_ISSUER',
      'EMAIL_ADAPTER',
      'OPERATIONAL_ALERT_FALLBACK_EMAIL',
      'DIRECTORY_REGION_URLS',
      'KEY_SERVICE_ADAPTER',
      'AI_PLATFORM_PROVIDER',
      'AI_WORKER_DATABASE_URL',
      'STORAGE_ADAPTER',
      'MALWARE_SCANNER',
    ]);
    expect(
      fieldsRefusedIn({
        NODE_ENV: 'production',
        ...ports,
        DATABASE_URL: databaseUrl,
        ...auth,
        ...productionKeysAndAi,
        STAFF_APP_ORIGIN: 'https://app.example',
        PORTAL_APP_ORIGIN: 'https://suppliers.example',
        KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
        OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
        OPERATOR_KEYCLOAK_ISSUER: 'https://operators.example/realms/partledger-operators',
        ...productionUploads,
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
      ...productionKeysAndAi,
      STAFF_APP_ORIGIN: 'https://app.example',
      PORTAL_APP_ORIGIN: 'https://suppliers.example',
      KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
      OPERATOR_KEYCLOAK_ISSUER: 'https://operators.example/realms/partledger-operators',
      OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
      ...productionUploads,
    };
    expect(fieldsRefusedIn({ ...production, EMAIL_ADAPTER: 'local' })).toEqual(['EMAIL_ADAPTER']);
    expect(fieldsRefusedIn({ ...production, NODE_ENV: 'development', EMAIL_ADAPTER: 'local' })).toEqual([]);
    expect(fieldsRefusedIn({ ...production, NODE_ENV: 'development' })).toEqual([]);
  });

  it('refuses the local key service and the local AI adapter in production, and requires the AI worker connection', () => {
    const production = {
      NODE_ENV: 'production',
      ...ports,
      DATABASE_URL: databaseUrl,
      ...auth,
      ...productionKeysAndAi,
      ...productionUploads,
      STAFF_APP_ORIGIN: 'https://app.example',
      PORTAL_APP_ORIGIN: 'https://suppliers.example',
      KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
      OPERATOR_KEYCLOAK_ISSUER: 'https://operators.example/realms/partledger-operators',
      OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
      EMAIL_ADAPTER: 'local',
    };
    expect(
      fieldsRefusedIn({
        ...production,
        KEY_SERVICE_ADAPTER: 'local',
        AI_PLATFORM_PROVIDER: 'local',
        AI_WORKER_DATABASE_URL: undefined,
      }),
    ).toEqual(['EMAIL_ADAPTER', 'KEY_SERVICE_ADAPTER', 'AI_PLATFORM_PROVIDER', 'AI_WORKER_DATABASE_URL']);
    expect(
      fieldsRefusedIn({
        ...production,
        NODE_ENV: 'development',
        KEY_SERVICE_ADAPTER: undefined,
        AI_PLATFORM_PROVIDER: undefined,
        AI_WORKER_DATABASE_URL: undefined,
      }),
    ).toEqual([]);
  });

  it('refuses a KMS adapter without every KMS setting, and a KMS endpoint outside OVHcloud KMS', () => {
    const base = { NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth };
    expect(fieldsRefusedIn({ ...base, KEY_SERVICE_ADAPTER: 'ovh_kms' })).toEqual([
      'OVH_KMS_ENDPOINT',
      'OVH_KMS_ID',
      'OVH_KMS_ENCRYPTION_KEY_ID',
      'OVH_KMS_SIGNING_KEY_ID',
      'OVH_KMS_CLIENT_CERTIFICATE_FILE',
      'OVH_KMS_CLIENT_KEY_FILE',
    ]);
    expect(fieldsRefusedIn({ ...base, OVH_KMS_ENDPOINT: 'https://169.254.169.254' })).toEqual(['OVH_KMS_ENDPOINT']);
  });

  it('requires the model and key of a platform AI provider, and the resource and region Azure needs', () => {
    const base = { NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth };
    expect(fieldsRefusedIn({ ...base, AI_PLATFORM_PROVIDER: 'azure_openai' })).toEqual([
      'AI_PLATFORM_MODEL',
      'AI_PLATFORM_API_KEY',
      'AI_PLATFORM_AZURE_RESOURCE_NAME',
      'AI_PLATFORM_ENDPOINT_REGION',
    ]);
    expect(fieldsRefusedIn({ ...base, AI_PLATFORM_PROVIDER: 'none' })).toEqual([]);
  });

  it('refuses local object storage and the local malware scanner in production, even when named explicitly', () => {
    const production = {
      NODE_ENV: 'production',
      ...ports,
      DATABASE_URL: databaseUrl,
      ...auth,
      ...productionKeysAndAi,
      STAFF_APP_ORIGIN: 'https://app.example',
      PORTAL_APP_ORIGIN: 'https://suppliers.example',
      KEYCLOAK_ISSUER: 'https://id.example/realms/partledger',
      OPERATOR_KEYCLOAK_ISSUER: 'https://operators.example/realms/partledger-operators',
      OPERATIONAL_ALERT_FALLBACK_EMAIL: 'operator@platform.example',
      ...productionUploads,
    };
    expect(fieldsRefusedIn({ ...production, STORAGE_ADAPTER: 'local', MALWARE_SCANNER: 'local' })).toEqual([
      'EMAIL_ADAPTER',
      'STORAGE_ADAPTER',
      'MALWARE_SCANNER',
    ]);
    expect(fieldsRefusedIn({ ...production, S3_ENDPOINT: 'http://s3.bhs.example.test' })).toEqual([
      'EMAIL_ADAPTER',
      'S3_ENDPOINT',
    ]);
    expect(
      fieldsRefusedIn({ ...production, NODE_ENV: 'development', STORAGE_ADAPTER: 'local', MALWARE_SCANNER: 'local' }),
    ).toEqual([]);
  });

  it('requires the endpoint and credentials for S3 storage and the host for clamd', () => {
    const base = { NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth };
    expect(fieldsRefusedIn({ ...base, STORAGE_ADAPTER: 's3' })).toEqual([
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]);
    expect(fieldsRefusedIn({ ...base, MALWARE_SCANNER: 'clamd' })).toEqual(['CLAMD_HOST']);
  });

  it('refuses one bucket for two roles and a bucket name S3 would not accept', () => {
    const base = { NODE_ENV: 'test', ...ports, DATABASE_URL: databaseUrl, ...auth };
    expect(fieldsRefusedIn({ ...base, STORAGE_IMPORTS_BUCKET: 'partledger-quarantine' })).toEqual([
      'STORAGE_QUARANTINE_BUCKET',
    ]);
    expect(fieldsRefusedIn({ ...base, STORAGE_EVIDENCE_BUCKET: 'Evidence_Bucket' })).toEqual([
      'STORAGE_EVIDENCE_BUCKET',
    ]);
  });
});
