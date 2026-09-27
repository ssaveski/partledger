import { failure, success, type Result } from '@partledger/domain';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/**
 * Operators on the operator listener (KTD30, R4). They sign in through a separate Keycloak
 * realm whose only browser flow demands a password and a one-time code, and present the
 * realm's access token as a bearer token. A signed-in operator reaches no tenant with it: the
 * only action it allows is provisioning a new tenant. Everything else an operator does needs a
 * break-glass grant the tenant approved (U30), presented as a `platform_operator` credential.
 */
export interface OperatorRealm {
  readonly issuer: string;
  /** The client operators sign in with; the token must be issued to it. */
  readonly clientId: string;
  /** The audience the token must carry. */
  readonly audience: string;
}

export interface SignedInOperator {
  /** The operator realm's user id. */
  readonly operatorId: string;
}

export type OperatorRefusal = 'refused' | 'unavailable';

const discoverySchema = z.object({ issuer: z.string(), jwks_uri: z.url() });

const operatorClaimsSchema = z.object({ sub: z.uuid(), typ: z.literal('Bearer'), azp: z.string() });

/** Keycloak marks tokens issued through impersonation; RFC 8693 marks delegated ones with `act`. */
const delegationClaims = ['impersonator', 'act'] as const;

const allowedAlgorithms = ['RS256', 'PS256', 'ES256'];

const requestTimeoutMilliseconds = 5000;

export class OperatorAuthenticator {
  private keys: Promise<JWTVerifyGetKey> | undefined;

  constructor(private readonly realm: OperatorRealm) {}

  /** Reads `Authorization: Bearer <access token>`; anything else is refused. */
  async authenticate(authorization: string | undefined, now: Date): Promise<Result<SignedInOperator, OperatorRefusal>> {
    if (authorization?.startsWith('Bearer ') !== true) {
      return failure('refused');
    }
    const keys = await this.signingKeys();
    if (keys === null) {
      return failure('unavailable');
    }
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(authorization.slice('Bearer '.length), keys, {
        issuer: this.realm.issuer,
        audience: this.realm.audience,
        algorithms: allowedAlgorithms,
        currentDate: now,
        clockTolerance: 5,
        requiredClaims: ['exp', 'iat', 'sub'],
      }));
    } catch (error) {
      return failure(keySetUnreachable(error) ? 'unavailable' : 'refused');
    }
    const claims = operatorClaimsSchema.safeParse(payload);
    if (
      !claims.success ||
      claims.data.azp !== this.realm.clientId ||
      delegationClaims.some((claim) => Object.hasOwn(payload, claim))
    ) {
      return failure('refused');
    }
    return success({ operatorId: claims.data.sub });
  }

  private async signingKeys(): Promise<JWTVerifyGetKey | null> {
    this.keys ??= this.discoverKeys();
    try {
      return await this.keys;
    } catch {
      this.keys = undefined;
      return null;
    }
  }

  private async discoverKeys(): Promise<JWTVerifyGetKey> {
    const response = await fetch(`${this.realm.issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    if (!response.ok) {
      throw new Error(`Discovery answered ${response.status}`);
    }
    const discovery = discoverySchema.parse(await response.json());
    if (discovery.issuer !== this.realm.issuer) {
      throw new Error('Discovery names another issuer');
    }
    return createRemoteJWKSet(new URL(discovery.jwks_uri), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1000,
      timeoutDuration: requestTimeoutMilliseconds,
    });
  }
}

function keySetUnreachable(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) {
    return true;
  }
  return (
    error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || error.code === errors.JOSEError.code
  );
}
