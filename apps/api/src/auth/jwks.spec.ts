import { randomUUID } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { organizationClaim, verifyStaffToken, type TokenExpectations } from './jwks';

const issuer = 'https://id.synthetic.test/realms/partledger';
const clientId = 'partledger-api';
const now = new Date('2026-09-27T12:00:00Z');
const tenantId = '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01';
const subject = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const nowSeconds = Math.floor(now.getTime() / 1000);

type Signer = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

async function signingKey(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

function organization(tenant: string | null, alias = 'synthetic-tenant') {
  return { [alias]: tenant === null ? { id: randomUUID() } : { id: randomUUID(), tenant_id: [tenant] } };
}

function accessClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    iss: issuer,
    aud: [clientId, 'account'],
    sub: subject,
    typ: 'Bearer',
    azp: clientId,
    iat: nowSeconds - 10,
    exp: nowSeconds + 300,
    [organizationClaim]: organization(tenantId),
    ...overrides,
  };
}

async function sign(key: { kid: string; privateKey: Signer }, claims: JWTPayload): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' }).sign(key.privateKey);
}

describe('staff token validation', () => {
  let current: Awaited<ReturnType<typeof signingKey>>;
  let stranger: Awaited<ReturnType<typeof signingKey>>;
  let expectations: TokenExpectations;

  beforeAll(async () => {
    current = await signingKey('current');
    stranger = await signingKey('current');
    expectations = {
      keys: createLocalJWKSet({ keys: [current.jwk] }),
      issuer,
      clientId,
      kind: 'access',
      now,
    };
  });

  it('accepts a token of the realm naming exactly one organization, and takes the tenant from it', async () => {
    const result = await verifyStaffToken(await sign(current, accessClaims()), expectations);
    expect(result).toMatchObject({ ok: true, value: { subject, tenantId } });
  });

  it('refuses a token from another issuer', async () => {
    const token = await sign(current, accessClaims({ iss: 'https://id.synthetic.test/realms/other' }));
    expect(await verifyStaffToken(token, expectations)).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('refuses a token signed with a key the realm does not publish', async () => {
    expect(await verifyStaffToken(await sign(stranger, accessClaims()), expectations)).toEqual({
      ok: false,
      error: 'invalid_token',
    });
  });

  it('refuses an expired token', async () => {
    const token = await sign(current, accessClaims({ iat: nowSeconds - 900, exp: nowSeconds - 60 }));
    expect(await verifyStaffToken(token, expectations)).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('refuses a token for another audience or another client', async () => {
    expect(await verifyStaffToken(await sign(current, accessClaims({ aud: 'account' })), expectations)).toEqual({
      ok: false,
      error: 'invalid_token',
    });
    expect(await verifyStaffToken(await sign(current, accessClaims({ azp: 'another-client' })), expectations)).toEqual({
      ok: false,
      error: 'wrong_authorized_party',
    });
  });

  it('refuses a token naming zero or several organizations, or an organization without one tenant id', async () => {
    const cases: readonly [unknown, string][] = [
      [undefined, 'no_organization'],
      [{}, 'no_organization'],
      [{ ...organization(tenantId, 'first'), ...organization(randomUUID(), 'second') }, 'several_organizations'],
      [organization(null), 'organization_without_tenant'],
      [{ alias: { id: randomUUID(), tenant_id: [tenantId, randomUUID()] } }, 'organization_without_tenant'],
      [{ alias: { id: randomUUID(), tenant_id: ['not-a-uuid'] } }, 'organization_without_tenant'],
      [['synthetic-tenant'], 'invalid_token'],
    ];
    for (const [claim, error] of cases) {
      const token = await sign(current, accessClaims({ [organizationClaim]: claim }));
      expect(await verifyStaffToken(token, expectations), JSON.stringify(claim)).toEqual({ ok: false, error });
    }
  });

  it('refuses a token carrying an impersonator or delegation claim', async () => {
    for (const claim of [
      { impersonator: { id: randomUUID(), username: 'synthetic-admin' } },
      { act: { sub: randomUUID() } },
    ]) {
      const token = await sign(current, accessClaims(claim));
      expect(await verifyStaffToken(token, expectations)).toEqual({ ok: false, error: 'impersonated' });
    }
  });

  it('refuses a token whose subject is not a uuid', async () => {
    const token = await sign(current, accessClaims({ sub: 'synthetic-user' }));
    expect(await verifyStaffToken(token, expectations)).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('refuses an id token presented as an access token, and checks the nonce of an id token', async () => {
    const idToken = await sign(current, accessClaims({ typ: 'ID', aud: clientId, nonce: 'expected-nonce' }));
    expect(await verifyStaffToken(idToken, expectations)).toEqual({ ok: false, error: 'wrong_token_type' });
    expect(await verifyStaffToken(idToken, { ...expectations, kind: 'id', nonce: 'expected-nonce' })).toMatchObject({
      ok: true,
    });
    expect(await verifyStaffToken(idToken, { ...expectations, kind: 'id', nonce: 'another-nonce' })).toEqual({
      ok: false,
      error: 'nonce_mismatch',
    });
  });

  it('accepts tokens signed with a rotated key once the key set names it', async () => {
    const rotated = await signingKey('rotated');
    const token = await sign(rotated, accessClaims());
    expect(await verifyStaffToken(token, expectations)).toEqual({ ok: false, error: 'invalid_token' });
    const refreshed = { ...expectations, keys: createLocalJWKSet({ keys: [current.jwk, rotated.jwk] }) };
    expect(await verifyStaffToken(token, refreshed)).toMatchObject({ ok: true });
  });
});
