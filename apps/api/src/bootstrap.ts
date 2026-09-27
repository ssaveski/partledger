import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule, type AppOverrides } from './app.module';
import type { AppConfig } from './config/env.schema';
import { startListeners, type ListenerBindings, type RunningListeners } from './listeners/listeners';

export const apiPrefix = 'api/v1';

/**
 * Initialising the app runs the catalog check and the registry rules; a database or registry
 * that fails them refuses the boot. The app does not listen itself: `startApi` serves it on
 * one listener per entry adapter.
 */
export async function createApp(config: AppConfig, overrides: AppOverrides = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config, overrides), {
    logger: ['error', 'warn'],
    // Throw instead of aborting the process, so a registry that breaks its rules is reported.
    abortOnError: false,
  });
  app.setGlobalPrefix(apiPrefix);
  try {
    await app.init();
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

export interface RunningApi {
  readonly app: INestApplication;
  readonly listeners: RunningListeners;
  close(): Promise<void>;
}

export async function startApi(
  config: AppConfig,
  bindings: ListenerBindings,
  overrides: AppOverrides = {},
): Promise<RunningApi> {
  const app = await createApp(config, overrides);
  let listeners: RunningListeners;
  try {
    listeners = await startListeners(app, bindings);
  } catch (error) {
    await app.close();
    throw error;
  }
  return {
    app,
    listeners,
    async close() {
      await listeners.close();
      await app.close();
    },
  };
}
