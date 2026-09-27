import { describe, expect, it } from 'vitest';

import { adminBaseOf, KeycloakIdentityAdministration } from './keycloak-identity-administration';

describe('the Keycloak identity administration', () => {
  it('finds the admin API beside the realm, keeping any context path', () => {
    expect(adminBaseOf('https://id.synthetic.test/realms/partledger')).toBe(
      'https://id.synthetic.test/admin/realms/partledger',
    );
    expect(adminBaseOf('http://127.0.0.1:8080/auth/realms/partledger')).toBe(
      'http://127.0.0.1:8080/auth/admin/realms/partledger',
    );
    expect(() => adminBaseOf('https://id.synthetic.test/partledger')).toThrow();
  });

  it('answers unavailable, never throws, when Keycloak cannot be reached', async () => {
    const administration = new KeycloakIdentityAdministration({
      issuer: 'http://127.0.0.1:1/realms/partledger',
      clientId: 'partledger-api-admin',
      clientSecret: 'placeholder-admin-secret',
    });
    const userId = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(await administration.tenantsOf(userId)).toEqual({ ok: false, error: 'unavailable' });
    expect(await administration.resetSecondFactor(userId)).toEqual({ ok: false, error: 'unavailable' });
  });
});
