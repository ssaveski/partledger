import {
  chainDomainTag,
  chainSchemaVersion,
  genesisPrevHash,
  jsonValueOf,
  sealRecord,
  type ChainActorType,
  type ChainHead,
  type JsonObject,
} from '@partledger/chain';
import type { EntryAdapter } from '@partledger/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { actorIdOf, type ActedUnder, type Principal } from '../principals/principal';
import type { Clock } from '../time/clock';
import { assertCommittedPayload, type CommittedPayload } from './audit-payload';

/**
 * The only way anything enters the audit chain (KTD17, R26). An append runs inside the
 * caller's tenant transaction: it takes the tenant's advisory lock, reads the head, and only
 * then takes the time and the next sequence number, so concurrent appends serialise, a
 * rolled-back append leaves no gap, and time never runs backwards along the chain. It reads
 * only the head columns, so `pl_portal` and `pl_ai_worker` can append as well.
 */

/** A Drizzle database or transaction; the audit functions need nothing more. */
export interface AuditDatabase {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/** Who acted, as every entry records it (R26). */
export interface AuditActor {
  readonly type: ChainActorType;
  readonly id: string | null;
  readonly actedUnder: ActedUnder;
  readonly adapter: EntryAdapter;
  readonly correlationId: string;
}

export function auditActorOf(principal: Principal): AuditActor {
  return {
    type: principal.type,
    id: actorIdOf(principal),
    actedUnder: principal.actedUnder,
    adapter: principal.adapter,
    correlationId: principal.correlationId,
  };
}

export interface AuditEvent<Data extends JsonObject> {
  readonly tenantId: string;
  readonly actor: AuditActor;
  /** What happened, such as the command's name `rfqs.publish`. */
  readonly event: string;
  /** Identifiers, versions, hashes and commitments; never a raw personal or free-text value. */
  readonly data: CommittedPayload<Data>;
}

export interface AppendedEntry extends ChainHead {
  readonly tenantId: string;
}

const headRows = z.array(
  z.object({ seq: z.coerce.number().int().min(1), entry_hash: z.instanceof(Buffer), time: z.iso.datetime() }),
);

/**
 * A stored time as the ISO text the chain hashes. Formatting in SQL keeps it independent of
 * how the driver parses `timestamptz`; appended times have millisecond precision.
 */
export const isoTimeColumn = sql`to_char(time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The lock key is derived from the tenant, so appends for different tenants never wait on each other. */
function lockKey(tenantId: string): SQL {
  return sql`pg_catalog.hashtextextended(${`${chainDomainTag}:${tenantId}`}, 0)`;
}

export async function readChainHead(database: AuditDatabase, tenantId: string): Promise<ChainHead | null> {
  const result = await database.execute(
    sql`select seq, entry_hash, ${isoTimeColumn} as time from audit_entries
        where tenant_id = ${tenantId} order by seq desc limit 1`,
  );
  const [head] = headRows.parse(result.rows);
  return head === undefined ? null : { seq: head.seq, entryHash: head.entry_hash.toString('hex'), time: head.time };
}

export async function appendAuditEntry<Data extends JsonObject>(
  database: AuditDatabase,
  event: AuditEvent<Data>,
  clock: Clock,
): Promise<AppendedEntry> {
  const data = jsonValueOf(event.data);
  assertCommittedPayload(data);
  const { actor, tenantId } = event;
  const payload: JsonObject = {
    event: event.event,
    adapter: actor.adapter,
    correlationId: actor.correlationId,
    data,
  };

  await database.execute(sql`select pg_catalog.pg_advisory_xact_lock(${lockKey(tenantId)})`);
  const head = await readChainHead(database, tenantId);
  const now = clock.now().toISOString();
  const time = head !== null && head.time > now ? head.time : now;
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.entryHash ?? genesisPrevHash;
  const sealed = sealRecord({
    tenant: tenantId,
    seq,
    prevHash,
    actorType: actor.type,
    actorId: actor.id,
    actedUnder: actor.actedUnder,
    time,
    schemaVersion: chainSchemaVersion,
    payload,
  });

  await database.execute(
    sql`insert into audit_entries
          (tenant_id, seq, prev_hash, entry_hash, canonical, actor_type, actor_id, acted_under, correlation_id,
           time, schema_version, payload)
        values (${tenantId}, ${seq}, ${Buffer.from(prevHash, 'hex')}, ${Buffer.from(sealed.entryHash, 'hex')},
                ${Buffer.from(sealed.canonical)}, ${actor.type}, ${actor.id}, ${JSON.stringify(actor.actedUnder)}::jsonb,
                ${actor.correlationId}, ${time}::timestamptz, ${chainSchemaVersion}, ${JSON.stringify(payload)}::jsonb)`,
  );
  return { tenantId, seq, entryHash: sealed.entryHash, time };
}
