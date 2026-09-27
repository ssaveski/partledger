import { Inject, Injectable, Logger } from '@nestjs/common';
import type { StaffSession } from '@partledger/contracts';
import { issueCredential, type ResolvedCredential, type StaffSessionEndReason } from '@partledger/db';

import { TenantTransactions } from '../db/tenant-transaction';
import { identityProvider, type IdentityProvider, type SignedInIdentity } from './identity-provider';
import { sessionStore } from './session.store';
import { TokenCipher } from './token-cipher';

export interface SessionSettings {
  readonly idleTimeoutMilliseconds: number;
  readonly absoluteTimeoutMilliseconds: number;
  readonly refreshIntervalMilliseconds: number;
}

export const sessionSettings = Symbol('SessionSettings');

export interface StartedSession {
  readonly credentialId: string;
  /** Goes into the session cookie once; only its hash is stored. */
  readonly secret: string;
  readonly expiresAt: Date;
}

export interface ActiveSession {
  readonly credentialId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

/**
 * Staff sessions (KTD20): started after a validated sign-in, resumed on every request. A
 * session ends when it is signed out, when no request arrives within the idle timeout, when
 * its credential reaches the absolute timeout, or when a refresh against the identity
 * provider fails, which is how a user disabled in Keycloak loses access within one refresh
 * interval.
 */
@Injectable()
export class StaffSessions {
  private readonly logger = new Logger('StaffSessions');

  constructor(
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(identityProvider) private readonly provider: IdentityProvider,
    @Inject(TokenCipher) private readonly cipher: TokenCipher,
    @Inject(sessionSettings) private readonly settings: SessionSettings,
  ) {}

  /** `null` when the identity's tenant does not exist in this region. */
  async start(signedIn: SignedInIdentity, now: Date, expiresAt?: Date): Promise<StartedSession | null> {
    const { identity } = signedIn;
    const sessionExpiresAt = expiresAt ?? new Date(now.getTime() + this.settings.absoluteTimeoutMilliseconds);
    return this.transactions.run(identity.tenantId, async (database) => {
      if (!(await sessionStore.tenantExists(database, identity.tenantId))) {
        return null;
      }
      const credential = await issueCredential(database, {
        tenantId: identity.tenantId,
        kind: 'staff_session',
        subjectId: identity.subject,
        expiresAt: sessionExpiresAt,
      });
      await sessionStore.insert(database, {
        tenantId: identity.tenantId,
        credentialId: credential.id,
        subjectId: identity.subject,
        refreshTokenCiphertext: this.cipher.encrypt(signedIn.refreshToken, credential.id),
        now,
      });
      return { credentialId: credential.id, secret: credential.secret, expiresAt: sessionExpiresAt };
    });
  }

  /**
   * Resumes the session behind a verified `staff_session` credential, refreshing its tokens
   * when the refresh interval has passed; `null` when the session has ended or cannot be
   * confirmed right now.
   */
  async resume(credential: ResolvedCredential, now: Date): Promise<ActiveSession | null> {
    const key = { tenantId: credential.tenantId, credentialId: credential.id };
    const checked = await this.transactions.run(credential.tenantId, async (database) => {
      const stored = await sessionStore.find(database, key);
      if (stored === undefined || stored.endedAt !== null) {
        return { kind: 'ended' } as const;
      }
      if (now.getTime() - stored.lastSeenAt.getTime() >= this.settings.idleTimeoutMilliseconds) {
        await sessionStore.end(database, key, 'idle_timeout', now);
        return { kind: 'ended' } as const;
      }
      if (now.getTime() - stored.refreshedAt.getTime() < this.settings.refreshIntervalMilliseconds) {
        return (await sessionStore.touch(database, key, now))
          ? ({ kind: 'active', subjectId: stored.subjectId } as const)
          : ({ kind: 'ended' } as const);
      }
      return { kind: 'refresh_due', subjectId: stored.subjectId, ciphertext: stored.refreshTokenCiphertext } as const;
    });
    switch (checked.kind) {
      case 'ended':
        return null;
      case 'active':
        return this.activeSession(credential, checked.subjectId, now);
      case 'refresh_due':
        return this.refresh(credential, checked.subjectId, checked.ciphertext, now);
    }
  }

  /** Ends the session and, best effort, the identity provider's session behind it. */
  async end(credential: ResolvedCredential, reason: StaffSessionEndReason, now: Date): Promise<void> {
    const key = { tenantId: credential.tenantId, credentialId: credential.id };
    const ciphertext = await this.transactions.run(credential.tenantId, async (database) => {
      const stored = await sessionStore.find(database, key);
      if (stored === undefined) {
        return null;
      }
      await sessionStore.end(database, key, reason, now);
      return stored.refreshTokenCiphertext;
    });
    const refreshToken = ciphertext === null ? null : this.cipher.decrypt(ciphertext, credential.id);
    if (refreshToken !== null) {
      await this.provider.endSession(refreshToken);
    }
  }

  describe(session: ActiveSession): StaffSession {
    return {
      userId: session.subjectId,
      tenantId: session.tenantId,
      expiresAt: session.expiresAt.toISOString(),
      idleExpiresAt: new Date(session.lastSeenAt.getTime() + this.settings.idleTimeoutMilliseconds).toISOString(),
    };
  }

  private async refresh(
    credential: ResolvedCredential,
    subjectId: string,
    ciphertext: Buffer,
    now: Date,
  ): Promise<ActiveSession | null> {
    const key = { tenantId: credential.tenantId, credentialId: credential.id };
    const refreshToken = this.cipher.decrypt(ciphertext, credential.id);
    const outcome =
      refreshToken === null
        ? ({ kind: 'refused', reason: 'invalid_token' } as const)
        : await this.provider.refresh(refreshToken, now);
    if (outcome.kind === 'unavailable') {
      this.logger.warn('A staff session refresh could not reach the identity provider; the request is refused');
      return null;
    }
    if (outcome.kind === 'refused') {
      this.logger.log(`A staff session ended because its refresh was refused (${outcome.reason})`);
      await this.transactions.run(credential.tenantId, (database) =>
        sessionStore.end(database, key, 'refresh_failed', now),
      );
      return null;
    }
    const { identity } = outcome;
    if (identity.subject !== subjectId || identity.tenantId !== credential.tenantId) {
      this.logger.log('A staff session ended because its refreshed identity names another user or tenant');
      await this.transactions.run(credential.tenantId, (database) =>
        sessionStore.end(database, key, 'identity_changed', now),
      );
      await this.provider.endSession(outcome.refreshToken);
      return null;
    }
    const recorded = await this.transactions.run(credential.tenantId, (database) =>
      sessionStore.recordRefresh(database, key, this.cipher.encrypt(outcome.refreshToken, credential.id), now),
    );
    return recorded ? this.activeSession(credential, subjectId, now) : null;
  }

  private activeSession(credential: ResolvedCredential, subjectId: string, now: Date): ActiveSession {
    return {
      credentialId: credential.id,
      tenantId: credential.tenantId,
      subjectId,
      expiresAt: credential.expiresAt,
      lastSeenAt: now,
    };
  }
}
