import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CanonicalJsonError,
  canonicalize,
  chainDomainTag,
  commitmentDomainTag,
  computeCommitment,
  genesisPrevHash,
  parseJson,
  verifyChain,
} from './index.ts';

/**
 * The published vectors (libs/chain/test-vectors/chain-v1.json). The standalone verifier
 * (U32) runs the same file, so both sides agree on canonical bytes, hashes and failures.
 */

const hexHash = z.string().regex(/^[0-9a-f]{64}$/);

const vectorsSchema = z
  .object({
    description: z.string(),
    chain: z.object({ domainTag: z.string(), entryHash: z.string(), record: z.string(), genesisPrevHash: hexHash }),
    commitment: z.object({
      domainTag: z.string(),
      commitment: z.string(),
      vectors: z.array(z.object({ salt: z.string().regex(/^[0-9a-f]{64}$/), value: z.string(), expected: hexHash })),
    }),
    canonicalization: z.array(z.object({ name: z.string(), input: z.string(), expected: z.string() })).min(1),
    numbers: z.array(z.object({ ieee754: z.string().regex(/^[0-9a-f]{16}$/), expected: z.string() })).min(1),
    invalid: z.array(z.object({ name: z.string(), input: z.string() })).min(1),
    invalidNumbers: z.array(z.object({ name: z.string(), ieee754: z.string().regex(/^[0-9a-f]{16}$/) })).min(1),
    chains: z
      .array(
        z.object({
          name: z.string(),
          tenant: z.uuid(),
          entries: z.array(
            z.object({ seq: z.number().int(), prevHash: z.string(), entryHash: z.string(), canonical: z.string() }),
          ),
          expected: z.discriminatedUnion('ok', [
            z.object({
              ok: z.literal(true),
              length: z.number().int(),
              headSeq: z.number().int().nullable(),
              headHash: hexHash.nullable(),
            }),
            z.object({ ok: z.literal(false), seq: z.number().int(), reason: z.string() }),
          ]),
        }),
      )
      .min(1),
  })
  .strict();

const vectors = vectorsSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'test-vectors', 'chain-v1.json'), 'utf8')),
);

function numberFromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe('the chain v1 test vectors', () => {
  it('name the domain tags and genesis hash the implementation uses', () => {
    expect(vectors.chain.domainTag).toBe(chainDomainTag);
    expect(vectors.chain.genesisPrevHash).toBe(genesisPrevHash);
    expect(vectors.commitment.domainTag).toBe(commitmentDomainTag);
  });

  it.each(vectors.canonicalization)('canonicalise $name', ({ input, expected }) => {
    expect(canonicalize(parseJson(input))).toBe(expected);
  });

  it.each(vectors.numbers)('serialise the IEEE 754 value $ieee754 as $expected', ({ ieee754, expected }) => {
    expect(canonicalize(numberFromBits(ieee754))).toBe(expected);
  });

  it.each(vectors.invalid)('refuse $name', ({ input }) => {
    expect(() => canonicalize(parseJson(input))).toThrow(CanonicalJsonError);
  });

  it.each(vectors.invalidNumbers)('refuse the number $name', ({ ieee754 }) => {
    expect(() => canonicalize(numberFromBits(ieee754))).toThrow(CanonicalJsonError);
  });

  it.each(vectors.commitment.vectors)('compute the commitment to $value', ({ salt, value, expected }) => {
    expect(computeCommitment(Buffer.from(salt, 'hex'), value)).toBe(expected);
  });

  it.each(vectors.chains)('verify $name', ({ tenant, entries, expected }) => {
    const result = verifyChain(
      tenant,
      entries.map((entry) => ({ ...entry, canonical: new TextEncoder().encode(entry.canonical) })),
    );
    const summary = result.ok
      ? {
          ok: true,
          length: result.length,
          headSeq: result.head?.seq ?? null,
          headHash: result.head?.entryHash ?? null,
        }
      : result;
    expect(summary).toEqual(expected);
  });
});
