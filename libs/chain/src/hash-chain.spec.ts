import { describe, expect, it } from 'vitest';

import { computeCommitment, isCommitmentReference } from './commitment.ts';
import {
  chainSchemaVersion,
  entryHashOf,
  genesisPrevHash,
  parseRecord,
  sealRecord,
  verifyChain,
  type ChainRecord,
  type StoredEntry,
} from './hash-chain.ts';

const tenant = '3c1e5a7b-9d2f-4b6c-8e0a-1f2d3c4b5a69';

function recordAt(seq: number, prevHash: string, time: string, payload: ChainRecord['payload'] = {}): ChainRecord {
  return {
    tenant,
    seq,
    prevHash,
    actorType: 'person',
    actorId: '5d7f9b1c-3e4a-4c6e-8f0b-2a3c4d5e6f70',
    actedUnder: { grant: 'staff_session', credentialId: '6e8a0c2d-4f5b-4d7f-9a1c-3b4d5e6f7a81' },
    time,
    schemaVersion: chainSchemaVersion,
    payload,
  };
}

function buildChain(times: readonly string[]): StoredEntry[] {
  const entries: StoredEntry[] = [];
  let prevHash = genesisPrevHash;
  for (const [position, time] of times.entries()) {
    const sealed = sealRecord(recordAt(position + 1, prevHash, time, { step: position + 1 }));
    entries.push({ seq: position + 1, prevHash, entryHash: sealed.entryHash, canonical: sealed.canonical });
    prevHash = sealed.entryHash;
  }
  return entries;
}

describe('the hash chain', () => {
  it('hashes the domain tag, a zero byte and the canonical bytes', () => {
    const sealed = sealRecord(recordAt(1, genesisPrevHash, '2026-09-27T08:00:00.000Z'));
    expect(sealed.entryHash).toBe(entryHashOf(sealed.canonical));
    expect(new TextDecoder().decode(sealed.canonical)).toMatch(/^\{"actedUnder":\{"credentialId":/);
    expect(parseRecord(sealed.canonical)).toEqual(recordAt(1, genesisPrevHash, '2026-09-27T08:00:00.000Z'));
  });

  it('refuses to seal a record with a malformed time, sequence number or previous hash', () => {
    expect(() => sealRecord(recordAt(1, genesisPrevHash, '2026-09-27T08:00:00Z'))).toThrow(/time/);
    expect(() => sealRecord(recordAt(0, genesisPrevHash, '2026-09-27T08:00:00.000Z'))).toThrow(/seq/);
    expect(() => sealRecord(recordAt(1, 'ABC', '2026-09-27T08:00:00.000Z'))).toThrow(/prevHash/);
  });

  it('verifies an intact chain and reports its head', () => {
    const entries = buildChain(['2026-09-27T08:00:00.000Z', '2026-09-27T08:00:00.000Z', '2026-09-27T08:00:01.000Z']);
    expect(verifyChain(tenant, entries)).toEqual({
      ok: true,
      length: 3,
      head: { seq: 3, entryHash: entries[2]?.entryHash, time: '2026-09-27T08:00:01.000Z' },
    });
  });

  it('fails at an entry whose time is earlier than the entry before it', () => {
    const entries = buildChain(['2026-09-27T08:00:01.000Z', '2026-09-27T08:00:00.999Z']);
    expect(verifyChain(tenant, entries)).toEqual({ ok: false, seq: 2, reason: 'time_regressed' });
  });

  it('fails at an entry whose first entry does not chain to the genesis constant', () => {
    const sealed = sealRecord(recordAt(1, 'f'.repeat(64), '2026-09-27T08:00:00.000Z'));
    expect(
      verifyChain(tenant, [
        { seq: 1, prevHash: 'f'.repeat(64), entryHash: sealed.entryHash, canonical: sealed.canonical },
      ]),
    ).toEqual({ ok: false, seq: 1, reason: 'prev_hash_mismatch' });
  });

  it('fails at an entry whose stored previous hash disagrees with its hashed record', () => {
    const [first] = buildChain(['2026-09-27T08:00:00.000Z']);
    if (first === undefined) {
      throw new Error('The chain has one entry');
    }
    expect(verifyChain(tenant, [{ ...first, prevHash: 'e'.repeat(64) }])).toEqual({
      ok: false,
      seq: 1,
      reason: 'record_mismatch',
    });
  });

  it('fails at an entry that the caller finds inconsistent with its other stored columns', () => {
    const entries = buildChain(['2026-09-27T08:00:00.000Z', '2026-09-27T08:00:01.000Z']);
    expect(verifyChain(tenant, entries, (_record, entry) => entry.seq === 1)).toEqual({
      ok: false,
      seq: 2,
      reason: 'record_mismatch',
    });
  });

  it('fails at bytes that are canonical JSON but not a complete record', () => {
    const canonical = new TextEncoder().encode('{"seq":1}');
    expect(
      verifyChain(tenant, [{ seq: 1, prevHash: genesisPrevHash, entryHash: entryHashOf(canonical), canonical }]),
    ).toEqual({ ok: false, seq: 1, reason: 'record_invalid' });
  });

  it('fails at bytes that are not valid UTF-8', () => {
    const canonical = new Uint8Array([0x7b, 0xff, 0x7d]);
    expect(
      verifyChain(tenant, [{ seq: 1, prevHash: genesisPrevHash, entryHash: entryHashOf(canonical), canonical }]),
    ).toEqual({ ok: false, seq: 1, reason: 'not_canonical' });
  });
});

describe('salted commitments', () => {
  const salt = new Uint8Array(32).fill(7);

  it('differ for different salts and values and need a 32-byte salt', () => {
    const commitment = computeCommitment(salt, 'Synthetic Person');
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCommitment(new Uint8Array(32).fill(8), 'Synthetic Person')).not.toBe(commitment);
    expect(computeCommitment(salt, 'Synthetic Persons')).not.toBe(commitment);
    expect(() => computeCommitment(new Uint8Array(16), 'Synthetic Person')).toThrow();
  });

  it('appear in payloads as an object holding the commitment only', () => {
    const commitment = computeCommitment(salt, 'Synthetic Person');
    expect(isCommitmentReference({ commitment })).toBe(true);
    expect(isCommitmentReference({ commitment, value: 'Synthetic Person' })).toBe(false);
    expect(isCommitmentReference({ commitment: 'Synthetic Person' })).toBe(false);
    expect(isCommitmentReference('Synthetic Person')).toBe(false);
  });
});
