import type { Result } from '@partledger/domain';

import type { StaffIdentity, TokenRefusal } from './jwks';

/**
 * The staff identity provider (KTD20), a port with Keycloak as its adapter. Every token it
 * returns has been validated; the refresh token is the only one the API keeps, encrypted.
 */
export interface AuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
}

export interface CodeExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly nonce: string;
}

export interface SignedInIdentity {
  readonly identity: StaffIdentity;
  readonly refreshToken: string;
}

export type SignInRefusal = TokenRefusal | 'code_refused' | 'subject_mismatch' | 'no_refresh_token' | 'unavailable';

export type RefreshOutcome =
  | { readonly kind: 'refreshed'; readonly identity: StaffIdentity; readonly refreshToken: string }
  /** The provider refused the refresh, or returned a token that fails validation: the session ends. */
  | { readonly kind: 'refused'; readonly reason: SignInRefusal }
  /** The provider could not be reached; the request is refused but the session is kept. */
  | { readonly kind: 'unavailable' };

export interface IdentityProvider {
  authorizationUrl(request: AuthorizationRequest): Promise<Result<URL, 'unavailable'>>;
  exchangeCode(exchange: CodeExchange, now: Date): Promise<Result<SignedInIdentity, SignInRefusal>>;
  refresh(refreshToken: string, now: Date): Promise<RefreshOutcome>;
  /** Ends the provider's own session behind a refresh token; failures are ignored, the API session ends anyway. */
  endSession(refreshToken: string): Promise<void>;
}

export const identityProvider = Symbol('IdentityProvider');
