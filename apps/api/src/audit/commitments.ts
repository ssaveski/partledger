import { randomBytes } from 'node:crypto';

import { commitmentSaltBytes, computeCommitment } from '@partledger/chain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { commitmentSchema, type Commitment } from './audit-payload';
import type { AuditDatabase } from './audit-writer';

/**
 * The commitment store (KTD17, R39). A personal or free-text value is stored here with a
 * fresh 256-bit salt, and the chain carries only the salted hash. Erasing the salt and value
 * leaves the hash, so every entry still verifies and nothing left can confirm a guess.
 */

export interface CommitInput {
  readonly tenantId: string;
  readonly value: string;
  readonly now: Date;
}

/** Stores a value and returns the commitment an audit payload may carry. */
export async function commitValue(database: AuditDatabase, input: CommitInput): Promise<Commitment> {
  const salt = randomBytes(commitmentSaltBytes);
  const commitment = computeCommitment(salt, input.value);
  // No RETURNING: pl_portal and pl_ai_worker may insert commitments but never read them.
  await database.execute(
    sql`insert into commitments (tenant_id, commitment, salt, value, created_at)
        values (${input.tenantId}, ${Buffer.from(commitment, 'hex')}, ${salt}, ${input.value},
                ${input.now.toISOString()}::timestamptz)`,
  );
  return commitmentSchema.parse({ commitment });
}

export type Revealed =
  { readonly state: 'present'; readonly value: string } | { readonly state: 'erased' } | { readonly state: 'unknown' };

const storedRows = z.array(
  z.object({
    commitment: z.instanceof(Buffer),
    salt: z.instanceof(Buffer).nullable(),
    value: z.string().nullable(),
  }),
);

export class CommitmentMismatchError extends Error {
  constructor() {
    super('A stored value does not match its commitment');
    this.name = 'CommitmentMismatchError';
  }
}

/** The value behind a commitment, checked against it, unless it has been erased. */
export async function revealCommitment(
  database: AuditDatabase,
  tenantId: string,
  commitment: Commitment,
): Promise<Revealed> {
  const result = await database.execute(
    sql`select commitment, salt, value from commitments
        where tenant_id = ${tenantId} and commitment = ${Buffer.from(commitment.commitment, 'hex')}`,
  );
  const [row] = storedRows.parse(result.rows);
  if (row === undefined) {
    return { state: 'unknown' };
  }
  if (row.salt === null || row.value === null) {
    return { state: 'erased' };
  }
  if (computeCommitment(row.salt, row.value) !== commitment.commitment) {
    throw new CommitmentMismatchError();
  }
  return { state: 'present', value: row.value };
}

/**
 * Erases the salt and value behind a commitment (R39); the database refuses every other
 * change. Returns `false` when there was nothing left to erase.
 */
export async function eraseCommitment(
  database: AuditDatabase,
  tenantId: string,
  commitment: Commitment,
  now: Date,
): Promise<boolean> {
  const result = await database.execute(
    sql`update commitments set salt = null, value = null, erased_at = ${now.toISOString()}::timestamptz
        where tenant_id = ${tenantId} and commitment = ${Buffer.from(commitment.commitment, 'hex')}
          and erased_at is null
        returning commitment`,
  );
  return result.rows.length === 1;
}
