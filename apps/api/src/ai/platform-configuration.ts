import { InvalidConfigurationError, type AppConfig } from '../config/env.schema';
import { ApiKey, providerConfigurationSchema, type ProviderConfiguration } from './provider-configuration';

export type PlatformAiSettings = Pick<
  AppConfig,
  | 'AI_PLATFORM_PROVIDER'
  | 'AI_PLATFORM_MODEL'
  | 'AI_PLATFORM_API_KEY'
  | 'AI_PLATFORM_AZURE_RESOURCE_NAME'
  | 'AI_PLATFORM_ENDPOINT_REGION'
>;

/** The local adapter's model name when none is configured. */
export const localModelId = 'deterministic';

const settingsByField: Readonly<Record<string, keyof PlatformAiSettings>> = {
  model: 'AI_PLATFORM_MODEL',
  apiKey: 'AI_PLATFORM_API_KEY',
  resourceName: 'AI_PLATFORM_AZURE_RESOURCE_NAME',
  residency: 'AI_PLATFORM_ENDPOINT_REGION',
  azureRegion: 'AI_PLATFORM_ENDPOINT_REGION',
};

function settingOf(field: string): string {
  return settingsByField[field] ?? 'AI_PLATFORM_PROVIDER';
}

/**
 * The platform default AI configuration (R30), parsed whole at boot with the same closed union
 * as a tenant's own, so it passes the same name checks. `null` when AI is switched off.
 */
export function platformConfigurationOf(settings: PlatformAiSettings): ProviderConfiguration | null {
  const provider = settings.AI_PLATFORM_PROVIDER ?? 'local';
  if (provider === 'none') {
    return null;
  }
  const model = settings.AI_PLATFORM_MODEL;
  const apiKey = settings.AI_PLATFORM_API_KEY === undefined ? undefined : new ApiKey(settings.AI_PLATFORM_API_KEY);
  const candidate =
    provider === 'local'
      ? { provider, model: model ?? localModelId }
      : provider === 'openai'
        ? { provider, model, apiKey, residency: settings.AI_PLATFORM_ENDPOINT_REGION }
        : provider === 'azure_openai'
          ? {
              provider,
              model,
              apiKey,
              resourceName: settings.AI_PLATFORM_AZURE_RESOURCE_NAME,
              azureRegion: settings.AI_PLATFORM_ENDPOINT_REGION,
            }
          : { provider, model, apiKey };
  const parsed = providerConfigurationSchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => settingOf(String(issue.path[0])));
    throw new InvalidConfigurationError(fields, `the platform AI configuration is invalid: ${fields.join(', ')}`);
  }
  return parsed.data;
}
