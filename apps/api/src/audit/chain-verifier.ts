import {
  canonicalize,
  jsonValueOf,
  walkChain,
  type ChainRecord,
  type ChainVerification,
  type StoredEntry,
} from '@partledger/chain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { isoTimeColumn, type AuditDatabase } from './audit-writer';

/**
 * Verifies one tenant's chain as stored (R27): every entry's bytes hash to its entry hash,
 * chain to the entry before it, and agree with the entry's other columns, which are copies
 * for querying. The nightly job (U9) runs it for every tenant, inside that tenant's context,
 * and alerts with the first failing sequence number. Entries are read in batches, so a long
 * chain never sits in memory at once.
 */

const batchSize = 500;

const entryRows = z.array(
  z.object({
    seq: z.coerce.number().int(),
    prev_hash: z.instanceof(Buffer),
    entry_hash: z.instanceof(Buffer),
    canonical: z.instanceof(Buffer),
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    acted_under: z.unknown(),
    correlation_id: z.string(),
    time: z.string(),
    schema_version: z.number().int(),
    payload: z.unknown(),
  }),
);

type EntryRow = z.infer<typeof entryRows>[number];

interface ColumnEntry extends StoredEntry {
  readonly row: EntryRow;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(jsonValueOf(left)) === canonicalize(jsonValueOf(right));
  } catch {
    return false;
  }
}

function columnsMatch(record: ChainRecord, { row }: ColumnEntry): boolean {
  return (
    record.actorType === row.actor_type &&
    record.actorId === row.actor_id &&
    record.time === row.time &&
    record.schemaVersion === row.schema_version &&
    record.payload.correlationId === row.correlation_id &&
    sameJson(record.actedUnder, row.acted_under) &&
    sameJson(record.payload, row.payload)
  );
}

export async function verifyTenantChain(database: AuditDatabase, tenantId: string): Promise<ChainVerification> {
  const walk = walkChain<ColumnEntry>(tenantId, columnsMatch);
  let after = 0;
  for (;;) {
    const result = await database.execute(
      sql`select seq, prev_hash, entry_hash, canonical, actor_type, actor_id, acted_under, correlation_id,
                 ${isoTimeColumn} as time, schema_version, payload
            from audit_entries
           where tenant_id = ${tenantId} and seq > ${after}
           order by seq
           limit ${batchSize}`,
    );
    const rows = entryRows.parse(result.rows);
    for (const row of rows) {
      const failure = walk.push({
        seq: row.seq,
        prevHash: row.prev_hash.toString('hex'),
        entryHash: row.entry_hash.toString('hex'),
        canonical: row.canonical,
        row,
      });
      if (failure !== null) {
        return failure;
      }
      after = row.seq;
    }
    if (rows.length < batchSize) {
      return walk.finish();
    }
  }
}
