import { randomBytes, randomUUID } from 'node:crypto';

import { returnToSchema } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { codeChallengeOf, newSignInState, openSignInState, sealSignInState } from './sign-in-state';
import { TokenCipher } from './token-cipher';

const cipher = new TokenCipher(randomBytes(32));
const now = new Date('2026-09-27T12:00:00Z');

describe('the sign-in state cookie', () => {
  it('opens only with the state the identity provider returned', () => {
    const signIn = newSignInState('/rfqs', now);
    const sealed = sealSignInState(cipher, signIn);
    expect(openSignInState(cipher, sealed, signIn.state, now)).toEqual(signIn);
    expect(openSignInState(cipher, sealed, newSignInState('/rfqs', now).state, now)).toBeNull();
    expect(openSignInState(cipher, sealed, undefined, now)).toBeNull();
    expect(openSignInState(cipher, undefined, signIn.state, now)).toBeNull();
  });

  it('carries the session a step-up re-authenticates, sealed with the rest of the state', () => {
    const stepUpOf = { tenantId: '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01', credentialId: randomUUID() };
    const signIn = newSignInState('/rfqs', now, stepUpOf);
    const sealed = sealSignInState(cipher, signIn);
    expect(openSignInState(cipher, sealed, signIn.state, now)?.stepUpOf).toEqual(stepUpOf);
    expect(Buffer.from(sealed, 'base64url').toString('latin1')).not.toContain(stepUpOf.credentialId);
    expect(newSignInState('/rfqs', now).stepUpOf).toBeUndefined();
  });

  it('refuses a cookie that was tampered with, sealed by another key or kept past ten minutes', () => {
    const signIn = newSignInState('/rfqs', now);
    const sealed = sealSignInState(cipher, signIn);
    const tampered = Buffer.from(sealed, 'base64url');
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    expect(openSignInState(cipher, tampered.toString('base64url'), signIn.state, now)).toBeNull();
    expect(openSignInState(new TokenCipher(randomBytes(32)), sealed, signIn.state, now)).toBeNull();
    expect(openSignInState(cipher, sealed, signIn.state, new Date(now.getTime() + 601_000))).toBeNull();
    expect(openSignInState(cipher, 'not base64url!', signIn.state, now)).toBeNull();
  });

  it('never carries the verifier in the clear', () => {
    const signIn = newSignInState('/rfqs', now);
    const sealed = sealSignInState(cipher, signIn);
    expect(Buffer.from(sealed, 'base64url').toString('latin1')).not.toContain(signIn.codeVerifier);
  });

  it('derives the S256 code challenge of RFC 7636', () => {
    // The example of RFC 7636, appendix B.
    expect(codeChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('the return path after sign-in', () => {
  it('accepts paths on the staff app', () => {
    for (const path of ['/', '/rfqs', '/rfqs/42?tab=quotes#line-3']) {
      expect(returnToSchema.safeParse(path).success, path).toBe(true);
    }
  });

  it('refuses absolute, protocol-relative and backslash URLs', () => {
    for (const path of [
      'https://attacker.example/',
      '//attacker.example',
      '/\\attacker.example',
      'rfqs',
      '/ rfqs',
      '',
    ]) {
      expect(returnToSchema.safeParse(path).success, path).toBe(false);
    }
  });
});

describe('the token cipher', () => {
  it('decrypts only with the associated data it was sealed with', () => {
    const sealed = cipher.encrypt('synthetic-refresh-token', 'credential-a');
    expect(cipher.decrypt(sealed, 'credential-a')).toBe('synthetic-refresh-token');
    expect(cipher.decrypt(sealed, 'credential-b')).toBeNull();
    expect(sealed.toString('latin1')).not.toContain('synthetic-refresh-token');
    expect(cipher.decrypt(Buffer.alloc(10), 'credential-a')).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new TokenCipher(randomBytes(16))).toThrow();
  });
});
