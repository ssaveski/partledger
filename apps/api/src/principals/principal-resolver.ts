import { Inject, Injectable } from '@nestjs/common';
import type { PresentedCredential, ResolvedCredential } from '@partledger/db';

import { presentedSessionCredential } from '../auth/session-cookie';
import { StaffSessions } from '../auth/staff-sessions';
import { CredentialResolver } from '../db/db.module';
import { acceptsCredentialKind, type HttpEntryAdapter } from '../listeners/entry-adapters';
import { parseAuthorizationHeader } from './credential-token';
import type { AuthenticatedPrincipal } from './principal';

/** The request headers that may carry a credential. */
export interface PresentedHeaders {
  readonly authorization: string | undefined;
  readonly cookie: string | undefined;
}

/**
 * Turns the credential a request presents into a principal (KTD15). The staff listener reads
 * only the `__Host-` session cookie and never an `Authorization` header, so a staff session
 * is never usable as a bearer token; the other listeners read only the `Authorization`
 * header. Every refusal (no credential, a kind this listener does not accept, unknown id,
 * wrong secret, expired, revoked, a staff session that has ended) is `null`, which the API
 * answers with one uniform 401.
 */
@Injectable()
export class PrincipalResolver {
  constructor(
    @Inject(CredentialResolver) private readonly credentials: CredentialResolver,
    @Inject(StaffSessions) private readonly staffSessions: StaffSessions,
  ) {}

  async authenticate(
    adapter: HttpEntryAdapter,
    headers: PresentedHeaders,
    correlationId: string,
    now: Date,
  ): Promise<AuthenticatedPrincipal | null> {
    const presented = presentedCredential(adapter, headers);
    if (presented === null || !acceptsCredentialKind(adapter, presented.kind)) {
      return null;
    }
    const verification = await this.credentials.verify(presented, now);
    if (!verification.ok) {
      return null;
    }
    const { credential } = verification;
    if (credential.kind === 'staff_session' && (await this.staffSessions.resume(credential, now)) === null) {
      return null;
    }
    return principalFor(credential, adapter, correlationId);
  }
}

function presentedCredential(adapter: HttpEntryAdapter, headers: PresentedHeaders): PresentedCredential | null {
  return adapter === 'staff'
    ? presentedSessionCredential(headers.cookie)
    : parseAuthorizationHeader(headers.authorization);
}

function principalFor(
  credential: ResolvedCredential,
  adapter: HttpEntryAdapter,
  correlationId: string,
): AuthenticatedPrincipal | null {
  const base = {
    tenantId: credential.tenantId,
    actedUnder: { grant: credential.kind, credentialId: credential.id },
    adapter,
    correlationId,
  };
  switch (credential.kind) {
    case 'staff_session':
      return credential.subjectId === null
        ? null
        : { ...base, type: 'person', userId: credential.subjectId, stepUp: null };
    case 'supplier_link':
      return { ...base, type: 'supplier_token', supplierId: credential.subjectId };
    case 'drop_credential':
      return { ...base, type: 'system', actedUnder: { grant: 'drop_credential', credentialId: credential.id } };
    case 'platform_operator':
      // The credential is an active break-glass grant; its tenant is the tenant that approved it.
      return credential.subjectId === null
        ? null
        : { ...base, type: 'platform_operator', operatorId: credential.subjectId };
  }
}
