import { createHash } from 'node:crypto';

import { isJsonObject, type JsonValue } from './canonical-json.ts';

/**
 * Personal and free-text values enter the chain only as salted commitments (KTD17, R39). The
 * salt and value live in a commitment store outside the chain; erasing them leaves the
 * commitment, and so every entry hash, unchanged, while nothing left can reveal the value.
 */

export const commitmentDomainTag = 'partledger/commitment/v1';

export const commitmentSaltBytes = 32;

/** How a commitment appears in a chain payload: `{ "commitment": "<64 lowercase hex>" }`. */
export interface CommitmentReference {
  readonly commitment: string;
}

export const commitmentPattern = /^[0-9a-f]{64}$/;

const tagBytes = new TextEncoder().encode(commitmentDomainTag);

/** SHA-256(UTF-8(tag) || 0x00 || 32-byte salt || UTF-8(value)), as lowercase hex. */
export function computeCommitment(salt: Uint8Array, value: string): string {
  if (salt.length !== commitmentSaltBytes) {
    throw new Error(`A commitment salt is ${commitmentSaltBytes} bytes`);
  }
  return createHash('sha256')
    .update(tagBytes)
    .update(new Uint8Array([0]))
    .update(salt)
    .update(new TextEncoder().encode(value))
    .digest('hex');
}

/** Whether a payload value is a commitment reference and nothing else. */
export function isCommitmentReference(value: JsonValue | undefined): value is { readonly commitment: string } {
  if (!isJsonObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const commitment = keys.length === 1 ? value.commitment : undefined;
  return typeof commitment === 'string' && commitmentPattern.test(commitment);
}
