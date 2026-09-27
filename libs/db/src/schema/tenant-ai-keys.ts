import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/** The providers a tenant can bring its own key for (KTD25); the platform default has no row here. */
export const tenantAiKeyProviders = ['anthropic', 'openai', 'azure_openai', 'mistral'] as const;

/**
 * A tenant's own AI provider configuration (R30, KTD25), named by `tenants.ai_key_reference`.
 * The API key is envelope-encrypted through the key service (KTD36): `sealed_secret` is the key
 * encrypted with a fresh data key, and `wrapped_data_key` is that data key wrapped by the key
 * service's key `key_service_key_id`. The plaintext key is never stored, logged or returned.
 * A new configuration is a new row under a new reference; rows are never changed.
 */
export const tenantAiKeys = pgTable(
  'tenant_ai_keys',
  {
    tenantId: tenantIdentifier(),
    keyReference: text('key_reference').notNull(),
    provider: text('provider', { enum: tenantAiKeyProviders }).notNull(),
    model: text('model').notNull(),
    /** The Azure OpenAI resource name; only for `azure_openai`. */
    resourceName: text('resource_name'),
    /**
     * Where the provider processes the calls: `us` or `eu` for OpenAI's regional endpoints, the
     * Azure region of an Azure OpenAI resource; null for providers with a single endpoint.
     */
    endpointRegion: text('endpoint_region'),
    keyServiceKeyId: text('key_service_key_id').notNull(),
    wrappedDataKey: bytea('wrapped_data_key').notNull(),
    sealedSecret: bytea('sealed_secret').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'tenant_ai_keys_pkey', columns: [table.tenantId, table.keyReference] }),
    foreignKey({ name: 'tenant_ai_keys_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    check('tenant_ai_keys_key_reference_check', sql`${table.keyReference} ~ '^[a-z0-9][a-z0-9/_.:-]{0,199}$'`),
    check(
      'tenant_ai_keys_provider_check',
      sql`${table.provider} in ('anthropic', 'openai', 'azure_openai', 'mistral')`,
    ),
    check(
      'tenant_ai_keys_model_check',
      sql`length(${table.model}) <= 100 and ${table.model} ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'`,
    ),
    check(
      'tenant_ai_keys_resource_name_check',
      sql`(${table.provider} = 'azure_openai') = (${table.resourceName} is not null)
        and (${table.resourceName} is null or ${table.resourceName} ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')`,
    ),
    check(
      'tenant_ai_keys_endpoint_region_check',
      sql`(${table.provider} in ('openai', 'azure_openai')) = (${table.endpointRegion} is not null)
        and (${table.endpointRegion} is null or ${table.endpointRegion} ~ '^[a-z][a-z0-9]{1,39}$')`,
    ),
    check(
      'tenant_ai_keys_key_service_key_id_check',
      sql`${table.keyServiceKeyId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'`,
    ),
    check('tenant_ai_keys_wrapped_data_key_check', sql`octet_length(${table.wrappedDataKey}) between 16 and 4096`),
    check('tenant_ai_keys_sealed_secret_check', sql`octet_length(${table.sealedSecret}) between 29 and 8192`),
  ],
);

export const tenantAiKeysAccess = defineTableAccess({
  table: 'tenant_ai_keys',
  tenantKey: 'tenant_id',
  grants: { pl_app: ['SELECT', 'INSERT'] },
});
