import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import { failure, success, type Result } from '@partledger/domain';

import { generateDataKey, openWithKey, sealWithKey } from './envelope';
import {
  associatedDataOf,
  type EncryptionContext,
  type KeyService,
  type KeyServiceFailure,
  type KeySignature,
  type SealedEnvelope,
  type SigningPublicKey,
} from './key-service.port';

const wrappingLabel = Buffer.from('partledger/local-key-service/wrap/v1', 'utf8');

function fingerprintOf(material: Buffer): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * The key service's local adapter (KTD36), for development and tests only: production refuses
 * it. A key-encryption key held in memory wraps each data key; a P-256 key held in memory signs.
 * Without a configured key-encryption key, each process makes its own, so what one process
 * sealed does not open in the next.
 */
export class LocalKeyAdapter implements KeyService {
  private readonly wrappingKey: Buffer;
  private readonly wrappingKeyId: string;
  private readonly signingKey: KeyObject;
  private readonly publicKey: SigningPublicKey;

  constructor(wrappingKey: Buffer | undefined) {
    if (wrappingKey !== undefined && wrappingKey.length !== 32) {
      throw new Error('The local key service key must be 32 bytes');
    }
    this.wrappingKey = wrappingKey ?? randomBytes(32);
    this.wrappingKeyId = `local:${fingerprintOf(this.wrappingKey)}`;
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.signingKey = pair.privateKey;
    const spki = createPublicKey(pair.privateKey).export({ format: 'der', type: 'spki' });
    this.publicKey = { keyId: `local:${fingerprintOf(spki)}`, algorithm: 'ES256', spki };
  }

  encrypt(plaintext: Buffer, context: EncryptionContext): Promise<Result<SealedEnvelope, 'unavailable'>> {
    const dataKey = generateDataKey();
    const envelope: SealedEnvelope = {
      keyId: this.wrappingKeyId,
      wrappedDataKey: sealWithKey(this.wrappingKey, dataKey, wrappingLabel),
      ciphertext: sealWithKey(dataKey, plaintext, associatedDataOf(context)),
    };
    dataKey.fill(0);
    return Promise.resolve(success(envelope));
  }

  decrypt(envelope: SealedEnvelope, context: EncryptionContext): Promise<Result<Buffer, KeyServiceFailure>> {
    if (envelope.keyId !== this.wrappingKeyId) {
      return Promise.resolve(failure('undecryptable'));
    }
    const dataKey = openWithKey(this.wrappingKey, envelope.wrappedDataKey, wrappingLabel);
    const plaintext = dataKey === null ? null : openWithKey(dataKey, envelope.ciphertext, associatedDataOf(context));
    dataKey?.fill(0);
    return Promise.resolve(plaintext === null ? failure('undecryptable') : success(plaintext));
  }

  sign(message: Buffer): Promise<Result<KeySignature, 'unavailable'>> {
    const signature = sign('sha256', message, { key: this.signingKey, dsaEncoding: 'ieee-p1363' });
    return Promise.resolve(success({ keyId: this.publicKey.keyId, algorithm: 'ES256', signature }));
  }

  signingPublicKey(): Promise<Result<SigningPublicKey, 'unavailable'>> {
    return Promise.resolve(success(this.publicKey));
  }
}
