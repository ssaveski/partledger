import { z } from 'zod';

import { apiBasePath } from '../define';
import { currencyCodeSchema } from '../money';

/**
 * A tenant's settings (R1, R9, R11, R30), the operator's provisioning request that creates a
 * tenant, and the global directory that sends a person to the tenant's region.
 */

/** Data-residency regions (R1); a tenant is pinned to one at creation and never moves. */
export const tenantRegions = ['ca', 'eu'] as const;

export const tenantRegionSchema = z.enum(tenantRegions).describe('The region the tenant is pinned to (R1).');

export type TenantRegion = z.infer<typeof tenantRegionSchema>;

/** Market packs a tenant can enable (R11). */
export const marketPacks = ['canada'] as const;

/** Who owns the approved-supplier list (R9): a read-only mirror of the ERP, or the platform. */
export const supplierListSources = ['erp', 'platform'] as const;

/** The closed set of AI providers (KTD25); `platform_default` uses the platform's configuration. */
export const aiProviders = ['platform_default', 'anthropic', 'openai', 'azure_openai', 'mistral'] as const;

export const tenantSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .describe(
    'The tenant’s short name in addresses, such as northwind-precision; lowercase letters, digits and hyphens.',
  );

export const tenantDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('The tenant’s name as people see it.');

export const tenantSettingsSchema = z
  .object({
    tenantId: z.uuid().describe('The tenant.'),
    slug: tenantSlugSchema,
    displayName: tenantDisplayNameSchema,
    region: tenantRegionSchema,
    enabledPacks: z.array(z.enum(marketPacks)).describe('The market packs whose evidence requirements apply.'),
    supplierListSource: z
      .enum(supplierListSources)
      .describe('Whether the ERP owns the approved-supplier list (a read-only mirror) or the platform does.'),
    baseCurrency: currencyCodeSchema,
  })
  .strict()
  .describe('The tenant’s settings that every member may read.');

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

const keyReferenceSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_.:-]{0,199}$/)
  .describe('The name of the tenant’s own key in the key service; never the key itself.');

export const aiPolicySchema = z
  .object({
    provider: z.enum(aiProviders).describe('The platform default, or the provider of the tenant’s own key.'),
    keyReference: keyReferenceSchema.nullable(),
    regionRestricted: z.boolean().describe('Whether AI calls must stay in the tenant’s region.'),
  })
  .strict()
  .refine((policy) => (policy.provider === 'platform_default') === (policy.keyReference === null), {
    path: ['keyReference'],
    message: 'A key reference is given exactly when the tenant brings its own provider.',
  })
  .describe('How the tenant’s AI suggestions are produced (R30).');

export const memberEmailSchema = z
  .email()
  .max(254)
  .toLowerCase()
  .describe('The person’s work email address; it becomes their sign-in name.');

export const memberDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('The person’s name as colleagues see it.');

/** The operator listener's routes (KTD30); reachable only from the operator network. */
export const operatorPaths = {
  /** POST: provision a tenant. The only operator action that needs no break-glass grant. */
  tenants: `${apiBasePath}/operator/tenants`,
} as const;

export const provisionTenantInputSchema = z
  .object({
    slug: tenantSlugSchema,
    displayName: tenantDisplayNameSchema,
    region: tenantRegionSchema,
    enabledPacks: z
      .array(z.enum(marketPacks))
      .max(marketPacks.length)
      .refine((packs) => new Set(packs).size === packs.length, 'Each pack is listed once.')
      .describe('The market packs to enable.'),
    supplierListSource: z.enum(supplierListSources).describe('Who owns the approved-supplier list.'),
    baseCurrency: currencyCodeSchema,
    aiPolicy: aiPolicySchema,
    firstAdmin: z
      .object({ email: memberEmailSchema, displayName: memberDisplayNameSchema })
      .strict()
      .describe('The tenant’s first administrator, invited with the tenant.'),
  })
  .strict()
  .describe('A new tenant, pinned to this region.');

export type ProvisionTenantInput = z.input<typeof provisionTenantInputSchema>;

export const provisionTenantOutputSchema = z
  .object({
    tenantId: z.uuid().describe('The new tenant.'),
    organizationId: z.string().min(1).describe('The tenant’s organization in the identity provider.'),
    firstAdminUserId: z.uuid().describe('The first administrator’s user id.'),
    enrolmentJobId: z.uuid().describe('The job that enrols the tenant in the scheduled jobs.'),
  })
  .strict()
  .describe('The provisioned tenant.');

export type ProvisionTenantOutput = z.infer<typeof provisionTenantOutputSchema>;

/** The global directory: which region serves a tenant, and nothing else. */
export function directoryPath(slug: string): string {
  return `${apiBasePath}/directory/${encodeURIComponent(slug)}`;
}

export const directoryEntrySchema = z
  .object({ regionUrl: z.url().describe('The staff app of the region that serves the tenant.') })
  .strict()
  .describe('Where a tenant’s people sign in.');

export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;
