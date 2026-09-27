import { z } from 'zod';

import { defineCommand, defineQuery } from '../define';
import { errorCode } from '../errors';
import { aiProviders } from '../tenants/tenants';
import {
  aiApiKeySchema,
  aiDisclosureSchema,
  aiModelSchema,
  aiProcessingRegionSchema,
  aiProviderSchema,
  azureRegionSchema,
  azureResourceNameSchema,
  openAiResidencies,
} from './providers';

/**
 * The AI layer's operations (R30, R31, KTD25, KTD40): a tenant admin chooses how the tenant's
 * suggestions are produced, and people accept or reject each suggestion. AI output reaches
 * records only through `ai.acceptSuggestion`, a person's command.
 */

/** A declared name, such as `imports.columnMapping` or `part`; the audit chain records it as is. */
const tokenSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-zA-Z0-9]*(?:[._:-][a-zA-Z0-9]+)*$/);

export const suggestionTargetTypes = ['entity_field', 'import_mapping'] as const;

export const suggestionStatuses = ['pending', 'accepted', 'rejected'] as const;

export const suggestionStatusSchema = z.enum(suggestionStatuses).describe('Whether a person has decided it yet.');

const suggestionIdSchema = z.uuid().describe('The suggestion.');

const nullableField = <Schema extends z.ZodType>(schema: Schema, description: string) =>
  schema.nullable().describe(description);

export const configureAiProviderCommand = defineCommand({
  name: 'ai.configureProvider',
  description:
    'Chooses how the tenant’s AI suggestions are produced: the platform default, or the tenant’s own provider key, and whether AI must stay in the tenant’s region. The key is stored encrypted and never returned.',
  purpose: 'administration',
  input: z
    .object({
      provider: aiProviderSchema,
      model: nullableField(aiModelSchema, 'The model or deployment; required for the tenant’s own provider.'),
      resourceName: nullableField(azureResourceNameSchema, 'Azure OpenAI only: the resource name.'),
      endpointRegion: nullableField(
        z.union([z.enum(openAiResidencies), azureRegionSchema]),
        'OpenAI: us or eu (its data-residency endpoint). Azure OpenAI: the resource’s Azure region.',
      ),
      apiKey: nullableField(aiApiKeySchema, 'The provider API key; required for the tenant’s own provider.'),
      regionRestricted: z.boolean().describe('Whether AI calls must stay in the tenant’s region.'),
    })
    .strict()
    .superRefine((input, context) => {
      const ownProvider = input.provider !== 'platform_default';
      const fields = [
        ['model', input.model, ownProvider],
        ['apiKey', input.apiKey, ownProvider],
        ['resourceName', input.resourceName, input.provider === 'azure_openai'],
        ['endpointRegion', input.endpointRegion, input.provider === 'openai' || input.provider === 'azure_openai'],
      ] as const;
      for (const [field, value, needed] of fields) {
        if ((value !== null) !== needed) {
          context.addIssue({ code: 'custom', path: [field], message: needed ? 'required' : 'not allowed' });
        }
      }
      const residency = input.endpointRegion;
      if (
        input.provider === 'openai' &&
        residency !== null &&
        !openAiResidencies.some((region) => region === residency)
      ) {
        context.addIssue({ code: 'custom', path: ['endpointRegion'], message: 'us or eu' });
      }
    })
    .describe('The tenant’s AI settings.'),
  output: z
    .object({
      provider: z.enum(aiProviders).describe('The provider now configured.'),
      regionRestricted: z.boolean().describe('Whether AI calls must stay in the tenant’s region.'),
    })
    .strict()
    .describe('The settings now in force; the key is never part of any response.'),
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('StepUpRequired', 'recentAuthentication'),
    errorCode('Unprocessable', 'aiRegionNotAllowed'),
    errorCode('Unavailable', 'dependencyUnavailable'),
  ],
  access: { person: ['tenant_admin'] },
  stepUp: true,
  impact: 'ai_key_change',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const aiSettingsSchema = z
  .object({
    provider: aiProviderSchema,
    model: nullableField(aiModelSchema, 'The tenant’s own model, if it brings its own provider.'),
    resourceName: nullableField(azureResourceNameSchema, 'Azure OpenAI only: the resource name.'),
    endpointRegion: nullableField(z.string(), 'OpenAI’s residency endpoint, or the Azure region.'),
    keyConfigured: z
      .boolean()
      .describe('Whether a key is stored for the tenant’s own provider; the key itself is never shown.'),
    regionRestricted: z.boolean().describe('Whether AI calls must stay in the tenant’s region.'),
    effective: z
      .object({
        source: z.enum(['tenant', 'platform']).describe('Whose configuration AI calls use now.'),
        provider: z.string().describe('The provider AI calls use now.'),
        processingRegion: aiProcessingRegionSchema,
        allowed: z.boolean().describe('Whether the region restriction allows calls with this configuration.'),
      })
      .strict()
      .nullable()
      .describe(
        'What AI calls use now: an incomplete own configuration falls back to the platform default entirely. Null when AI is switched off.',
      ),
  })
  .strict()
  .describe('The tenant’s AI settings, without any key.');

export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const aiSettingsQuery = defineQuery({
  name: 'ai.settings',
  description: 'The tenant’s AI settings and what AI calls use now; never any key.',
  input: z.object({}).strict().describe('No input.'),
  output: aiSettingsSchema,
  errors: [errorCode('Forbidden', 'notPermitted')],
  access: { person: ['tenant_admin'] },
});

export const suggestionSchema = z
  .object({
    suggestionId: suggestionIdSchema,
    kind: tokenSchema.describe('What is suggested, such as imports.columnMapping.'),
    target: z
      .object({
        type: z.enum(suggestionTargetTypes).describe('An entity field or an import mapping.'),
        entity: tokenSchema.describe('The kind of record, such as part or import.'),
        id: z.uuid().describe('The record.'),
        field: tokenSchema.describe('The field or column the value is for.'),
      })
      .strict()
      .describe('What accepting the suggestion would change.'),
    baseVersion: z.number().int().min(0).describe('The record’s version when the suggestion was made.'),
    value: z.json().describe('The suggested value.'),
    sourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('SHA-256 of the document the value was read from.'),
    sourceLocation: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .nullable()
      .describe('Where in the document the value was found, such as a page or a cell.'),
    confidence: z.number().min(0).max(1).describe('The model’s confidence, from 0 to 1.'),
    model: z.string().describe('The model that produced it.'),
    provider: z.string().describe('The provider that ran the model.'),
    processingRegion: aiProcessingRegionSchema,
    status: suggestionStatusSchema,
    createdAt: z.iso.datetime().describe('When it was suggested.'),
    decidedAt: z.iso.datetime().nullable().describe('When a person accepted or rejected it.'),
    disclosure: aiDisclosureSchema,
  })
  .strict()
  .describe('One AI suggestion, labelled as AI-generated.');

export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestionsQuery = defineQuery({
  name: 'ai.suggestions',
  description: 'The AI suggestions for one record, newest first.',
  input: z
    .object({
      targetEntity: tokenSchema.describe('The kind of record, such as part or import.'),
      targetId: z.uuid().describe('The record.'),
    })
    .strict()
    .describe('Which record.'),
  output: z
    .object({ suggestions: z.array(suggestionSchema).max(200).describe('Newest first.') })
    .strict()
    .describe('The record’s suggestions.'),
  errors: [errorCode('Forbidden', 'notPermitted'), errorCode('NotFound', 'resource')],
  access: { person: ['buyer', 'quality_engineer'] },
});

const decisionOutputSchema = z
  .object({ suggestionId: suggestionIdSchema, status: suggestionStatusSchema })
  .strict()
  .describe('The decided suggestion.');

export const acceptSuggestionCommand = defineCommand({
  name: 'ai.acceptSuggestion',
  description:
    'Accepts an AI suggestion and applies its value to the record, if the record has not changed since the suggestion was made.',
  purpose: 'business',
  input: z.object({ suggestionId: suggestionIdSchema }).strict().describe('The suggestion to accept.'),
  output: decisionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Conflict', 'transitionNotAllowed'),
  ],
  access: { person: ['buyer', 'quality_engineer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const rejectSuggestionCommand = defineCommand({
  name: 'ai.rejectSuggestion',
  description: 'Rejects an AI suggestion; the record is left as it is.',
  purpose: 'business',
  input: z.object({ suggestionId: suggestionIdSchema }).strict().describe('The suggestion to reject.'),
  output: decisionOutputSchema,
  errors: [
    errorCode('Forbidden', 'notPermitted'),
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'transitionNotAllowed'),
  ],
  access: { person: ['buyer', 'quality_engineer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});
