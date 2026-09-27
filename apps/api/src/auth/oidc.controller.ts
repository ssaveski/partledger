import type { IncomingMessage, ServerResponse } from 'node:http';

import { Controller, Get, HttpCode, Inject, Logger, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import { signInFailedParameter, signInQuerySchema, staffAuthPaths, type StaffSession } from '@partledger/contracts';
import type { ResolvedCredential } from '@partledger/db';
import { domainError } from '@partledger/domain';
import { z } from 'zod';

import { CredentialResolver } from '../db/db.module';
import { DomainFailure, UnauthenticatedFailure } from '../http/failures';
import { entryAdapterOf } from '../listeners/listeners';
import { clock, type Clock } from '../time/clock';
import { identityProvider, type IdentityProvider } from './identity-provider';
import {
  expiredCookie,
  presentedSessionCredential,
  readCookie,
  serializeCookie,
  sessionCookie,
  sessionCookieName,
  signInCookieName,
} from './session-cookie';
import {
  codeChallengeOf,
  newSignInState,
  openSignInState,
  sealSignInState,
  signInStateLifetimeSeconds,
} from './sign-in-state';
import { StaffSessions, type ResumedSession } from './staff-sessions';
import { TokenCipher } from './token-cipher';

export const staffAppOrigin = Symbol('StaffAppOrigin');

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().optional(),
});

/**
 * Staff sign-in, session and sign-out (KTD20), served on the staff listener only. The API is
 * the OpenID Connect client: it runs the authorization code flow with PKCE, validates the
 * tokens, keeps the refresh token server-side and gives the browser a session cookie.
 */
@Controller('auth')
export class OidcController {
  private readonly logger = new Logger('StaffSignIn');

  constructor(
    @Inject(identityProvider) private readonly provider: IdentityProvider,
    @Inject(StaffSessions) private readonly sessions: StaffSessions,
    @Inject(CredentialResolver) private readonly credentials: CredentialResolver,
    @Inject(TokenCipher) private readonly cipher: TokenCipher,
    @Inject(staffAppOrigin) private readonly origin: string,
    @Inject(clock) private readonly time: Clock,
  ) {}

  @Get('sign-in')
  async signIn(
    @Query() query: unknown,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    staffListenerOnly(request);
    const parsed = signInQuerySchema.safeParse(query);
    const returnTo = parsed.success ? (parsed.data.returnTo ?? '/') : '/';
    const signIn = newSignInState(returnTo, this.time.now());
    const authorization = await this.provider.authorizationUrl({
      state: signIn.state,
      nonce: signIn.nonce,
      codeChallenge: codeChallengeOf(signIn.codeVerifier),
      redirectUri: this.redirectUri(),
    });
    if (!authorization.ok) {
      this.logger.warn('A staff sign-in could not start: the identity provider is unavailable');
      this.redirect(response, this.failedUrl());
      return;
    }
    response.setHeader(
      'set-cookie',
      serializeCookie(signInCookieName, sealSignInState(this.cipher, signIn), {
        maxAgeSeconds: signInStateLifetimeSeconds,
        sameSite: 'Lax',
      }),
    );
    this.redirect(response, authorization.value.toString());
  }

  @Get('callback')
  async callback(
    @Query() query: unknown,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    staffListenerOnly(request);
    const now = this.time.now();
    const cookies = [expiredCookie(signInCookieName, 'Lax')];
    const parsed = callbackQuerySchema.safeParse(query);
    const signIn = openSignInState(
      this.cipher,
      readCookie(request.headers.cookie, signInCookieName),
      parsed.success ? parsed.data.state : undefined,
      now,
    );
    const code = parsed.success && parsed.data.error === undefined ? parsed.data.code : undefined;
    if (signIn === null || code === undefined) {
      this.logger.warn('A staff sign-in callback was refused: its state or code is missing or invalid');
      response.setHeader('set-cookie', cookies);
      this.redirect(response, this.failedUrl());
      return;
    }
    const exchanged = await this.provider.exchangeCode(
      { code, codeVerifier: signIn.codeVerifier, redirectUri: this.redirectUri(), nonce: signIn.nonce },
      now,
    );
    const started = exchanged.ok ? await this.sessions.start(exchanged.value, now) : null;
    if (started === null) {
      this.logger.warn(`A staff sign-in was refused (${exchanged.ok ? 'unknown_tenant' : exchanged.error})`);
      if (exchanged.ok) {
        await this.provider.endSession(exchanged.value.refreshToken);
      }
      response.setHeader('set-cookie', cookies);
      this.redirect(response, this.failedUrl());
      return;
    }
    const maxAgeSeconds = (started.expiresAt.getTime() - now.getTime()) / 1000;
    cookies.push(sessionCookie(started.credentialId, started.secret, maxAgeSeconds));
    response.setHeader('set-cookie', cookies);
    this.redirect(response, `${this.origin}${signIn.returnTo}`);
  }

  @Get('session')
  async session(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<StaffSession> {
    staffListenerOnly(request);
    response.setHeader('cache-control', 'no-store');
    const now = this.time.now();
    const credential = await this.presentedCredential(request, now);
    const resumed: ResumedSession =
      credential === null ? { kind: 'ended' } : await this.sessions.resume(credential, now);
    switch (resumed.kind) {
      case 'active':
        return this.sessions.describe(resumed.session);
      case 'unavailable':
        throw new DomainFailure(domainError('Unavailable', 'dependencyUnavailable'));
      case 'ended':
        throw new UnauthenticatedFailure();
    }
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse): Promise<void> {
    staffListenerOnly(request);
    response.setHeader('cache-control', 'no-store');
    const now = this.time.now();
    const credential = await this.presentedCredential(request, now);
    if (credential !== null) {
      await this.sessions.end(credential, 'signed_out', now);
    }
    response.setHeader('set-cookie', expiredCookie(sessionCookieName, 'Strict'));
  }

  private async presentedCredential(request: IncomingMessage, now: Date): Promise<ResolvedCredential | null> {
    const presented = presentedSessionCredential(request.headers.cookie);
    if (presented === null) {
      return null;
    }
    const verification = await this.credentials.verify(presented, now);
    return verification.ok ? verification.credential : null;
  }

  private redirectUri(): string {
    return `${this.origin}${staffAuthPaths.callback}`;
  }

  private failedUrl(): string {
    return `${this.origin}/?${signInFailedParameter.name}=${signInFailedParameter.value}`;
  }

  private redirect(response: ServerResponse, location: string): void {
    response.statusCode = 303;
    response.setHeader('location', location);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.end();
  }
}

/** The sign-in routes exist only on the staff listener; elsewhere they are an unknown route. */
function staffListenerOnly(request: IncomingMessage): void {
  if (entryAdapterOf(request) !== 'staff') {
    throw new NotFoundException();
  }
}
