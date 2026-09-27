import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { generatedIdentifier, timestamptz } from './columns.ts';

/** Data-residency regions a tenant can be pinned to at creation (R1). */
export const tenantRegions = ['ca', 'eu'] as const;

/** Market packs a tenant can enable (R11); each pack's requirement matrix lives in `libs/packs`. */
export const marketPacks = ['canada'] as const;

/** Who owns the approved-supplier list (R9): a read-only mirror of the ERP, or the platform. */
export const supplierListSources = ['erp', 'platform'] as const;

/** The closed set of AI providers (KTD25); `platform_default` uses the platform's own configuration. */
export const aiProviders = ['platform_default', 'anthropic', 'openai', 'azure_openai', 'mistral'] as const;

/**
 * A tenant (R1, R9, R11, R30). Its region is fixed at creation: a trigger refuses any change
 * to it, to the id or to the slug, for every role. The AI key reference names a key held by
 * the key service (KTD36), never the key itself. The identity organization is the tenant's
 * Keycloak organization (KTD20), whose `tenant_id` attribute names this row.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: generatedIdentifier(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    region: text('region', { enum: tenantRegions }).notNull(),
    enabledPacks: text('enabled_packs', { enum: marketPacks })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    supplierListSource: text('supplier_list_source', { enum: supplierListSources }).notNull(),
    aiProvider: text('ai_provider', { enum: aiProviders }).notNull(),
    aiKeyReference: text('ai_key_reference'),
    aiRegionRestricted: boolean('ai_region_restricted').notNull(),
    baseCurrency: text('base_currency').notNull(),
    identityOrganizationId: text('identity_organization_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('tenants_slug_key').on(table.slug),
    check('tenants_slug_check', sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('tenants_region_check', sql`${table.region} in ('ca', 'eu')`),
    check('tenants_display_name_check', sql`length(${table.displayName}) between 1 and 200`),
    check('tenants_enabled_packs_check', sql`${table.enabledPacks} <@ array['canada']::text[]`),
    check('tenants_supplier_list_source_check', sql`${table.supplierListSource} in ('erp', 'platform')`),
    check(
      'tenants_ai_provider_check',
      sql`${table.aiProvider} in ('platform_default', 'anthropic', 'openai', 'azure_openai', 'mistral')`,
    ),
    check(
      'tenants_ai_key_reference_check',
      sql`(${table.aiProvider} = 'platform_default') = (${table.aiKeyReference} is null)
        and (${table.aiKeyReference} is null or ${table.aiKeyReference} ~ '^[a-z0-9][a-z0-9/_.:-]{0,199}$')`,
    ),
    check('tenants_base_currency_check', sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`),
    check(
      'tenants_identity_organization_id_check',
      sql`${table.identityOrganizationId} is null or ${table.identityOrganizationId} ~ '^[A-Za-z0-9-]{1,64}$'`,
    ),
  ],
);

export const tenantsAccess = defineTableAccess({
  table: 'tenants',
  tenantKey: 'id',
  // Provisioning inserts the new tenant in a transaction whose app.tenant_id is its id.
  grants: { pl_app: ['SELECT', 'INSERT'] },
});
