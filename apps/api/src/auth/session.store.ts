import { schema, type StaffSessionEndReason } from '@partledger/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AppDatabase } from '../db/tenant-transaction';

const { staffSessions, tenants } = schema;

export interface StoredSession {
  readonly tenantId: string;
  readonly credentialId: string;
  readonly subjectId: string;
  readonly refreshTokenCiphertext: Buffer;
  readonly lastSeenAt: Date;
  readonly refreshedAt: Date;
  readonly authenticationLevel: string | null;
  readonly authenticatedAt: Date | null;
  readonly endedAt: Date | null;
}

/** The identity provider's `acr` and `auth_time` as the session last received them (KTD20). */
export interface SessionAuthentication {
  readonly authenticationLevel: string | null;
  readonly authenticatedAt: Date | null;
}

interface SessionKey {
  readonly tenantId: string;
  readonly credentialId: string;
}

function matching(key: SessionKey) {
  return and(eq(staffSessions.tenantId, key.tenantId), eq(staffSessions.credentialId, key.credentialId));
}

/**
 * The staff session rows (KTD20). Every call runs inside the caller's tenant transaction, so
 * row-level security confines it to the session's own tenant.
 */
export const sessionStore = {
  async tenantExists(database: AppDatabase, tenantId: string): Promise<boolean> {
    const rows = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    return rows.length === 1;
  },

  async insert(
    database: AppDatabase,
    session: SessionKey &
      SessionAuthentication & {
        readonly subjectId: string;
        readonly refreshTokenCiphertext: Buffer;
        readonly now: Date;
      },
  ): Promise<void> {
    await database.insert(staffSessions).values({
      tenantId: session.tenantId,
      credentialId: session.credentialId,
      subjectId: session.subjectId,
      refreshTokenCiphertext: session.refreshTokenCiphertext,
      startedAt: session.now,
      lastSeenAt: session.now,
      refreshedAt: session.now,
      authenticationLevel: session.authenticationLevel,
      authenticatedAt: session.authenticatedAt,
    });
  },

  async find(database: AppDatabase, key: SessionKey): Promise<StoredSession | undefined> {
    const [row] = await database
      .select({
        tenantId: staffSessions.tenantId,
        credentialId: staffSessions.credentialId,
        subjectId: staffSessions.subjectId,
        refreshTokenCiphertext: staffSessions.refreshTokenCiphertext,
        lastSeenAt: staffSessions.lastSeenAt,
        refreshedAt: staffSessions.refreshedAt,
        authenticationLevel: staffSessions.authenticationLevel,
        authenticatedAt: staffSessions.authenticatedAt,
        endedAt: staffSessions.endedAt,
      })
      .from(staffSessions)
      .where(matching(key));
    return row;
  },

  /** Records activity; `false` when the session has ended meanwhile. */
  async touch(database: AppDatabase, key: SessionKey, now: Date): Promise<boolean> {
    const updated = await database
      .update(staffSessions)
      .set({ lastSeenAt: now })
      .where(and(matching(key), isNull(staffSessions.endedAt)))
      .returning({ credentialId: staffSessions.credentialId });
    return updated.length === 1;
  },

  /** Stores a refreshed token, from a refresh or a step-up; `false` when the session has ended meanwhile. */
  async recordRefresh(
    database: AppDatabase,
    key: SessionKey,
    refreshTokenCiphertext: Buffer,
    authentication: SessionAuthentication,
    now: Date,
  ): Promise<boolean> {
    const updated = await database
      .update(staffSessions)
      .set({
        refreshTokenCiphertext,
        refreshedAt: now,
        lastSeenAt: now,
        authenticationLevel: authentication.authenticationLevel,
        authenticatedAt: authentication.authenticatedAt,
      })
      .where(and(matching(key), isNull(staffSessions.endedAt)))
      .returning({ credentialId: staffSessions.credentialId });
    return updated.length === 1;
  },

  /** Ends every open session of one person in the tenant; returns how many it ended. */
  async endAllOf(
    database: AppDatabase,
    person: { readonly tenantId: string; readonly subjectId: string },
    reason: StaffSessionEndReason,
    now: Date,
  ): Promise<number> {
    const updated = await database
      .update(staffSessions)
      .set({ endedAt: now, endReason: reason })
      .where(
        and(
          eq(staffSessions.tenantId, person.tenantId),
          eq(staffSessions.subjectId, person.subjectId),
          isNull(staffSessions.endedAt),
        ),
      )
      .returning({ credentialId: staffSessions.credentialId });
    return updated.length;
  },

  /** Ends the session once; `false` when it had already ended. */
  async end(database: AppDatabase, key: SessionKey, reason: StaffSessionEndReason, now: Date): Promise<boolean> {
    const updated = await database
      .update(staffSessions)
      .set({ endedAt: now, endReason: reason })
      .where(and(matching(key), isNull(staffSessions.endedAt)))
      .returning({ credentialId: staffSessions.credentialId });
    return updated.length === 1;
  },
};
