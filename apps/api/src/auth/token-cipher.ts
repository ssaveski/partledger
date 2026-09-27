import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const nonceBytes = 12;
const tagBytes = 16;

/**
 * AES-256-GCM for values the API keeps but must never expose: identity-provider refresh
 * tokens and the sign-in state cookie. The associated data binds a ciphertext to where it is
 * used (a session's credential id, or the sign-in cookie), so a value copied elsewhere does
 * not decrypt. Tenant keys move to `KeyService` envelope encryption with the regional KMS
 * (KTD36) when it exists.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error('The session token key must be 32 bytes');
    }
    this.key = key;
  }

  encrypt(plaintext: string, associatedData: string): Buffer {
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  /** `null` for anything that was not encrypted by this key with this associated data. */
  decrypt(sealed: Buffer, associatedData: string): string | null {
    if (sealed.length <= nonceBytes + tagBytes) {
      return null;
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, nonceBytes));
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(sealed.subarray(sealed.length - tagBytes));
      const body = sealed.subarray(nonceBytes, sealed.length - tagBytes);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
