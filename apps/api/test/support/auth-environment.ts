import { randomBytes } from 'node:crypto';

/**
 * The staff sign-in settings every API configuration needs (KTD20). Tests that do not sign in
 * through Keycloak point it at an unreachable placeholder realm; the session key is random
 * per call, never a fixed value in the repository.
 */
export function placeholderAuthEnvironment(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    STAFF_APP_ORIGIN: 'http://127.0.0.1:5173',
    KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/partledger',
    KEYCLOAK_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    SESSION_TOKEN_KEY: randomBytes(32).toString('base64'),
    ...overrides,
  };
}
