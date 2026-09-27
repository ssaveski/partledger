import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { organizationClaim } from './jwks';
import { KeycloakIdentityProvider } from './keycloak-identity-provider';

const clientId = 'partledger-api';
const tenantId = '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01';
const subject = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

type CertsBehaviour = 'serve' | 'fail' | 'hang';

/** A stand-in realm: discovery, a token endpoint that always refreshes, and a JWKS endpoint whose behaviour the test sets. */
describe('the Keycloak identity provider', () => {
  let server: Server;
  let issuer: string;
  let certs: CertsBehaviour = 'serve';
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let publicJwk: Record<string, unknown>;

  async function token(claims: JWTPayload): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: issuer,
      sub: subject,
      iat: now,
      exp: now + 300,
      [organizationClaim]: { synthetic: { id: randomUUID(), tenant_id: [tenantId] } },
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'realm-key' })
      .sign(signingKey);
  }

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    signingKey = keys.privateKey;
    publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'realm-key', alg: 'RS256', use: 'sig' };
    server = createServer((request, response) => {
      void (async () => {
        const path = request.url ?? '';
        if (path.endsWith('/.well-known/openid-configuration')) {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              issuer,
              authorization_endpoint: `${issuer}/auth`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/certs`,
              end_session_endpoint: `${issuer}/logout`,
            }),
          );
        } else if (path.endsWith('/token')) {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              access_token: await token({ aud: [clientId], typ: 'Bearer', azp: clientId }),
              id_token: await token({ aud: clientId, typ: 'ID' }),
              refresh_token: 'synthetic-refresh-token',
            }),
          );
        } else if (path.endsWith('/certs')) {
          if (certs === 'fail') {
            response.statusCode = 503;
            response.end('unavailable');
          } else if (certs === 'serve') {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ keys: [publicJwk] }));
          }
        } else {
          response.statusCode = 404;
          response.end();
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    issuer = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/realms/synthetic`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function provider(): KeycloakIdentityProvider {
    return new KeycloakIdentityProvider({
      issuer,
      clientId,
      clientSecret: 'placeholder-secret',
      jwksCooldownSeconds: 0,
    });
  }

  it('refreshes when the realm serves its keys', async () => {
    certs = 'serve';
    expect(await provider().refresh('synthetic-refresh-token', new Date())).toMatchObject({
      kind: 'refreshed',
      identity: { subject, tenantId },
    });
  });

  it('keeps the session when the realm cannot serve its keys', async () => {
    certs = 'fail';
    expect(await provider().refresh('synthetic-refresh-token', new Date())).toEqual({ kind: 'unavailable' });
    expect(
      await provider().exchangeCode(
        { code: 'synthetic-code', codeVerifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:5173/cb', nonce: 'n' },
        new Date(),
      ),
    ).toEqual({ ok: false, error: 'unavailable' });
  });

  it('keeps the session when fetching the keys times out', async () => {
    certs = 'hang';
    expect(await provider().refresh('synthetic-refresh-token', new Date())).toEqual({ kind: 'unavailable' });
  }, 15_000);
});
