import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from './config/env.schema';
import { DatabaseModule } from './db/db.module';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot({ connectionString: config.DATABASE_URL, poolSize: config.DATABASE_POOL_SIZE })],
      controllers: [HealthController],
    };
  }
}
