import { inspect } from 'node:util';

import {
  aiModelSchema,
  azureRegionSchema,
  azureResourceNameSchema,
  openAiResidencies,
  type AiProcessingRegion,
} from '@partledger/contracts';
import { z } from 'zod';

/**
 * A provider API key in memory. It shows as `[redacted]` however it is printed, logged or
 * serialised; only a provider's constructor reads it, through `reveal`.
 */
export class ApiKey {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  [inspect.custom](): string {
    return '[redacted]';
  }
}

const apiKey = z.instanceof(ApiKey);

/**
 * One AI configuration (KTD25): a closed union of providers, each with pattern-checked names and
 * no field that takes a URL, so it can only ever reach the endpoints `provider-factory.ts` knows.
 * Objects are strict: an unknown field, such as a base URL, is refused rather than ignored.
 * `local` is the deterministic development adapter; it is never a tenant's configuration.
 */
export const providerConfigurationSchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('local'), model: aiModelSchema }),
  z.strictObject({ provider: z.literal('anthropic'), model: aiModelSchema, apiKey }),
  z.strictObject({ provider: z.literal('openai'), model: aiModelSchema, apiKey, residency: z.enum(openAiResidencies) }),
  z.strictObject({
    provider: z.literal('azure_openai'),
    model: aiModelSchema,
    apiKey,
    resourceName: azureResourceNameSchema,
    azureRegion: azureRegionSchema,
  }),
  z.strictObject({ provider: z.literal('mistral'), model: aiModelSchema, apiKey }),
]);

export type ProviderConfiguration = z.infer<typeof providerConfigurationSchema>;

export type ProviderName = ProviderConfiguration['provider'];

const canadianAzureRegions: ReadonlySet<string> = new Set(['canadacentral', 'canadaeast']);

/** Azure regions in EU member states. */
const euAzureRegions: ReadonlySet<string> = new Set([
  'austriaeast',
  'belgiumcentral',
  'francecentral',
  'francesouth',
  'germanynorth',
  'germanywestcentral',
  'italynorth',
  'northeurope',
  'polandcentral',
  'spaincentral',
  'swedencentral',
  'swedensouth',
  'westeurope',
]);

const usAzureRegions: ReadonlySet<string> = new Set([
  'centralus',
  'eastus',
  'eastus2',
  'northcentralus',
  'southcentralus',
  'westcentralus',
  'westus',
  'westus2',
  'westus3',
]);

export function azureProcessingRegion(azureRegion: string): AiProcessingRegion {
  if (canadianAzureRegions.has(azureRegion)) {
    return 'ca';
  }
  if (euAzureRegions.has(azureRegion)) {
    return 'eu';
  }
  return usAzureRegions.has(azureRegion) ? 'us' : 'other';
}

/**
 * Where a configuration's calls are processed. Anthropic's API processes in the US and
 * Mistral's in the EU; OpenAI's by its residency endpoint; Azure OpenAI in the resource's region.
 */
export function processingRegionOf(configuration: ProviderConfiguration): AiProcessingRegion {
  switch (configuration.provider) {
    case 'local':
      return 'local';
    case 'anthropic':
      return 'us';
    case 'openai':
      return configuration.residency;
    case 'azure_openai':
      return azureProcessingRegion(configuration.azureRegion);
    case 'mistral':
      return 'eu';
  }
}
