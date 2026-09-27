import { z } from 'zod';

import { aiProviders } from '../tenants/tenants';

/**
 * The AI layer's closed vocabulary (R30, KTD25): which providers a tenant can bring its own key
 * for, how their resources and models are named, and where each processes calls. Names are
 * pattern-checked and no field takes a URL, so a tenant's settings can only ever reach the
 * provider endpoints the API knows.
 */

/** Providers a tenant can bring its own key for; `platform_default` uses the platform's configuration. */
export const tenantAiProviders = ['anthropic', 'openai', 'azure_openai', 'mistral'] as const;

export type TenantAiProvider = (typeof tenantAiProviders)[number];

/** Where a model processes calls; `local` is the deterministic development adapter, which sends nothing. */
export const aiProcessingRegions = ['ca', 'eu', 'us', 'other', 'local'] as const;

export type AiProcessingRegion = (typeof aiProcessingRegions)[number];

/** A provider's model id or Azure deployment name: lowercase, as the audit chain records it. */
export const aiModelSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/)
  .describe('The model id, or the Azure OpenAI deployment name, such as claude-sonnet-4-5; lowercase.');

/** An Azure OpenAI resource name; the API reaches it only as `<name>.openai.azure.com`. */
export const azureResourceNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)
  .describe('The Azure OpenAI resource name, never a URL; the API calls <name>.openai.azure.com.');

/** An Azure region name, such as canadacentral or swedencentral. */
export const azureRegionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{1,39}$/)
  .describe('The Azure region the resource was created in, such as canadacentral.');

/** OpenAI's two data-residency endpoints. */
export const openAiResidencies = ['us', 'eu'] as const;

export const aiApiKeySchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[\x21-\x7e]+$/)
  .describe('The provider API key. It is stored encrypted and never returned, logged or shown again.');

export const aiProviderSchema = z
  .enum(aiProviders)
  .describe('The platform default, or the provider of the tenant’s own key.');

export const aiProcessingRegionSchema = z
  .enum(aiProcessingRegions)
  .describe('Where the model processes calls: ca, eu, us, other, or local for the development adapter.');

/**
 * How a supplier-facing or staff-facing read marks AI-generated content (CLAUDE.md, AI Act
 * Art. 50): every such value carries this, and the screens show its message.
 */
export const aiDisclosureMessageKey = 'pl.ai.disclosure.generated';

export const aiDisclosureSchema = z
  .object({
    generatedBy: z.literal('ai').describe('The content was produced by an AI model.'),
    messageKey: z.literal(aiDisclosureMessageKey).describe('The notice every screen shows beside the content.'),
  })
  .strict()
  .describe('Marks AI-generated content, which every screen labels as such.');

export type AiDisclosure = z.infer<typeof aiDisclosureSchema>;

export const aiDisclosure: AiDisclosure = { generatedBy: 'ai', messageKey: aiDisclosureMessageKey };
