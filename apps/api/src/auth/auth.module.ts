import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import type { AppConfig } from '../config/env.schema';
import { stepUpPolicy, type StepUpPolicy } from '../principals/step-up';
import { clock, type Clock } from '../time/clock';
import { CsrfGuard } from './csrf.guard';
import { identityAdministration, type IdentityAdministration } from './identity-administration';
import { identityProvider, type IdentityProvider } from './identity-provider';
import { KeycloakIdentityAdministration } from './keycloak-identity-administration';
import { KeycloakIdentityProvider } from './keycloak-identity-provider';
import { OidcController, staffAppOrigin } from './oidc.controller';
import { sessionSettings, StaffSessions, type SessionSettings } from './staff-sessions';
import { TokenCipher } from './token-cipher';

export interface AuthOptions {
  readonly config: AppConfig;
  readonly clock: Clock;
  /** Tests that issue sessions without Keycloak replace it; production always uses Keycloak. */
  readonly identityProvider?: IdentityProvider;
  readonly identityAdministration?: IdentityAdministration;
}

export function sessionSettingsFrom(config: AppConfig): SessionSettings {
  return {
    idleTimeoutMilliseconds: config.STAFF_SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
    absoluteTimeoutMilliseconds: config.STAFF_SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000,
    refreshIntervalMilliseconds: config.STAFF_SESSION_REFRESH_INTERVAL_SECONDS * 1000,
  };
}

export function stepUpPolicyFrom(config: AppConfig): StepUpPolicy {
  return { level: config.STEP_UP_ACR, freshnessMilliseconds: config.STEP_UP_FRESHNESS_SECONDS * 1000 };
}

@Module({})
export class AuthModule {
  static register(options: AuthOptions): DynamicModule {
    const { config } = options;
    return {
      module: AuthModule,
      global: true,
      controllers: [OidcController],
      providers: [
        {
          provide: identityProvider,
          useValue:
            options.identityProvider ??
            new KeycloakIdentityProvider({
              issuer: config.KEYCLOAK_ISSUER,
              clientId: config.KEYCLOAK_CLIENT_ID,
              clientSecret: config.KEYCLOAK_CLIENT_SECRET,
              jwksCooldownSeconds: config.KEYCLOAK_JWKS_COOLDOWN_SECONDS,
            }),
        },
        {
          provide: identityAdministration,
          useValue:
            options.identityAdministration ??
            new KeycloakIdentityAdministration({
              issuer: config.KEYCLOAK_ISSUER,
              clientId: config.KEYCLOAK_ADMIN_CLIENT_ID,
              clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
            }),
        },
        { provide: stepUpPolicy, useValue: stepUpPolicyFrom(config) },
        { provide: TokenCipher, useValue: new TokenCipher(config.SESSION_TOKEN_KEY) },
        { provide: sessionSettings, useValue: sessionSettingsFrom(config) },
        { provide: staffAppOrigin, useValue: config.STAFF_APP_ORIGIN },
        { provide: clock, useValue: options.clock },
        { provide: APP_GUARD, useClass: CsrfGuard },
        StaffSessions,
      ],
      exports: [StaffSessions, identityAdministration, stepUpPolicy],
    };
  }
}
