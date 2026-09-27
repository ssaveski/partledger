import type { IncomingMessage, ServerResponse } from 'node:http';

import { Controller, Get, HttpCode, Inject, Logger, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import {
  signInFailedParameter,
  signInQuerySchema,
  staffAuthPaths,
  stepUpFailedParameter,
  stepUpQuerySchema,
  type StaffSession,
} from '@partledger/contracts';
import type { ResolvedCredential } from '@partledger/db';
import { domainError, type Result } from '@partledger/domain';
import { z } from 'zod';

import { CredentialResolver } from '../db/db.module';
import { DomainFailure, UnauthenticatedFailure } from '../http/failures';
import { entryAdapterOf } from '../listeners/listeners';
import { stepUpPolicy, type StepUpPolicy } from '../principals/step-up';
import { clock, type Clock } from '../time/clock';
import {
  identityProvider,
  type IdentityProvider,
  type SignedInIdentity,
  type SignInRefusal,
} from './identity-provider';
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
  type SignInState,
  type SteppedUpSession,
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
 * Staff sign-in, step-up, session and sign-out (KTD20), served on the staff listener only. The
 * API is the OpenID Connect client: it runs the authorization code flow with PKCE, validates
 * the tokens, keeps the refresh token server-side and gives the browser a session cookie. A
 * step-up runs the same flow for the current session with `acr_values` at the step-up level,
 * and records the level and time the new tokens carry on that session.
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
    @Inject(stepUpPolicy) private readonly stepUpRule: StepUpPolicy,
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
    await this.startAuthorization(response, newSignInState(returnTo, this.time.now()));
  }

  /**
   * Starts a step-up of the session the request presents (KTD20). The session cookie is
   * SameSite=Strict, which a top-level navigation from the staff app still carries; without an
   * active session the step-up cannot start and the person is sent back with the failure
   * parameter.
   */
  @Get('step-up')
  async stepUp(
    @Query() query: unknown,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    staffListenerOnly(request);
    const parsed = stepUpQuerySchema.safeParse(query);
    const returnTo = parsed.success ? (parsed.data.returnTo ?? '/') : '/';
    const now = this.time.now();
    const credential = await this.presentedCredential(request, now);
    const resumed: ResumedSession =
      credential === null ? { kind: 'ended' } : await this.sessions.resume(credential, now);
    if (resumed.kind !== 'active') {
      this.redirect(response, this.stepUpFailedUrl(returnTo));
      return;
    }
    const steppedUp: SteppedUpSession = {
      tenantId: resumed.session.tenantId,
      credentialId: resumed.session.credentialId,
    };
    await this.startAuthorization(response, newSignInState(returnTo, now, steppedUp));
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
      this.redirect(
        response,
        signIn?.stepUpOf === undefined ? this.failedUrl() : this.stepUpFailedUrl(signIn.returnTo),
      );
      return;
    }
    const exchanged = await this.provider.exchangeCode(
      { code, codeVerifier: signIn.codeVerifier, redirectUri: this.redirectUri(), nonce: signIn.nonce },
      now,
    );
    if (signIn.stepUpOf !== undefined) {
      response.setHeader('set-cookie', cookies);
      this.redirect(response, await this.completeStepUp(signIn, signIn.stepUpOf, exchanged, now));
      return;
    }
    const started = exchanged.ok ? await this.sessions.start(exchanged.value, now) : null;
    if (started === null) {
      this.logger.warn(
        `A staff sign-in was refused (${exchanged.ok ? 'unknown_tenant_or_not_a_member' : exchanged.error})`,
      );
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

  private async startAuthorization(response: ServerResponse, signIn: SignInState): Promise<void> {
    const authorization = await this.provider.authorizationUrl({
      state: signIn.state,
      nonce: signIn.nonce,
      codeChallenge: codeChallengeOf(signIn.codeVerifier),
      redirectUri: this.redirectUri(),
      ...(signIn.stepUpOf === undefined ? {} : { acrValues: this.stepUpRule.level }),
    });
    if (!authorization.ok) {
      this.logger.warn('A staff sign-in could not start: the identity provider is unavailable');
      this.redirect(response, signIn.stepUpOf === undefined ? this.failedUrl() : this.stepUpFailedUrl(signIn.returnTo));
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

  /**
   * Records a completed step-up on its session and returns where to send the person: back to
   * where they were when the tokens carry the step-up level, or there with the failure
   * parameter. Tokens for another person or tenant, or for a session that has ended, are
   * refused and the identity provider's session behind them is ended.
   */
  private async completeStepUp(
    signIn: SignInState,
    steppedUp: SteppedUpSession,
    exchanged: Result<SignedInIdentity, SignInRefusal>,
    now: Date,
  ): Promise<string> {
    if (!exchanged.ok) {
      this.logger.warn(`A staff step-up was refused (${exchanged.error})`);
      return this.stepUpFailedUrl(signIn.returnTo);
    }
    if ((await this.sessions.recordStepUp(steppedUp, exchanged.value, now)) === 'refused') {
      this.logger.warn('A staff step-up was refused: its session has ended or it names another person');
      await this.provider.endSession(exchanged.value.refreshToken);
      return this.stepUpFailedUrl(signIn.returnTo);
    }
    return exchanged.value.identity.authenticationLevel === this.stepUpRule.level
      ? `${this.origin}${signIn.returnTo}`
      : this.stepUpFailedUrl(signIn.returnTo);
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

  private stepUpFailedUrl(returnTo: string): string {
    const url = new URL(returnTo, this.origin);
    url.searchParams.set(stepUpFailedParameter.name, stepUpFailedParameter.value);
    return url.toString();
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
