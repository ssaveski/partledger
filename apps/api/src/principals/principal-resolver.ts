import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedCredential } from '@partledger/db';

import { CredentialResolver } from '../db/db.module';
import { acceptsCredentialKind, type HttpEntryAdapter } from '../listeners/entry-adapters';
import { parseAuthorizationHeader } from './credential-token';
import type { AuthenticatedPrincipal } from './principal';

/**
 * Turns the credential a request presents into a principal (KTD15). Every refusal (no
 * credential, a kind this listener does not accept, unknown id, wrong secret, expired,
 * revoked) is `null`, which the API answers with one uniform 401.
 */
@Injectable()
export class PrincipalResolver {
  constructor(@Inject(CredentialResolver) private readonly credentials: CredentialResolver) {}

  async authenticate(
    adapter: HttpEntryAdapter,
    authorization: string | undefined,
    correlationId: string,
    now: Date,
  ): Promise<AuthenticatedPrincipal | null> {
    const presented = parseAuthorizationHeader(authorization);
    if (presented === null || !acceptsCredentialKind(adapter, presented.kind)) {
      return null;
    }
    const verification = await this.credentials.verify(presented, now);
    if (!verification.ok) {
      return null;
    }
    return principalFor(verification.credential, adapter, correlationId);
  }
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
