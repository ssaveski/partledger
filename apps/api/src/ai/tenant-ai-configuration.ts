import { Inject, Injectable } from '@nestjs/common';
import type { AiProcessingRegion } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { failure, success, type Result } from '@partledger/domain';
import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '../db/tenant-transaction';
import { keyService, type KeyService } from '../keys/key-service.port';
import {
  ApiKey,
  processingRegionOf,
  providerConfigurationSchema,
  type ProviderConfiguration,
} from './provider-configuration';
import type { TenantAiRegion } from './region-policy';

const { tenantAiKeys, tenants } = schema;

/** The platform default configuration, or `null` when AI is switched off. */
export const platformAiConfiguration = Symbol('PlatformAiConfiguration');

export interface ResolvedAiConfiguration {
  readonly configuration: ProviderConfiguration;
  readonly source: 'tenant' | 'platform';
  readonly tenant: TenantAiRegion;
}

export type AiConfigurationFailure = 'disabled' | 'unavailable' | 'unknown_tenant';

/** A tenant's stored settings, without any key material. */
export interface StoredAiSettings {
  readonly tenant: TenantAiRegion;
  readonly provider: (typeof schema.tenants.$inferSelect)['aiProvider'];
  readonly key: {
    readonly model: string;
    readonly resourceName: string | null;
    readonly endpointRegion: string | null;
  } | null;
  readonly effective: {
    readonly source: 'tenant' | 'platform';
    readonly provider: string;
    readonly processingRegion: AiProcessingRegion;
  } | null;
}

export function encryptionContextOf(tenantId: string, reference: string) {
  return { purpose: 'tenantAiKey', tenantId, reference } as const;
}

type KeyRow = typeof tenantAiKeys.$inferSelect;

/** The tenant's configuration as the closed union expects it, before any field is checked. */
function candidateOf(row: KeyRow, apiKey: ApiKey): unknown {
  const base = { provider: row.provider, model: row.model, apiKey };
  switch (row.provider) {
    case 'openai':
      return { ...base, residency: row.endpointRegion };
    case 'azure_openai':
      return { ...base, resourceName: row.resourceName, azureRegion: row.endpointRegion };
    case 'anthropic':
    case 'mistral':
      return base;
  }
}

/**
 * Which configuration a tenant's AI calls use (R30, KTD25). The tenant's own configuration is
 * used only when it is complete: a stored key under the tenant's reference, of the tenant's
 * provider, that decrypts and passes the closed union as a whole. Otherwise the platform
 * default is used entirely; the two are never mixed field by field. Reads run in the caller's
 * tenant transaction; the key is decrypted only here, and only for the call being made.
 */
@Injectable()
export class AiConfigurations {
  constructor(
    @Inject(platformAiConfiguration) private readonly platform: ProviderConfiguration | null,
    @Inject(keyService) private readonly keys: KeyService,
  ) {}

  private async stored(database: AppDatabase, tenantId: string) {
    const [tenant] = await database
      .select({
        region: tenants.region,
        provider: tenants.aiProvider,
        keyReference: tenants.aiKeyReference,
        regionRestricted: tenants.aiRegionRestricted,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (tenant === undefined) {
      return undefined;
    }
    const [key] =
      tenant.keyReference === null
        ? []
        : await database
            .select()
            .from(tenantAiKeys)
            .where(and(eq(tenantAiKeys.tenantId, tenantId), eq(tenantAiKeys.keyReference, tenant.keyReference)));
    const usable = key !== undefined && key.provider === tenant.provider ? key : undefined;
    return { tenant, key: usable };
  }

  private platformResolution(tenant: TenantAiRegion): Result<ResolvedAiConfiguration, AiConfigurationFailure> {
    return this.platform === null
      ? failure('disabled')
      : success({ configuration: this.platform, source: 'platform', tenant });
  }

  async resolve(
    database: AppDatabase,
    tenantId: string,
  ): Promise<Result<ResolvedAiConfiguration, AiConfigurationFailure>> {
    const stored = await this.stored(database, tenantId);
    if (stored === undefined) {
      return failure('unknown_tenant');
    }
    const tenant: TenantAiRegion = { region: stored.tenant.region, regionRestricted: stored.tenant.regionRestricted };
    const { key } = stored;
    if (key === undefined || !providerConfigurationSchema.safeParse(candidateOf(key, new ApiKey(''))).success) {
      return this.platformResolution(tenant);
    }
    const decrypted = await this.keys.decrypt(
      { keyId: key.keyServiceKeyId, wrappedDataKey: key.wrappedDataKey, ciphertext: key.sealedSecret },
      encryptionContextOf(tenantId, key.keyReference),
    );
    if (!decrypted.ok) {
      // An outage must not quietly send the tenant's documents to the platform's provider instead.
      return decrypted.error === 'unavailable' ? failure('unavailable') : this.platformResolution(tenant);
    }
    const parsed = providerConfigurationSchema.safeParse(
      candidateOf(key, new ApiKey(decrypted.value.toString('utf8'))),
    );
    decrypted.value.fill(0);
    return parsed.success
      ? success({ configuration: parsed.data, source: 'tenant', tenant })
      : this.platformResolution(tenant);
  }

  /** The stored settings and which configuration calls would use, without decrypting anything. */
  async describe(database: AppDatabase, tenantId: string): Promise<StoredAiSettings | undefined> {
    const stored = await this.stored(database, tenantId);
    if (stored === undefined) {
      return undefined;
    }
    const tenant: TenantAiRegion = { region: stored.tenant.region, regionRestricted: stored.tenant.regionRestricted };
    const { key } = stored;
    const own = key === undefined ? undefined : providerConfigurationSchema.safeParse(candidateOf(key, new ApiKey('')));
    const effectiveConfiguration = own?.success === true ? own.data : this.platform;
    return {
      tenant,
      provider: stored.tenant.provider,
      key:
        key === undefined
          ? null
          : { model: key.model, resourceName: key.resourceName, endpointRegion: key.endpointRegion },
      effective:
        effectiveConfiguration === null
          ? null
          : {
              source: own?.success === true ? 'tenant' : 'platform',
              provider: effectiveConfiguration.provider,
              processingRegion: processingRegionOf(effectiveConfiguration),
            },
    };
  }
}
