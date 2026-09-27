import pg from 'pg';

/**
 * Whether a statement failed on one unique constraint. A check before the write cannot see a
 * concurrent transaction's row, so the constraint is the last word on a race. Drizzle wraps the
 * driver's error, with the original as its cause.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = error instanceof Error && error.cause instanceof pg.DatabaseError ? error.cause : error;
  return cause instanceof pg.DatabaseError && cause.code === '23505' && cause.constraint === constraint;
}

/** What a change at an expected version did: applied, found the row moved on, or hit a taken key. */
export type VersionedChange =
  { readonly kind: 'updated'; readonly version: number } | { readonly kind: 'stale' } | { readonly kind: 'duplicate' };
