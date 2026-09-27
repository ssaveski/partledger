import { failure, success, type Result } from '@partledger/domain';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/**
 * Token validation for staff sign-in (KTD20). Tokens are checked against the realm's signing
 * keys, fetched from its JWKS endpoint and cached; a token naming an unknown key triggers a
 * refetch once the cooldown has passed, so a rotated key is picked up without a restart.
 */
export function remoteSigningKeys(jwksUri: URL, cooldownSeconds: number): JWTVerifyGetKey {
  return createRemoteJWKSet(jwksUri, {
    cooldownDuration: cooldownSeconds * 1000,
    cacheMaxAge: 10 * 60 * 1000,
    timeoutDuration: 5000,
  });
}

/**
 * The organization claim the realm's client mapper adds: one entry per organization the user
 * belongs to, keyed by alias, each with the organization's id and attributes. The tenant id is
 * the organization's `tenant_id` attribute, set when the tenant is provisioned (U8).
 */
export const organizationClaim = 'partledger_organization';

const organizationSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.tuple([z.uuid()]),
});

const organizationsSchema = z.record(z.string(), z.unknown());

const staffClaimsSchema = z.object({
  sub: z.uuid(),
  typ: z.string(),
  azp: z.string().optional(),
  nonce: z.string().optional(),
});

/** Keycloak marks tokens issued through impersonation; RFC 8693 marks delegated ones with `act`. */
const delegationClaims = ['impersonator', 'act'] as const;

export type TokenKind = 'access' | 'id';

const payloadTypeOf = { access: 'Bearer', id: 'ID' } as const satisfies Record<TokenKind, string>;

export interface StaffIdentity {
  /** The identity provider's user id. */
  readonly subject: string;
  readonly tenantId: string;
  readonly organizationId: string;
}

export type TokenRefusal =
  | 'invalid_token'
  /** The realm's signing keys could not be fetched; nothing is known about the token. */
  | 'keys_unavailable'
  | 'wrong_token_type'
  | 'wrong_authorized_party'
  | 'nonce_mismatch'
  | 'impersonated'
  | 'no_organization'
  | 'several_organizations'
  | 'organization_without_tenant';

export interface TokenExpectations {
  readonly keys: JWTVerifyGetKey;
  readonly issuer: string;
  /** The API's client id: an access token must be for it, and an id token issued to it. */
  readonly clientId: string;
  readonly kind: TokenKind;
  readonly now: Date;
  /** Id tokens from a sign-in carry the nonce the sign-in sent. */
  readonly nonce?: string;
}

const allowedAlgorithms = ['RS256', 'PS256', 'ES256'];

/**
 * Verifies a token's signature, issuer, audience and expiry, then its shape: a uuid subject,
 * no impersonation or delegation, and exactly one organization carrying one tenant id.
 */
export async function verifyStaffToken(
  token: string,
  expectations: TokenExpectations,
): Promise<Result<StaffIdentity, TokenRefusal>> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, expectations.keys, {
      issuer: expectations.issuer,
      audience: expectations.clientId,
      algorithms: allowedAlgorithms,
      currentDate: expectations.now,
      clockTolerance: 5,
      requiredClaims: ['exp', 'iat', 'sub'],
    }));
  } catch (error) {
    return failure(keySetUnreachable(error) ? 'keys_unavailable' : 'invalid_token');
  }
  const claims = staffClaimsSchema.safeParse(payload);
  if (!claims.success) {
    return failure('invalid_token');
  }
  if (claims.data.typ !== payloadTypeOf[expectations.kind]) {
    return failure('wrong_token_type');
  }
  if (expectations.kind === 'access' && claims.data.azp !== expectations.clientId) {
    return failure('wrong_authorized_party');
  }
  if (expectations.nonce !== undefined && claims.data.nonce !== expectations.nonce) {
    return failure('nonce_mismatch');
  }
  if (delegationClaims.some((claim) => Object.hasOwn(payload, claim))) {
    return failure('impersonated');
  }
  const organization = singleOrganization(payload[organizationClaim]);
  if (!organization.ok) {
    return organization;
  }
  return success({
    subject: claims.data.sub,
    tenantId: organization.value.tenant_id[0],
    organizationId: organization.value.id,
  });
}

/**
 * Whether verification failed because the realm's key set could not be fetched, rather than
 * because of the token: a timeout, a network failure (a non-JOSE error from `fetch`), a
 * non-200 answer or an unreadable body (both generic JOSE errors), or a malformed key set.
 * These say nothing about the session, so they must not end it.
 */
function keySetUnreachable(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) {
    return true;
  }
  return (
    error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || error.code === errors.JOSEError.code
  );
}

function singleOrganization(claim: unknown): Result<z.infer<typeof organizationSchema>, TokenRefusal> {
  if (claim === undefined) {
    return failure('no_organization');
  }
  const organizations = organizationsSchema.safeParse(claim);
  if (!organizations.success) {
    return failure('invalid_token');
  }
  const entries = Object.values(organizations.data);
  if (entries.length === 0) {
    return failure('no_organization');
  }
  if (entries.length > 1) {
    return failure('several_organizations');
  }
  const organization = organizationSchema.safeParse(entries[0]);
  return organization.success ? success(organization.data) : failure('organization_without_tenant');
}
