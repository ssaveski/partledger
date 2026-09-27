import { Module, type DynamicModule } from '@nestjs/common';
import type { CatalogExpectations } from '@partledger/db';

import { AiModule } from './ai/ai.module';
import type { EgressNetwork } from './ai/egress-allowlist';
import type { LocalResponder } from './ai/local-model';
import type { SuggestionTargets } from './ai/suggestion-targets';
import { AuthModule } from './auth/auth.module';
import type { IdentityAdministration } from './auth/identity-administration';
import type { IdentityProvider } from './auth/identity-provider';
import type { OperationRegistry } from './commands/handlers';
import { OperationsModule } from './commands/operations.module';
import { productionRegistry } from './commands/query-registry';
import type { AppConfig } from './config/env.schema';
import { DatabaseModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { IdentityChecksModule } from './identity-checks/identity-checks.module';
import type { IdentityRegisters } from './identity-checks/identity-registers';
import { productionJobs } from './jobs/job-registry';
import { JobsModule } from './jobs/job-runner.module';
import type { KeyService } from './keys/key-service.port';
import { KeysModule } from './keys/keys.module';
import type { ModuleJobs } from './jobs/job.types';
import type { EmailPort } from './notifications/email.port';
import { NotificationsModule } from './notifications/notifications.module';
import type { RecipientDirectory } from './notifications/recipient-directory';
import type { RoleDirectory } from './principals/role-directory';
import type { IdentityOrganizations } from './tenants/identity-organizations';
import { membershipDirectory } from './tenants/membership-directory';
import { TenantsModule } from './tenants/tenants.module';
import { systemClock, type Clock } from './time/clock';
import type { MalwareScanner } from './uploads/malware-scanner.port';
import { UploadsModule } from './uploads/uploads.module';

/** Replaceable parts, for tests only; production always uses the defaults. */
export interface AppOverrides {
  readonly registry?: OperationRegistry;
  readonly roleDirectory?: RoleDirectory;
  readonly clock?: Clock;
  readonly identityProvider?: IdentityProvider;
  readonly identityAdministration?: IdentityAdministration;
  readonly identityOrganizations?: IdentityOrganizations;
  readonly jobs?: ModuleJobs;
  readonly jobPollingIntervalSeconds?: number;
  /** Tables a test created beside the shipped schema, which the boot-time catalog check must know. */
  readonly catalogExpectations?: CatalogExpectations;
  readonly emailPort?: EmailPort;
  /** Replaces the configured malware scanner, to slow or fail scans. */
  readonly malwareScanner?: MalwareScanner;
  readonly recipientDirectory?: RecipientDirectory;
  readonly keyService?: KeyService;
  /** Replaces the network AI calls use, so no call ever leaves the process. */
  readonly aiNetwork?: EgressNetwork;
  /** Scripts the local AI model's answers. */
  readonly aiLocalResponder?: LocalResponder;
  readonly suggestionTargets?: SuggestionTargets;
  readonly identityRegisters?: IdentityRegisters;
}

@Module({})
export class AppModule {
  static register(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    const time = overrides.clock ?? systemClock;
    const roles = overrides.roleDirectory ?? membershipDirectory;
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot({
          connectionString: config.DATABASE_URL,
          poolSize: config.DATABASE_POOL_SIZE,
          ...(overrides.catalogExpectations === undefined ? {} : { catalog: overrides.catalogExpectations }),
        }),
        JobsModule.register({
          connectionString: config.JOBS_DATABASE_URL,
          poolSize: config.JOBS_DATABASE_POOL_SIZE,
          workers: config.JOBS_WORKERS === 'on',
          catalog: overrides.jobs ?? productionJobs,
          clock: time,
          ...(overrides.jobPollingIntervalSeconds === undefined
            ? {}
            : { pollingIntervalSeconds: overrides.jobPollingIntervalSeconds }),
          ...(overrides.catalogExpectations === undefined
            ? {}
            : { catalogExpectations: overrides.catalogExpectations }),
        }),
        NotificationsModule.register({
          config,
          emailPort: overrides.emailPort,
          recipientDirectory: overrides.recipientDirectory,
        }),
        KeysModule.register({ config, keyService: overrides.keyService }),
        AiModule.register({
          config,
          clock: time,
          network: overrides.aiNetwork,
          localResponder: overrides.aiLocalResponder,
          suggestionTargets: overrides.suggestionTargets,
          catalogExpectations: overrides.catalogExpectations,
        }),
        AuthModule.register({
          config,
          clock: time,
          identityProvider: overrides.identityProvider,
          identityAdministration: overrides.identityAdministration,
          roleDirectory: roles,
        }),
        TenantsModule.register({ config, clock: time, identityOrganizations: overrides.identityOrganizations }),
        UploadsModule.register({ config, clock: time, roleDirectory: roles, malwareScanner: overrides.malwareScanner }),
        IdentityChecksModule.register({ config, registers: overrides.identityRegisters }),
        OperationsModule.register({
          registry: overrides.registry ?? productionRegistry,
          roleDirectory: roles,
          clock: time,
        }),
      ],
      controllers: [HealthController],
    };
  }
}
