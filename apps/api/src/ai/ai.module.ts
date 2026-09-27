import { Module, type DynamicModule } from '@nestjs/common';
import { shippedExpectations, type CatalogExpectations } from '@partledger/db';
import pg from 'pg';

import type { AppConfig } from '../config/env.schema';
import { createDatabasePool } from '../db/db.module';
import { clock, type Clock } from '../time/clock';
import { aiCallSettings, AiSuggestions, type AiCallSettings } from './ai-suggestions.service';
import { aiWorkerCatalog, AiWorkerDatabase, aiWorkerPool } from './ai-worker-database';
import { systemEgressNetwork, type EgressNetwork } from './egress-allowlist';
import type { LocalResponder } from './local-model';
import { platformConfigurationOf } from './platform-configuration';
import { productionSuggestionTargets, suggestionTargets, type SuggestionTargets } from './suggestion-targets';
import { AiConfigurations, platformAiConfiguration } from './tenant-ai-configuration';

export interface AiOptions {
  readonly config: Pick<
    AppConfig,
    | 'AI_WORKER_DATABASE_URL'
    | 'AI_WORKER_DATABASE_POOL_SIZE'
    | 'AI_PLATFORM_PROVIDER'
    | 'AI_PLATFORM_MODEL'
    | 'AI_PLATFORM_API_KEY'
    | 'AI_PLATFORM_AZURE_RESOURCE_NAME'
    | 'AI_PLATFORM_ENDPOINT_REGION'
    | 'AI_CALL_TIMEOUT_SECONDS'
  >;
  readonly clock: Clock;
  /** Tests replace the network, so no AI call leaves the process, and script the local model. */
  readonly network?: EgressNetwork | undefined;
  readonly localResponder?: LocalResponder | undefined;
  readonly suggestionTargets?: SuggestionTargets | undefined;
  readonly catalogExpectations?: CatalogExpectations | undefined;
}

/** The AI provider layer and the suggestion store (R30, R31, KTD25). */
@Module({})
export class AiModule {
  static register(options: AiOptions): DynamicModule {
    const { config } = options;
    const settings: AiCallSettings = {
      network: options.network ?? systemEgressNetwork,
      localResponder: options.localResponder,
      timeoutMilliseconds: config.AI_CALL_TIMEOUT_SECONDS * 1000,
    };
    return {
      module: AiModule,
      global: true,
      providers: [
        { provide: platformAiConfiguration, useValue: platformConfigurationOf(config) },
        { provide: aiCallSettings, useValue: settings },
        { provide: suggestionTargets, useFactory: () => options.suggestionTargets ?? productionSuggestionTargets() },
        {
          provide: aiWorkerPool,
          useFactory: (): pg.Pool | null =>
            config.AI_WORKER_DATABASE_URL === undefined
              ? null
              : createDatabasePool({
                  connectionString: config.AI_WORKER_DATABASE_URL,
                  poolSize: config.AI_WORKER_DATABASE_POOL_SIZE,
                }),
        },
        { provide: aiWorkerCatalog, useValue: options.catalogExpectations ?? shippedExpectations },
        { provide: clock, useValue: options.clock },
        AiWorkerDatabase,
        AiConfigurations,
        AiSuggestions,
      ],
      exports: [platformAiConfiguration, suggestionTargets, AiConfigurations, AiSuggestions, AiWorkerDatabase],
    };
  }
}
