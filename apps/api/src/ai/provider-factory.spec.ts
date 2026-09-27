import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EgressNetwork } from './egress-allowlist';
import { ApiKey, processingRegionOf, providerConfigurationSchema } from './provider-configuration';
import { createModel } from './provider-factory';
import { platformConfigurationOf } from './platform-configuration';
import { structuredCall } from './structured-call';

const syntheticKey = 'sk-synthetic-provider-key-0001';

/** Records every request and answers each with a server error; nothing leaves the process. */
function recordingNetwork(): EgressNetwork & { readonly requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    resolve: () => Promise.resolve([{ address: '160.79.104.10', family: 4 }]),
    fetch: (input) => {
      requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response('{}', { status: 400 }));
    },
  };
}

const configurations = {
  anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: new ApiKey(syntheticKey) },
  openaiEu: { provider: 'openai', model: 'gpt-4o', apiKey: new ApiKey(syntheticKey), residency: 'eu' },
  openaiUs: { provider: 'openai', model: 'gpt-4o', apiKey: new ApiKey(syntheticKey), residency: 'us' },
  azure: {
    provider: 'azure_openai',
    model: 'synthetic-deployment',
    apiKey: new ApiKey(syntheticKey),
    resourceName: 'synthetic-resource',
    azureRegion: 'canadaeast',
  },
  mistral: { provider: 'mistral', model: 'mistral-large-latest', apiKey: new ApiKey(syntheticKey) },
} as const;

async function firstRequestOf(configuration: unknown): Promise<string | undefined> {
  const network = recordingNetwork();
  const model = createModel(configuration, { network });
  if (!model.ok) {
    throw new Error('The configuration was refused');
  }
  await structuredCall({
    model: model.value,
    schema: z.object({ value: z.string().nullable() }),
    instructions: 'Read the synthetic document.',
    document: 'Synthetic document',
    timeoutMilliseconds: 5_000,
  });
  return network.requests[0];
}

describe('the AI provider factory', () => {
  it('rejects a bare model-id string, which the AI SDK would route through a gateway', () => {
    const bare: unknown = 'anthropic/claude-sonnet-4-5';
    expect(createModel(bare, { network: recordingNetwork() })).toEqual({ ok: false, error: 'invalid_configuration' });
    expect(createModel('gpt-4o', { network: recordingNetwork() }).ok).toBe(false);
  });

  it('refuses a configuration with a free-form base URL', () => {
    const withBaseUrl = { ...configurations.openaiEu, baseURL: 'http://169.254.169.254/latest' };
    expect(createModel(withBaseUrl, { network: recordingNetwork() }).ok).toBe(false);
    expect(
      providerConfigurationSchema.safeParse({ ...configurations.anthropic, baseUrl: 'https://proxy.example' }).success,
    ).toBe(false);
  });

  it('refuses an Azure resource name outside the pattern', () => {
    for (const resourceName of ['evil.example.com/x', 'x', 'Synthetic-Resource', 'resource-', '169.254.169.254']) {
      expect(createModel({ ...configurations.azure, resourceName }, { network: recordingNetwork() }).ok).toBe(false);
    }
  });

  it('refuses a model name that is not a lowercase model id, and a provider outside the closed union', () => {
    expect(
      createModel({ ...configurations.anthropic, model: 'Claude Sonnet' }, { network: recordingNetwork() }).ok,
    ).toBe(false);
    expect(createModel({ ...configurations.anthropic, provider: 'gateway' }, { network: recordingNetwork() }).ok).toBe(
      false,
    );
  });

  it('refuses a partial configuration instead of completing it', () => {
    const withoutKey = { provider: 'mistral', model: 'mistral-large-latest' };
    expect(createModel(withoutKey, { network: recordingNetwork() }).ok).toBe(false);
    const withoutResource = { ...configurations.azure, resourceName: undefined };
    expect(createModel(withoutResource, { network: recordingNetwork() }).ok).toBe(false);
  });

  it('builds a new model for every call', () => {
    const network = recordingNetwork();
    const first = createModel(configurations.anthropic, { network });
    const second = createModel(configurations.anthropic, { network });
    expect(first.ok && second.ok && first.value.model !== second.value.model).toBe(true);
  });

  it('sends each provider only to its fixed endpoint', async () => {
    expect(await firstRequestOf(configurations.anthropic)).toBe('https://api.anthropic.com/v1/messages');
    expect(await firstRequestOf(configurations.openaiEu)).toBe('https://eu.api.openai.com/v1/responses');
    expect(await firstRequestOf(configurations.openaiUs)).toBe('https://api.openai.com/v1/responses');
    expect(await firstRequestOf(configurations.mistral)).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(await firstRequestOf(configurations.azure)).toMatch(
      /^https:\/\/synthetic-resource\.openai\.azure\.com\/openai\/v1\/chat\/completions/,
    );
  });

  it('knows where each configuration processes its calls', () => {
    expect(processingRegionOf(configurations.anthropic)).toBe('us');
    expect(processingRegionOf(configurations.openaiEu)).toBe('eu');
    expect(processingRegionOf(configurations.azure)).toBe('ca');
    expect(processingRegionOf({ ...configurations.azure, azureRegion: 'swedencentral' })).toBe('eu');
    expect(processingRegionOf({ ...configurations.azure, azureRegion: 'japaneast' })).toBe('other');
    expect(processingRegionOf(configurations.mistral)).toBe('eu');
    expect(processingRegionOf({ provider: 'local', model: 'deterministic' })).toBe('local');
  });

  it('never shows an API key when a configuration is printed or serialised', () => {
    const shown = [
      String(configurations.anthropic.apiKey),
      JSON.stringify(configurations.anthropic),
      inspect(configurations.anthropic, { depth: 5 }),
      configurations.azure.apiKey.toString(),
    ];
    for (const text of shown) {
      expect(text).not.toContain(syntheticKey);
    }
    expect(configurations.anthropic.apiKey.reveal()).toBe(syntheticKey);
  });
});

describe('the platform default AI configuration', () => {
  it('defaults to the local model outside production and is off when set to none', () => {
    expect(platformConfigurationOf({})).toEqual({ provider: 'local', model: 'deterministic' });
    expect(platformConfigurationOf({ AI_PLATFORM_PROVIDER: 'none' })).toBeNull();
  });

  it('is parsed whole by the same closed union as a tenant configuration', () => {
    const azure = platformConfigurationOf({
      AI_PLATFORM_PROVIDER: 'azure_openai',
      AI_PLATFORM_MODEL: 'synthetic-deployment',
      AI_PLATFORM_API_KEY: syntheticKey,
      AI_PLATFORM_AZURE_RESOURCE_NAME: 'synthetic-resource',
      AI_PLATFORM_ENDPOINT_REGION: 'swedencentral',
    });
    expect(azure?.provider).toBe('azure_openai');
    expect(() =>
      platformConfigurationOf({
        AI_PLATFORM_PROVIDER: 'azure_openai',
        AI_PLATFORM_MODEL: 'synthetic-deployment',
        AI_PLATFORM_API_KEY: syntheticKey,
        AI_PLATFORM_AZURE_RESOURCE_NAME: 'resource.attacker.example',
        AI_PLATFORM_ENDPOINT_REGION: 'swedencentral',
      }),
    ).toThrow(/AI_PLATFORM_AZURE_RESOURCE_NAME/);
  });
});
