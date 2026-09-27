import { Module, type DynamicModule } from '@nestjs/common';

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
}

@Module({})
export class AppModule {
  static register(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot({ connectionString: config.DATABASE_URL, poolSize: config.DATABASE_POOL_SIZE }),
        OperationsModule.register({
          registry: overrides.registry ?? productionRegistry,
          roleDirectory: overrides.roleDirectory ?? noRoleAssignments,
          clock: overrides.clock ?? systemClock,
        }),
      ],
      controllers: [HealthController],
    };
  }
}
