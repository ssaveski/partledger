import { describe, expect, it } from 'vitest';

import {
  credentialSecretSchema,
  generateCredentialSecret,
  hashCredentialSecret,
  verifyCredential,
  type ParameterisedQueryable,
} from './credential-store.ts';

const unreachableDatabase: ParameterisedQueryable = {
  query() {
    throw new Error('The database must not be queried');
  },
};

describe('credential secrets', () => {
  it('generates a 256-bit secret encoded as 43 base64url characters, fresh every time', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateCredentialSecret()));
    expect(secrets.size).toBe(100);
    for (const secret of secrets) {
      expect(credentialSecretSchema.safeParse(secret).success).toBe(true);
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes a secret with SHA-256', () => {
    expect(hashCredentialSecret('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('refuses a malformed id or secret as unknown without querying the database', async () => {
    const now = new Date();
    const secret = generateCredentialSecret();
    expect(await verifyCredential(unreachableDatabase, { kind: 'supplier_link', id: 'plk_1', secret }, now)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(
      await verifyCredential(
        unreachableDatabase,
        { kind: 'supplier_link', id: '0b0f7f3e-8a45-4a4e-9a57-5a1f0c1d2e3f', secret: 'short' },
        now,
      ),
    ).toEqual({ ok: false, reason: 'unknown' });
  });
});
