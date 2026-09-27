import type { Result } from '@partledger/domain';

/**
 * The key service port (KTD36): envelope encryption and signing with the region's keys. Callers
 * never see a key-encryption key. The local adapter serves development and tests; the OVHcloud
 * KMS adapter serves the regions. U21 signs chain checkpoints through the same port (KTD18).
 */

/**
 * Where an encrypted value belongs. It is bound into the ciphertext as associated data, so a
 * value copied to another tenant or another reference does not decrypt.
 */
export interface EncryptionContext {
  readonly purpose: 'tenantAiKey';
  readonly tenantId: string;
  readonly reference: string;
}

/** A value sealed with a fresh data key, and that data key wrapped by the key service. */
export interface SealedEnvelope {
  /** The key service's key that wrapped the data key. */
  readonly keyId: string;
  readonly wrappedDataKey: Buffer;
  /** Nonce, AES-256-GCM ciphertext and tag. */
  readonly ciphertext: Buffer;
}

/** An ECDSA P-256 signature over SHA-256, as the fixed-length `r || s` (IEEE P1363). */
export interface KeySignature {
  readonly keyId: string;
  readonly algorithm: 'ES256';
  readonly signature: Buffer;
}

export interface SigningPublicKey {
  readonly keyId: string;
  readonly algorithm: 'ES256';
  /** The public key as DER-encoded SubjectPublicKeyInfo. */
  readonly spki: Buffer;
}

/**
 * `unavailable`: the key service could not be reached; try again later.
 * `undecryptable`: the envelope was not sealed by this service for this context.
 */
export type KeyServiceFailure = 'unavailable' | 'undecryptable';

export interface KeyService {
  encrypt(plaintext: Buffer, context: EncryptionContext): Promise<Result<SealedEnvelope, 'unavailable'>>;
  decrypt(envelope: SealedEnvelope, context: EncryptionContext): Promise<Result<Buffer, KeyServiceFailure>>;
  sign(message: Buffer): Promise<Result<KeySignature, 'unavailable'>>;
  signingPublicKey(): Promise<Result<SigningPublicKey, 'unavailable'>>;
}

export const keyService = Symbol('KeyService');

/** The associated data an envelope is bound to; the fields are identifiers, so the join is unambiguous. */
export function associatedDataOf(context: EncryptionContext): Buffer {
  return Buffer.from(`partledger/key-service/v1|${context.purpose}|${context.tenantId}|${context.reference}`, 'utf8');
}
