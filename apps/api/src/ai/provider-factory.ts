import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { AiProcessingRegion } from '@partledger/contracts';
import { failure, success, type Result } from '@partledger/domain';

import { guardedFetch, type EgressNetwork } from './egress-allowlist';
import { LocalLanguageModel, type LocalResponder } from './local-model';
import {
  processingRegionOf,
  providerConfigurationSchema,
  type ProviderConfiguration,
  type ProviderName,
} from './provider-configuration';

/**
 * Builds the language model for one AI call (KTD25). A model is constructed per call from a
 * whole configuration, never cached and never from a bare model-id string, which the AI SDK
 * would route through Vercel's gateway. Each provider gets its fixed endpoint, never one from
 * configuration or from the environment the SDK would otherwise read, and a `fetch` that only
 * reaches that endpoint's host (the egress allowlist).
 */

export interface ModelHandle {
  readonly model: LanguageModelV4;
  readonly provider: ProviderName;
  readonly modelId: string;
  readonly processingRegion: AiProcessingRegion;
}

export interface ModelFactoryOptions {
  readonly network: EgressNetwork;
  /** Scripts the local model's answers; tests only. */
  readonly localResponder?: LocalResponder | undefined;
}

/** The one endpoint of each provider, and the host the egress allowlist lets its calls reach. */
export function endpointOf(
  configuration: ProviderConfiguration,
): { readonly baseUrl: string; readonly host: string } | null {
  switch (configuration.provider) {
    case 'local':
      return null;
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com/v1', host: 'api.anthropic.com' };
    case 'openai': {
      const host = configuration.residency === 'eu' ? 'eu.api.openai.com' : 'api.openai.com';
      return { baseUrl: `https://${host}/v1`, host };
    }
    case 'azure_openai': {
      const host = `${configuration.resourceName}.openai.azure.com`;
      return { baseUrl: `https://${host}/openai`, host };
    }
    case 'mistral':
      return { baseUrl: 'https://api.mistral.ai/v1', host: 'api.mistral.ai' };
  }
}

function modelFor(configuration: ProviderConfiguration, options: ModelFactoryOptions): LanguageModelV4 {
  const endpoint = endpointOf(configuration);
  if (configuration.provider === 'local' || endpoint === null) {
    return new LocalLanguageModel(configuration.model, options.localResponder);
  }
  const settings = {
    apiKey: configuration.apiKey.reveal(),
    baseURL: endpoint.baseUrl,
    fetch: guardedFetch(new Set([endpoint.host]), options.network),
  };
  switch (configuration.provider) {
    case 'anthropic':
      return createAnthropic(settings)(configuration.model);
    case 'openai':
      return createOpenAI(settings)(configuration.model);
    case 'azure_openai':
      return createAzure({ ...settings, resourceName: configuration.resourceName }).chat(configuration.model);
    case 'mistral':
      return createMistral(settings)(configuration.model);
  }
}

/**
 * The model for one call. The configuration is parsed whole, so a string, a partial object or
 * one carrying an unknown field (such as a base URL) is refused and nothing is built.
 */
export function createModel(
  configuration: unknown,
  options: ModelFactoryOptions,
): Result<ModelHandle, 'invalid_configuration'> {
  const parsed = providerConfigurationSchema.safeParse(configuration);
  if (!parsed.success) {
    return failure('invalid_configuration');
  }
  return success({
    model: modelFor(parsed.data, options),
    provider: parsed.data.provider,
    modelId: parsed.data.model,
    processingRegion: processingRegionOf(parsed.data),
  });
}
