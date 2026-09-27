import { randomBytes } from 'node:crypto';

/**
 * The sign-in and tenancy settings every API configuration needs (KTD20, R1). Tests that do not
 * sign in through Keycloak point it at unreachable placeholder realms; the session key and
 * client secrets are random per call, never fixed values in the repository.
 */
export function placeholderAuthEnvironment(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    STAFF_APP_ORIGIN: 'http://127.0.0.1:5173',
    KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/partledger',
    KEYCLOAK_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    KEYCLOAK_ADMIN_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    SESSION_TOKEN_KEY: randomBytes(32).toString('base64'),
    CELL_REGION: 'ca',
    DIRECTORY_REGION_URLS: 'ca=http://127.0.0.1:5173,eu=http://127.0.0.1:6173',
    KEYCLOAK_ADMIN_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    OPERATOR_KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/partledger-operators',
    ...overrides,
  };
}
