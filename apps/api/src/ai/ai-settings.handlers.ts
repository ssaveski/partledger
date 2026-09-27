import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { aiSettingsQuery, configureAiProviderCommand, type InputOf } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { refuse, success } from '@partledger/domain';
import { eq } from 'drizzle-orm';

import { auditId, auditToken } from '../audit/audit-payload';
import type {
  CommandContext,
  CommandHandler,
  HandlerResult,
  OperationContext,
  QueryHandler,
} from '../commands/handlers';
import { keyService, type KeyService } from '../keys/key-service.port';
import {
  ApiKey,
  processingRegionOf,
  providerConfigurationSchema,
  type ProviderConfiguration,
} from './provider-configuration';
import { checkRegionPolicy } from './region-policy';
import { AiConfigurations, encryptionContextOf, platformAiConfiguration } from './tenant-ai-configuration';

const { tenantAiKeys, tenants } = schema;

type ConfigureInput = InputOf<typeof configureAiProviderCommand>;

/** The tenant's own configuration from the command's input, parsed whole by the closed union. */
function ownConfigurationOf(input: ConfigureInput): ProviderConfiguration | null {
  if (input.provider === 'platform_default' || input.apiKey === null) {
    return null;
  }
  const base = { provider: input.provider, model: input.model, apiKey: new ApiKey(input.apiKey) };
  const candidate =
    input.provider === 'openai'
      ? { ...base, residency: input.endpointRegion }
      : input.provider === 'azure_openai'
        ? { ...base, resourceName: input.resourceName, azureRegion: input.endpointRegion }
        : base;
  const parsed = providerConfigurationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * A tenant admin chooses the tenant's AI configuration (R30, KTD20's AI-key change, so it needs
 * a recent step-up). A tenant's own key is envelope-encrypted through the key service before
 * it is stored, under a new reference; it is never returned, logged or put in the audit chain.
 * A configuration the tenant's region restriction would refuse is refused here already.
 */
@Injectable()
export class ConfigureAiProviderHandler implements CommandHandler<typeof configureAiProviderCommand> {
  constructor(
    @Inject(keyService) private readonly keys: KeyService,
    @Inject(platformAiConfiguration) private readonly platform: ProviderConfiguration | null,
  ) {}

  async execute(
    input: ConfigureInput,
    { principal, database, now, audit }: CommandContext,
  ): Promise<HandlerResult<typeof configureAiProviderCommand>> {
    const { tenantId } = principal;
    const [tenant] = await database.select({ region: tenants.region }).from(tenants).where(eq(tenants.id, tenantId));
    if (tenant === undefined) {
      return refuse('Forbidden', 'notPermitted');
    }
    const restriction = { region: tenant.region, regionRestricted: input.regionRestricted };
    const own = ownConfigurationOf(input);
    const effective = input.provider === 'platform_default' ? this.platform : own;
    if (input.provider !== 'platform_default' && own === null) {
      throw new Error('The contract admitted an AI configuration the closed provider union refuses');
    }
    if (effective !== null) {
      const allowed = checkRegionPolicy(restriction, processingRegionOf(effective));
      if (!allowed.ok) {
        return allowed;
      }
    }

    let keyId: string | null = null;
    if (own !== null && own.provider !== 'local') {
      keyId = randomUUID();
      const reference = `ai-key/${keyId}`;
      const sealed = await this.keys.encrypt(
        Buffer.from(own.apiKey.reveal(), 'utf8'),
        encryptionContextOf(tenantId, reference),
      );
      if (!sealed.ok) {
        return refuse('Unavailable', 'dependencyUnavailable');
      }
      await database.insert(tenantAiKeys).values({
        tenantId,
        keyReference: reference,
        provider: own.provider,
        model: own.model,
        resourceName: own.provider === 'azure_openai' ? own.resourceName : null,
        endpointRegion:
          own.provider === 'openai' ? own.residency : own.provider === 'azure_openai' ? own.azureRegion : null,
        keyServiceKeyId: sealed.value.keyId,
        wrappedDataKey: sealed.value.wrappedDataKey,
        sealedSecret: sealed.value.ciphertext,
        createdAt: now,
      });
      await database
        .update(tenants)
        .set({ aiProvider: input.provider, aiKeyReference: reference, aiRegionRestricted: input.regionRestricted })
        .where(eq(tenants.id, tenantId));
    } else {
      await database
        .update(tenants)
        .set({ aiProvider: 'platform_default', aiKeyReference: null, aiRegionRestricted: input.regionRestricted })
        .where(eq(tenants.id, tenantId));
    }

    audit.record({
      provider: auditToken(input.provider),
      key: keyId === null ? null : auditId(keyId),
      model: own === null ? null : auditToken(own.model),
      resourceName: own?.provider === 'azure_openai' ? await audit.commit(own.resourceName) : null,
      endpointRegion: input.endpointRegion === null ? null : auditToken(input.endpointRegion),
      regionRestricted: input.regionRestricted,
    });
    return success({ provider: input.provider, regionRestricted: input.regionRestricted });
  }
}

@Injectable()
export class AiSettingsHandler implements QueryHandler<typeof aiSettingsQuery> {
  constructor(@Inject(AiConfigurations) private readonly configurations: AiConfigurations) {}

  async execute(
    _input: InputOf<typeof aiSettingsQuery>,
    { principal, database }: OperationContext,
  ): Promise<HandlerResult<typeof aiSettingsQuery>> {
    const settings = await this.configurations.describe(database, principal.tenantId);
    if (settings === undefined) {
      return refuse('Forbidden', 'notPermitted');
    }
    const { effective } = settings;
    return success({
      provider: settings.provider,
      model: settings.key?.model ?? null,
      resourceName: settings.key?.resourceName ?? null,
      endpointRegion: settings.key?.endpointRegion ?? null,
      keyConfigured: settings.key !== null,
      regionRestricted: settings.tenant.regionRestricted,
      effective:
        effective === null
          ? null
          : { ...effective, allowed: checkRegionPolicy(settings.tenant, effective.processingRegion).ok },
    });
  }
}
