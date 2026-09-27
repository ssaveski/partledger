import { createHash } from 'node:crypto';

import {
  canonicalBytes,
  isCanonical,
  isJsonObject,
  parseJson,
  type JsonObject,
  type JsonValue,
} from './canonical-json.ts';

/**
 * The per-tenant hash chain (KTD17). Each entry's hash is SHA-256 over the domain tag, one
 * zero byte, and the RFC 8785 canonical bytes of its record. The API writes entries and the
 * standalone verifier checks them with this same code, so it depends only on the runtime.
 */

export const chainDomainTag = 'partledger/chain/v1';

export const chainSchemaVersion = 1;

/** The previous hash of every tenant's first entry, so `UNIQUE(tenant_id, prev_hash)` covers it too. */
export const genesisPrevHash = '0'.repeat(64);

export const chainActorTypes = ['person', 'ai_agent', 'supplier_token', 'system', 'platform_operator'] as const;

export type ChainActorType = (typeof chainActorTypes)[number];

export interface ChainRecord {
  readonly tenant: string;
  readonly seq: number;
  readonly prevHash: string;
  readonly actorType: ChainActorType;
  /** The person, agent, supplier or operator; `null` for a system principal. */
  readonly actorId: string | null;
  /** The grant the actor acted under, such as `{ grant: 'staff_session', credentialId }`. */
  readonly actedUnder: JsonObject;
  /** ISO 8601 UTC with milliseconds, supplied by the application after the append lock (KTD12). */
  readonly time: string;
  readonly schemaVersion: number;
  readonly payload: JsonObject;
}

export interface SealedRecord {
  /** The exact bytes that were hashed; they are stored and never recomputed from other columns. */
  readonly canonical: Uint8Array;
  readonly entryHash: string;
}

const hexHashPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const recordKeys = [
  'actedUnder',
  'actorId',
  'actorType',
  'payload',
  'prevHash',
  'schemaVersion',
  'seq',
  'tenant',
  'time',
].join(',');

function sha256Hex(parts: readonly Uint8Array[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest('hex');
}

const tagBytes = new TextEncoder().encode(chainDomainTag);
const separator = new Uint8Array([0]);

/** SHA-256(UTF-8(domain tag) || 0x00 || canonical bytes), as lowercase hex. */
export function entryHashOf(canonical: Uint8Array): string {
  return sha256Hex([tagBytes, separator, canonical]);
}

export function recordToJson(record: ChainRecord): JsonObject {
  return {
    tenant: record.tenant,
    seq: record.seq,
    prevHash: record.prevHash,
    actorType: record.actorType,
    actorId: record.actorId,
    actedUnder: record.actedUnder,
    time: record.time,
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  };
}

/** Canonicalises and hashes a record; refuses a record that could never verify. */
export function sealRecord(record: ChainRecord): SealedRecord {
  const problem = recordProblem(record);
  if (problem !== null) {
    throw new Error(`The chain record is invalid: ${problem}`);
  }
  const canonical = canonicalBytes(recordToJson(record));
  return { canonical, entryHash: entryHashOf(canonical) };
}

/** Why a record is malformed, or `null`. */
function recordProblem(record: ChainRecord): string | null {
  if (!uuidPattern.test(record.tenant)) {
    return 'tenant';
  }
  if (!Number.isSafeInteger(record.seq) || record.seq < 1) {
    return 'seq';
  }
  if (!hexHashPattern.test(record.prevHash)) {
    return 'prevHash';
  }
  if (record.actorId !== null && typeof record.actorId !== 'string') {
    return 'actorId';
  }
  if (!timePattern.test(record.time) || new Date(record.time).toISOString() !== record.time) {
    return 'time';
  }
  if (record.schemaVersion !== chainSchemaVersion) {
    return 'schemaVersion';
  }
  return null;
}

/** Decodes and checks stored canonical bytes: well-formed UTF-8, canonical, and a complete record. */
export function parseRecord(canonical: Uint8Array): ChainRecord | 'not_canonical' | 'record_invalid' {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(canonical);
  } catch {
    return 'not_canonical';
  }
  if (!isCanonical(text)) {
    return 'not_canonical';
  }
  const value = parseJson(text);
  if (!isJsonObject(value) || Object.keys(value).sort().join(',') !== recordKeys) {
    return 'record_invalid';
  }
  const { tenant, seq, prevHash, actorType, actorId, actedUnder, time, schemaVersion, payload } = value;
  if (
    typeof tenant !== 'string' ||
    typeof seq !== 'number' ||
    typeof prevHash !== 'string' ||
    !isActorType(actorType) ||
    (actorId !== null && typeof actorId !== 'string') ||
    !isJsonObject(actedUnder) ||
    typeof time !== 'string' ||
    typeof schemaVersion !== 'number' ||
    !isJsonObject(payload)
  ) {
    return 'record_invalid';
  }
  const record: ChainRecord = { tenant, seq, prevHash, actorType, actorId, actedUnder, time, schemaVersion, payload };
  return recordProblem(record) === null ? record : 'record_invalid';
}

function isActorType(value: JsonValue | undefined): value is ChainActorType {
  return chainActorTypes.some((actorType) => actorType === value);
}

/** One stored entry as the verifier reads it, ordered by `seq`. */
export interface StoredEntry {
  readonly seq: number;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly canonical: Uint8Array;
}

export const chainFailureReasons = [
  /** A sequence number is absent: an entry was deleted. */
  'missing_entry',
  /** The entry's position, its stored seq and its hashed seq disagree: entries were reordered or duplicated. */
  'sequence_mismatch',
  /** The stored bytes do not hash to the stored entry hash: the entry was modified. */
  'entry_hash_mismatch',
  /** The entry does not chain to the entry before it. */
  'prev_hash_mismatch',
  /** The stored bytes are not the canonical form of what they hold. */
  'not_canonical',
  /** The stored bytes are not a complete chain record. */
  'record_invalid',
  /** The hashed record names another tenant. */
  'tenant_mismatch',
  /** The hashed record disagrees with the entry's stored columns. */
  'record_mismatch',
  /** The entry's time is earlier than the entry before it. */
  'time_regressed',
] as const;

export type ChainFailureReason = (typeof chainFailureReasons)[number];

export interface ChainHead {
  readonly seq: number;
  readonly entryHash: string;
  readonly time: string;
}

export type ChainVerification =
  | { readonly ok: true; readonly length: number; readonly head: ChainHead | null }
  | { readonly ok: false; readonly seq: number; readonly reason: ChainFailureReason };

export type ChainFailure = Extract<ChainVerification, { readonly ok: false }>;

/** Checks an entry's parsed record against the entry's other stored columns, when the caller has them. */
export type EntryCheck<Entry extends StoredEntry> = (record: ChainRecord, entry: Entry) => boolean;

/** A verification that takes entries one at a time, in `seq` order, so a long chain is read in batches. */
export interface ChainWalk<Entry extends StoredEntry> {
  /** The failure at this entry or an earlier one, or `null` while the chain holds. */
  push(entry: Entry): ChainFailure | null;
  finish(): ChainVerification;
}

export function walkChain<Entry extends StoredEntry>(
  tenant: string,
  check: EntryCheck<Entry> = () => true,
): ChainWalk<Entry> {
  let expectedSeq = 1;
  let previous: ChainHead | null = null;
  let failed: ChainFailure | null = null;

  function inspect(entry: Entry): ChainFailureReason | ChainRecord {
    if (entry.seq > expectedSeq) {
      return 'missing_entry';
    }
    if (entry.seq !== expectedSeq) {
      return 'sequence_mismatch';
    }
    if (entryHashOf(entry.canonical) !== entry.entryHash) {
      return 'entry_hash_mismatch';
    }
    const record = parseRecord(entry.canonical);
    if (typeof record === 'string') {
      return record;
    }
    if (record.tenant !== tenant) {
      return 'tenant_mismatch';
    }
    if (record.seq !== entry.seq) {
      return 'sequence_mismatch';
    }
    if (record.prevHash !== entry.prevHash) {
      return 'record_mismatch';
    }
    if (entry.prevHash !== (previous?.entryHash ?? genesisPrevHash)) {
      return 'prev_hash_mismatch';
    }
    if (previous !== null && record.time < previous.time) {
      return 'time_regressed';
    }
    return check(record, entry) ? record : 'record_mismatch';
  }

  return {
    push(entry) {
      if (failed !== null) {
        return failed;
      }
      const outcome = inspect(entry);
      if (typeof outcome === 'string') {
        failed = { ok: false, seq: expectedSeq, reason: outcome };
        return failed;
      }
      previous = { seq: entry.seq, entryHash: entry.entryHash, time: outcome.time };
      expectedSeq += 1;
      return null;
    },
    finish() {
      return failed ?? { ok: true, length: expectedSeq - 1, head: previous };
    },
  };
}

/**
 * Verifies one tenant's entries, ordered by `seq`, from the genesis on, and names the first
 * sequence number at which the chain fails.
 */
export function verifyChain<Entry extends StoredEntry>(
  tenant: string,
  entries: Iterable<Entry>,
  check?: EntryCheck<Entry>,
): ChainVerification {
  const walk = walkChain(tenant, check);
  for (const entry of entries) {
    if (walk.push(entry) !== null) {
      break;
    }
  }
  return walk.finish();
}
