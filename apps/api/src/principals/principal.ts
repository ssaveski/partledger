import type { EntryAdapter, PrincipalType, TenantRole } from '@partledger/contracts';
import type { CredentialKind } from '@partledger/db';

/**
 * Who is acting (KTD15, R26). A principal is built only from a verified credential (or, for
 * background work, from the job that runs), never from the request body. Every principal
 * names the tenant it acts in, the grant it acted under, the entry adapter it arrived on and
 * a correlation id; the audit writer (U6) records all four with every state change.
 */

/** The grant a principal acted under: a credential, or the job that ran it. */
export type ActedUnder =
  { readonly grant: CredentialKind; readonly credentialId: string } | { readonly grant: 'job'; readonly jobId: string };

interface PrincipalBase {
  readonly type: PrincipalType;
  readonly tenantId: string;
  readonly actedUnder: ActedUnder;
  readonly adapter: EntryAdapter;
  readonly correlationId: string;
}

/** A recent step-up authentication (KTD20); U29 fills it from the session's `acr` and `auth_time`. */
export interface StepUp {
  readonly level: string;
  readonly authenticatedAt: Date;
}

export interface PersonPrincipal extends PrincipalBase {
  readonly type: 'person';
  readonly userId: string;
  /** Read from the tenant's rows on every request (KTD20), never from the credential. */
  readonly roles: readonly TenantRole[];
  readonly stepUp: StepUp | null;
}

export interface SupplierTokenPrincipal extends PrincipalBase {
  readonly type: 'supplier_token';
  /** The supplier organisation the link was issued to (U17 sets it on links). */
  readonly supplierId: string | null;
}

export interface SystemPrincipal extends PrincipalBase {
  readonly type: 'system';
  /** A background job, or an export drop pushed with a drop credential. */
  readonly actedUnder:
    | { readonly grant: 'drop_credential'; readonly credentialId: string }
    | { readonly grant: 'job'; readonly jobId: string };
}

export interface AiAgentPrincipal extends PrincipalBase {
  readonly type: 'ai_agent';
  readonly agentId: string;
}

export interface PlatformOperatorPrincipal extends PrincipalBase {
  readonly type: 'platform_operator';
  readonly operatorId: string;
}

export type Principal =
  PersonPrincipal | SupplierTokenPrincipal | SystemPrincipal | AiAgentPrincipal | PlatformOperatorPrincipal;

/** A credential that arrives on a listener, before the tenant's rows (roles) have been read. */
export type AuthenticatedPrincipal =
  Omit<PersonPrincipal, 'roles'> | SupplierTokenPrincipal | SystemPrincipal | PlatformOperatorPrincipal;

export function actorIdOf(principal: Principal): string | null {
  switch (principal.type) {
    case 'person':
      return principal.userId;
    case 'supplier_token':
      return principal.supplierId;
    case 'system':
      return null;
    case 'ai_agent':
      return principal.agentId;
    case 'platform_operator':
      return principal.operatorId;
  }
}
