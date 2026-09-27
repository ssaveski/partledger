import { createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { EncryptionContext } from './key-service.port';
import { LocalKeyAdapter } from './local-key.adapter';
import { OvhKmsAdapter, mutualTlsTransport, type KmsTransport } from './ovh-kms.adapter';

const tenantId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const context: EncryptionContext = { purpose: 'tenantAiKey', tenantId, reference: 'ai-key/one' };
const secret = Buffer.from('sk-synthetic-tenant-key-0001', 'utf8');

describe('the local key service adapter', () => {
  it('seals a value that opens only with the same context', async () => {
    const keys = new LocalKeyAdapter(randomBytes(32));
    const sealed = await keys.encrypt(secret, context);
    if (!sealed.ok) {
      throw new Error('sealing failed');
    }
    expect(sealed.value.ciphertext.includes(secret)).toBe(false);
    expect(await keys.decrypt(sealed.value, context)).toEqual({ ok: true, value: secret });
    expect(await keys.decrypt(sealed.value, { ...context, reference: 'ai-key/two' })).toEqual({
      ok: false,
      error: 'undecryptable',
    });
    expect(await keys.decrypt(sealed.value, { ...context, tenantId: '1b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' })).toEqual({
      ok: false,
      error: 'undecryptable',
    });
  });

  it('refuses an envelope sealed by another key', async () => {
    const sealed = await new LocalKeyAdapter(randomBytes(32)).encrypt(secret, context);
    if (!sealed.ok) {
      throw new Error('sealing failed');
    }
    expect(await new LocalKeyAdapter(randomBytes(32)).decrypt(sealed.value, context)).toEqual({
      ok: false,
      error: 'undecryptable',
    });
  });

  it('signs with ES256, verifiable with its public key', async () => {
    const keys = new LocalKeyAdapter(undefined);
    const message = Buffer.from('partledger/checkpoint/synthetic', 'utf8');
    const signed = await keys.sign(message);
    const publicKey = await keys.signingPublicKey();
    if (!signed.ok || !publicKey.ok) {
      throw new Error('signing failed');
    }
    expect(signed.value.keyId).toBe(publicKey.value.keyId);
    const key = createPublicKey({ key: publicKey.value.spki, format: 'der', type: 'spki' });
    expect(verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, signed.value.signature)).toBe(true);
  });
});

/** Stands in for the KMS: wraps data keys under its own key and signs with its own P-256 key. */
function fakeKms(): KmsTransport & { readonly paths: string[]; down: boolean } {
  const wrapped = new Map<string, Buffer>();
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = createPublicKey(pair.privateKey).export({ format: 'jwk' });
  const kms = {
    paths: new Array<string>(),
    down: false,
    send(_method: 'GET' | 'POST', path: string, body: unknown) {
      kms.paths.push(path);
      if (kms.down) {
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      const request =
        typeof body === 'object' && body !== null ? new Map(Object.entries(body)) : new Map<string, unknown>();
      if (path.endsWith('/datakey')) {
        const dataKey = randomBytes(32);
        const handle = `jwe.${randomBytes(8).toString('hex')}`;
        wrapped.set(handle, dataKey);
        return Promise.resolve({ status: 200, body: { key: handle, plaintext: dataKey.toString('base64') } });
      }
      if (path.endsWith('/datakey/decrypt')) {
        const dataKey = wrapped.get(String(request.get('key')));
        return Promise.resolve(
          dataKey === undefined
            ? { status: 400, body: { error: 'invalid key' } }
            : { status: 200, body: { plaintext: dataKey.toString('base64') } },
        );
      }
      if (path.endsWith('/sign')) {
        const message = Buffer.from(String(request.get('message')), 'base64');
        const signature = sign('sha256', message, { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
        return Promise.resolve({ status: 200, body: { signature: signature.toString('base64') } });
      }
      return Promise.resolve({ status: 200, body: { keys: [jwk] } });
    },
  };
  return kms;
}

const kmsOptions = {
  kmsId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  encryptionKeyId: '4a2b3c5d-6e7f-4b8c-9d0e-1f2a3b4c5d6e',
  signingKeyId: '5b3c4d6e-7f80-4c9d-8e1f-2a3b4c5d6e7f',
};

describe('the OVHcloud KMS key service adapter', () => {
  it('wraps each data key in the KMS and seals the value locally, bound to its context', async () => {
    const transport = fakeKms();
    const keys = new OvhKmsAdapter({ ...kmsOptions, transport });
    const sealed = await keys.encrypt(secret, context);
    if (!sealed.ok) {
      throw new Error('sealing failed');
    }
    expect(sealed.value.keyId).toBe(kmsOptions.encryptionKeyId);
    expect(transport.paths).toEqual([`/api/${kmsOptions.kmsId}/v1/servicekey/${kmsOptions.encryptionKeyId}/datakey`]);
    expect(await keys.decrypt(sealed.value, context)).toEqual({ ok: true, value: secret });
    expect(await keys.decrypt(sealed.value, { ...context, reference: 'ai-key/two' })).toEqual({
      ok: false,
      error: 'undecryptable',
    });
  });

  it('reports an unreachable KMS as unavailable, and a wrapped key it refuses as undecryptable', async () => {
    const transport = fakeKms();
    const keys = new OvhKmsAdapter({ ...kmsOptions, transport });
    const sealed = await keys.encrypt(secret, context);
    if (!sealed.ok) {
      throw new Error('sealing failed');
    }
    expect(
      await keys.decrypt({ ...sealed.value, wrappedDataKey: Buffer.from('jwe.unknown', 'utf8') }, context),
    ).toEqual({ ok: false, error: 'undecryptable' });
    transport.down = true;
    expect(await keys.decrypt(sealed.value, context)).toEqual({ ok: false, error: 'unavailable' });
    expect(await keys.encrypt(secret, context)).toEqual({ ok: false, error: 'unavailable' });
    expect(await keys.sign(secret)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('reports a KMS that refuses the client (401, 403) or throttles it (429) as unavailable', async () => {
    const sealed = await new OvhKmsAdapter({ ...kmsOptions, transport: fakeKms() }).encrypt(secret, context);
    if (!sealed.ok) {
      throw new Error('sealing failed');
    }
    for (const status of [401, 403, 408, 429, 500, 503]) {
      const answering: KmsTransport = { send: () => Promise.resolve({ status, body: { error: 'synthetic' } }) };
      const keys = new OvhKmsAdapter({ ...kmsOptions, transport: answering });
      expect(await keys.decrypt(sealed.value, context)).toEqual({ ok: false, error: 'unavailable' });
      expect(await keys.encrypt(secret, context)).toEqual({ ok: false, error: 'unavailable' });
    }
    for (const status of [400, 404, 422]) {
      const refusing: KmsTransport = { send: () => Promise.resolve({ status, body: { error: 'synthetic' } }) };
      expect(await new OvhKmsAdapter({ ...kmsOptions, transport: refusing }).decrypt(sealed.value, context)).toEqual({
        ok: false,
        error: 'undecryptable',
      });
    }
  });

  it('signs through the KMS, verifiable with the key the KMS publishes', async () => {
    const keys = new OvhKmsAdapter({ ...kmsOptions, transport: fakeKms() });
    const message = Buffer.from('partledger/checkpoint/synthetic', 'utf8');
    const signed = await keys.sign(message);
    const publicKey = await keys.signingPublicKey();
    if (!signed.ok || !publicKey.ok) {
      throw new Error('signing failed');
    }
    const key = createPublicKey({ key: publicKey.value.spki, format: 'der', type: 'spki' });
    expect(verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, signed.value.signature)).toBe(true);
  });

  it('refuses a KMS endpoint that is not an OVHcloud KMS origin', () => {
    for (const endpoint of [
      'http://ca-east-bhs.okms.ovh.net',
      'https://169.254.169.254',
      'https://kms.attacker.example',
    ]) {
      expect(() =>
        mutualTlsTransport({ endpoint, certificate: '', privateKey: '', timeoutMilliseconds: 1_000 }),
      ).toThrow(/okms\.ovh\.net/);
    }
  });
});
