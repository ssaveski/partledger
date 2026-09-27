import { Module, type DynamicModule } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import type { IdentityProvider } from './auth/identity-provider';
import type { OperationRegistry } from './commands/handlers';
import { OperationsModule } from './commands/operations.module';
import { productionRegistry } from './commands/query-registry';
import type { AppConfig } from './config/env.schema';
import { DatabaseModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { noRoleAssignments, type RoleDirectory } from './principals/role-directory';
import { systemClock, type Clock } from './time/clock';

/** Replaceable parts, for tests only; production always uses the defaults. */
export interface AppOverrides {
  readonly registry?: OperationRegistry;
  readonly roleDirectory?: RoleDirectory;
  readonly clock?: Clock;
  readonly identityProvider?: IdentityProvider;
}

@Module({})
export class AppModule {
  static register(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    const time = overrides.clock ?? systemClock;
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot({ connectionString: config.DATABASE_URL, poolSize: config.DATABASE_POOL_SIZE }),
        AuthModule.register({ config, clock: time, identityProvider: overrides.identityProvider }),
        OperationsModule.register({
          registry: overrides.registry ?? productionRegistry,
          roleDirectory: overrides.roleDirectory ?? noRoleAssignments,
          clock: time,
        }),
      ],
      controllers: [HealthController],
    };
  }
}
