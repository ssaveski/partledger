import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import type { AppConfig } from './config/env.schema';

export const apiPrefix = 'api/v1';

/** Initialising the app runs the catalog check; a database that fails it refuses the boot. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), { logger: ['error', 'warn'] });
  app.setGlobalPrefix(apiPrefix);
  try {
    await app.init();
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
