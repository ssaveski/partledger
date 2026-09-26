import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { credentialKinds, type CredentialKind } from '../schema/credentials.ts';

/**
 * Every credential kind has one shape (KTD37): a public id, used for the lookup, and a
 * 256-bit secret of which only the SHA-256 is stored. The secret is compared in constant
 * time after the lookup, never used as a lookup key.
 */

const secretBytes = 32;

export const credentialIdSchema = z.uuid();
export const credentialSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const credentialKindSchema = z.enum(credentialKinds);

/** Anything that runs a parameterised query: a node-postgres client, pool client or pool. */
export interface ParameterisedQueryable {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

export function generateCredentialSecret(): string {
  return randomBytes(secretBytes).toString('base64url');
}

export function hashCredentialSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export interface IssueCredentialInput {
  readonly tenantId: string;
  readonly kind: CredentialKind;
  readonly subjectId: string | null;
  readonly expiresAt: Date;
}

export interface IssuedCredential {
  readonly id: string;
  /** Shown to its holder once; only its hash is stored. */
  readonly secret: string;
}

/**
 * Inserts a credential inside a tenant transaction. The app role holds INSERT only on the
 * credential table, so the id is generated here and nothing is read back.
 */
export async function issueCredential(
  client: ParameterisedQueryable,
  input: IssueCredentialInput,
): Promise<IssuedCredential> {
  const id = randomUUID();
  const secret = generateCredentialSecret();
  await client.query(
    `insert into credentials (id, tenant_id, kind, subject_id, secret_hash, expires_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [id, input.tenantId, input.kind, input.subjectId, hashCredentialSecret(secret), input.expiresAt.toISOString()],
  );
  return { id, secret };
}

const resolvedRowSchema = z.object({
  id: z.uuid(),
  tenant_id: z.uuid(),
  kind: credentialKindSchema,
  subject_id: z.uuid().nullable(),
  secret_hash: z.instanceof(Buffer).refine((hash) => hash.length === secretBytes),
  expires_at: z.date(),
  revoked_at: z.date().nullable(),
});

export interface ResolvedCredential {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: CredentialKind;
  readonly subjectId: string | null;
  readonly expiresAt: Date;
}

export type CredentialRefusal = 'unknown' | 'secret_mismatch' | 'expired' | 'revoked';

export type CredentialVerification =
  | { readonly ok: true; readonly credential: ResolvedCredential }
  | { readonly ok: false; readonly reason: CredentialRefusal };

export interface PresentedCredential {
  readonly kind: CredentialKind;
  readonly id: string;
  readonly secret: string;
}

// Compared against when the id is unknown or malformed, so every refusal costs one hash and one compare.
const placeholderHash = hashCredentialSecret(generateCredentialSecret());

/**
 * Resolves a presented credential through `resolve_credential`, outside any tenant context.
 * The reason is for audit and logs; callers answer every refusal the same way.
 */
export async function verifyCredential(
  client: ParameterisedQueryable,
  presented: PresentedCredential,
  now: Date,
): Promise<CredentialVerification> {
  const id = credentialIdSchema.safeParse(presented.id);
  const secret = credentialSecretSchema.safeParse(presented.secret);
  const presentedHash = hashCredentialSecret(secret.success ? secret.data : presented.secret);
  if (!id.success || !secret.success) {
    timingSafeEqual(presentedHash, placeholderHash);
    return { ok: false, reason: 'unknown' };
  }

  const result = await client.query('select * from resolve_credential($1, $2)', [presented.kind, id.data]);
  const rows = z.array(resolvedRowSchema).max(1).parse(result.rows);
  const row = rows[0];
  if (row === undefined) {
    timingSafeEqual(presentedHash, placeholderHash);
    return { ok: false, reason: 'unknown' };
  }
  if (!timingSafeEqual(presentedHash, row.secret_hash)) {
    return { ok: false, reason: 'secret_mismatch' };
  }
  if (row.revoked_at !== null) {
    return { ok: false, reason: 'revoked' };
  }
  if (row.expires_at.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return {
    ok: true,
    credential: {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      subjectId: row.subject_id,
      expiresAt: row.expires_at,
    },
  };
}
