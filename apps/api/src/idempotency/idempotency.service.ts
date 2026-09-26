import { Injectable } from '@nestjs/common';
import { schema } from '@partledger/db';
import { and, eq, sql } from 'drizzle-orm';

import type { AppDatabase } from '../db/tenant-transaction';

const { idempotencyKeys } = schema;

/** How long a key replays its first result; after that the key may be used afresh. */
export const idempotencyKeyLifetimeMilliseconds = 24 * 60 * 60 * 1000;

export interface IdempotencyClaimRequest {
  readonly tenantId: string;
  readonly credentialId: string;
  readonly command: string;
  readonly key: string;
  readonly fingerprint: Buffer;
  readonly now: Date;
}

export type IdempotencyClaim =
  | { readonly kind: 'claimed'; readonly id: string }
  | { readonly kind: 'replay'; readonly result: unknown }
  | { readonly kind: 'reused_with_other_input' };

/**
 * KTD14: the key is claimed by the command's first statement after the tenant context, inside
 * its transaction. A concurrent request with the same key blocks on the unique key until the
 * first commits (and then replays it) or rolls back (and then runs itself). An expired key is
 * taken over as if it were new.
 */
@Injectable()
export class IdempotencyService {
  async claim(database: AppDatabase, request: IdempotencyClaimRequest): Promise<IdempotencyClaim> {
    const expiresAt = new Date(request.now.getTime() + idempotencyKeyLifetimeMilliseconds);
    const claimed = await database
      .insert(idempotencyKeys)
      .values({
        tenantId: request.tenantId,
        credentialId: request.credentialId,
        command: request.command,
        key: request.key,
        fingerprint: request.fingerprint,
        createdAt: request.now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [idempotencyKeys.tenantId, idempotencyKeys.credentialId, idempotencyKeys.command, idempotencyKeys.key],
        set: {
          fingerprint: sql`excluded.fingerprint`,
          result: null,
          createdAt: sql`excluded.created_at`,
          expiresAt: sql`excluded.expires_at`,
        },
        setWhere: sql`${idempotencyKeys.expiresAt} <= excluded.created_at`,
      })
      .returning({ id: idempotencyKeys.id });
    const [row] = claimed;
    if (row !== undefined) {
      return { kind: 'claimed', id: row.id };
    }

    const [existing] = await database
      .select({ fingerprint: idempotencyKeys.fingerprint, result: idempotencyKeys.result })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, request.tenantId),
          eq(idempotencyKeys.credentialId, request.credentialId),
          eq(idempotencyKeys.command, request.command),
          eq(idempotencyKeys.key, request.key),
        ),
      );
    // A committed key always carries its result: it is recorded in the transaction that claimed it.
    if (existing === undefined || existing.result === null) {
      throw new Error('An idempotency key conflicted but no committed result was found');
    }
    if (!existing.fingerprint.equals(request.fingerprint)) {
      return { kind: 'reused_with_other_input' };
    }
    return { kind: 'replay', result: existing.result };
  }

  async complete(database: AppDatabase, claimId: string, result: unknown): Promise<void> {
    await database.update(idempotencyKeys).set({ result }).where(eq(idempotencyKeys.id, claimId));
  }
}
