import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const nonceBytes = 12;
const tagBytes = 16;

/** A fresh 256-bit data key; each sealed value gets its own. */
export function generateDataKey(): Buffer {
  return randomBytes(32);
}

/** AES-256-GCM with the associated data bound in: nonce, ciphertext, then tag. */
export function sealWithKey(key: Buffer, plaintext: Buffer, associatedData: Buffer): Buffer {
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** `null` for anything not sealed by this key with this associated data. */
export function openWithKey(key: Buffer, sealed: Buffer, associatedData: Buffer): Buffer | null {
  if (key.length !== 32 || sealed.length < nonceBytes + tagBytes) {
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, nonceBytes));
    decipher.setAAD(associatedData);
    decipher.setAuthTag(sealed.subarray(sealed.length - tagBytes));
    return Buffer.concat([decipher.update(sealed.subarray(nonceBytes, sealed.length - tagBytes)), decipher.final()]);
  } catch {
    return null;
  }
}
