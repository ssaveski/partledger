import { failure, success, type Result } from '@partledger/domain';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import type {
  AuthorizationRequest,
  CodeExchange,
  IdentityProvider,
  RefreshOutcome,
  SignedInIdentity,
  SignInRefusal,
} from './identity-provider';
import { remoteSigningKeys, verifyStaffToken, type StaffIdentity } from './jwks';

export interface KeycloakOptions {
  /** The realm URL, which is also its token issuer. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly jwksCooldownSeconds: number;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  end_session_endpoint: z.url(),
});

interface Endpoints {
  readonly authorization: URL;
  readonly token: URL;
  readonly endSession: URL;
  readonly keys: JWTVerifyGetKey;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
});

const tokenErrorSchema = z.object({ error: z.string() });

/** Scopes the sign-in asks for; `organization` makes Keycloak add the user's organization. */
const signInScope = 'openid organization';

const requestTimeoutMilliseconds = 5000;

type TokenCall = Result<z.infer<typeof tokenResponseSchema>, 'refused' | 'unavailable'>;

/**
 * Keycloak as the staff identity provider. The API is a confidential client: it authenticates
 * to the token endpoint with its secret, and it never hands a token to the browser.
 */
export class KeycloakIdentityProvider implements IdentityProvider {
  private endpoints: Promise<Endpoints> | undefined;

  constructor(private readonly options: KeycloakOptions) {}

  async authorizationUrl(request: AuthorizationRequest): Promise<Result<URL, 'unavailable'>> {
    const endpoints = await this.discover();
    if (endpoints === null) {
      return failure('unavailable');
    }
    const url = new URL(endpoints.authorization);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: 'code',
      scope: signInScope,
      redirect_uri: request.redirectUri,
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return success(url);
  }

  async exchangeCode(exchange: CodeExchange, now: Date): Promise<Result<SignedInIdentity, SignInRefusal>> {
    const endpoints = await this.discover();
    if (endpoints === null) {
      return failure('unavailable');
    }
    const response = await this.callTokenEndpoint(endpoints, {
      grant_type: 'authorization_code',
      code: exchange.code,
      redirect_uri: exchange.redirectUri,
      code_verifier: exchange.codeVerifier,
    });
    if (!response.ok) {
      return failure(response.error === 'refused' ? 'code_refused' : 'unavailable');
    }
    const { access_token: accessToken, id_token: idToken, refresh_token: refreshToken } = response.value;
    if (idToken === undefined) {
      return failure('invalid_token');
    }
    const identity = await this.validate(endpoints, now, accessToken, idToken, exchange.nonce);
    if (!identity.ok) {
      return failure(identity.error === 'keys_unavailable' ? 'unavailable' : identity.error);
    }
    if (refreshToken === undefined) {
      return failure('no_refresh_token');
    }
    return success({ identity: identity.value, refreshToken });
  }

  async refresh(refreshToken: string, now: Date): Promise<RefreshOutcome> {
    const endpoints = await this.discover();
    if (endpoints === null) {
      return { kind: 'unavailable' };
    }
    const response = await this.callTokenEndpoint(endpoints, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (!response.ok) {
      return response.error === 'refused' ? { kind: 'refused', reason: 'code_refused' } : { kind: 'unavailable' };
    }
    const tokens = response.value;
    const identity = await this.validate(endpoints, now, tokens.access_token, tokens.id_token, undefined);
    if (!identity.ok) {
      // Without the realm's keys nothing is known about the new tokens; the session stands.
      return identity.error === 'keys_unavailable'
        ? { kind: 'unavailable' }
        : { kind: 'refused', reason: identity.error };
    }
    return { kind: 'refreshed', identity: identity.value, refreshToken: tokens.refresh_token ?? refreshToken };
  }

  async endSession(refreshToken: string): Promise<void> {
    const endpoints = await this.discover();
    if (endpoints === null) {
      return;
    }
    try {
      await fetch(endpoints.endSession, {
        method: 'POST',
        headers: this.clientHeaders(),
        body: new URLSearchParams({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      // The API session has already ended; Keycloak's session expires on its own.
    }
  }

  private async validate(
    endpoints: Endpoints,
    now: Date,
    accessToken: string,
    idToken: string | undefined,
    nonce: string | undefined,
  ): Promise<Result<StaffIdentity, SignInRefusal>> {
    const common = { keys: endpoints.keys, issuer: this.options.issuer, clientId: this.options.clientId, now };
    const access = await verifyStaffToken(accessToken, { ...common, kind: 'access' });
    if (!access.ok || idToken === undefined) {
      return access;
    }
    const id = await verifyStaffToken(
      idToken,
      nonce === undefined ? { ...common, kind: 'id' } : { ...common, kind: 'id', nonce },
    );
    if (!id.ok) {
      return id;
    }
    if (id.value.subject !== access.value.subject || id.value.tenantId !== access.value.tenantId) {
      return failure('subject_mismatch');
    }
    return access;
  }

  private clientHeaders(): Record<string, string> {
    const credentials = `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`;
    return {
      authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
  }

  private async callTokenEndpoint(endpoints: Endpoints, parameters: Record<string, string>): Promise<TokenCall> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(endpoints.token, {
        method: 'POST',
        headers: this.clientHeaders(),
        body: new URLSearchParams(parameters),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
      body = await response.json();
    } catch {
      return failure('unavailable');
    }
    if (response.ok) {
      const tokens = tokenResponseSchema.safeParse(body);
      return tokens.success ? success(tokens.data) : failure('refused');
    }
    // OAuth 2.0 answers a refused grant (disabled user, ended session, reused code) with 400 or 401.
    return response.status < 500 && tokenErrorSchema.safeParse(body).success
      ? failure('refused')
      : failure('unavailable');
  }

  private discover(): Promise<Endpoints | null> {
    this.endpoints ??= this.loadEndpoints();
    return this.endpoints.catch(() => {
      this.endpoints = undefined;
      return null;
    });
  }

  private async loadEndpoints(): Promise<Endpoints> {
    const response = await fetch(`${this.options.issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    if (!response.ok) {
      throw new Error(`Discovery answered ${response.status}`);
    }
    const discovery = discoverySchema.parse(await response.json());
    if (discovery.issuer !== this.options.issuer) {
      throw new Error('Discovery names another issuer');
    }
    return {
      authorization: new URL(discovery.authorization_endpoint),
      token: new URL(discovery.token_endpoint),
      endSession: new URL(discovery.end_session_endpoint),
      keys: remoteSigningKeys(new URL(discovery.jwks_uri), this.options.jwksCooldownSeconds),
    };
  }
}
