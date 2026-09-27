import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OperatorAuthenticator } from './operator.listener';

const clientId = 'partledger-operator-console';
const audience = 'partledger-operator-api';

describe('operator sign-in on the operator listener', () => {
  let server: Server;
  let issuer: string;
  let sign: (claims: JWTPayload, options?: { readonly expiresIn?: string }) => Promise<string>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const key = { ...(await exportJWK(publicKey)), kid: 'operator-key', use: 'sig', alg: 'RS256' };
    server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.endsWith('/.well-known/openid-configuration') === true) {
        response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/keys` }));
      } else {
        response.end(JSON.stringify({ keys: [key] }));
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No address');
    }
    issuer = `http://127.0.0.1:${address.port}/realms/partledger-operators`;
    sign = (claims, options = {}) =>
      new SignJWT({ typ: 'Bearer', azp: clientId, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'operator-key' })
        .setIssuer(typeof claims.iss === 'string' ? claims.iss : issuer)
        .setAudience(claims.aud ?? audience)
        .setSubject(claims.sub ?? randomUUID())
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(privateKey);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function authenticator() {
    return new OperatorAuthenticator({ issuer, clientId, audience });
  }

  it('accepts an access token from the operator realm, issued to the operator console for the operator API', async () => {
    const operatorId = randomUUID();
    expect(await authenticator().authenticate(`Bearer ${await sign({ sub: operatorId })}`, new Date())).toEqual({
      ok: true,
      value: { operatorId },
    });
  });

  it('refuses a missing header, another audience, another client, another issuer, an expired or an impersonated token', async () => {
    const refusals = [
      undefined,
      `Basic ${await sign({})}`,
      `Bearer ${await sign({ aud: 'partledger-api' })}`,
      `Bearer ${await sign({ azp: 'partledger-api' })}`,
      `Bearer ${await sign({ iss: 'http://127.0.0.1:1/realms/partledger' })}`,
      `Bearer ${await sign({}, { expiresIn: '-1m' })}`,
      `Bearer ${await sign({ impersonator: { id: randomUUID() } })}`,
      `Bearer ${await sign({ typ: 'ID' })}`,
      'Bearer not-a-token',
    ];
    for (const header of refusals) {
      expect(await authenticator().authenticate(header, new Date()), header).toEqual({ ok: false, error: 'refused' });
    }
  });

  it('answers unavailable, not refused, when the operator realm cannot be reached', async () => {
    const unreachable = new OperatorAuthenticator({
      issuer: 'http://127.0.0.1:1/realms/partledger-operators',
      clientId,
      audience,
    });
    expect(await unreachable.authenticate(`Bearer ${await sign({})}`, new Date())).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});
