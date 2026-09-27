import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { defineTableAccess } from '../table-access.ts';
import { bytea, generatedIdentifier, tenantIdentifier, timestamptz } from './columns.ts';
import { tenants } from './tenants.ts';

/** What a suggestion would change (KTD40): a field of an entity, or one column of an import's mapping. */
export const suggestionTargetTypes = ['entity_field', 'import_mapping'] as const;

export const suggestionStatuses = ['pending', 'accepted', 'rejected'] as const;

/** Where the model processed the call; `local` is the deterministic development adapter. */
export const aiProcessingRegions = ['ca', 'eu', 'us', 'other', 'local'] as const;

/** Whether the tenant's own configuration or the platform default produced a suggestion. */
export const aiConfigurationSources = ['tenant', 'platform'] as const;

/** Tokens as the audit chain accepts them: `kind`, target entity and field, and model are declared names. */
const tokenCheck = (column: unknown) =>
  sql`length(${column}) <= 100 and ${column} ~ '^[a-z][a-zA-Z0-9]*([._:-][a-zA-Z0-9]+)*$'`;

/**
 * AI output as people see it (R31, KTD40). The AI worker (`pl_ai_worker`) can only insert
 * pending suggestions; a person's command accepts or rejects one, once, after re-checking that
 * the target is still at `base_version`. Nothing else about a suggestion ever changes (guard
 * trigger), and nothing is applied without that command.
 */
export const aiSuggestions = pgTable(
  'ai_suggestions',
  {
    id: generatedIdentifier(),
    tenantId: tenantIdentifier(),
    /** The producing job's key for this suggestion, so a redelivered job never stores it twice. */
    requestKey: text('request_key').notNull(),
    /** What the suggestion is, such as `imports.columnMapping` or `evidence.expiryDate`. */
    kind: text('kind').notNull(),
    targetType: text('target_type', { enum: suggestionTargetTypes }).notNull(),
    targetEntity: text('target_entity').notNull(),
    targetId: uuid('target_id').notNull(),
    targetField: text('target_field').notNull(),
    /** The target's version the suggestion was made against; accepting re-checks it. */
    baseVersion: integer('base_version').notNull(),
    suggestedValue: jsonb('suggested_value').notNull(),
    /** SHA-256 of the source document the model read. */
    sourceHash: bytea('source_hash').notNull(),
    /** Where in the source the value was found, such as a page or a cell. */
    sourceLocation: jsonb('source_location'),
    confidence: doublePrecision('confidence').notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    processingRegion: text('processing_region', { enum: aiProcessingRegions }).notNull(),
    configurationSource: text('configuration_source', { enum: aiConfigurationSources }).notNull(),
    status: text('status', { enum: suggestionStatuses }).notNull().default('pending'),
    createdAt: timestamptz('created_at').notNull(),
    decidedAt: timestamptz('decided_at'),
    /** The person who accepted or rejected it. */
    decidedBy: uuid('decided_by'),
  },
  (table) => [
    foreignKey({ name: 'ai_suggestions_tenant_id_fkey', columns: [table.tenantId], foreignColumns: [tenants.id] }),
    // The target of composite foreign keys from later units (KTD11).
    unique('ai_suggestions_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ai_suggestions_tenant_id_request_key_key').on(table.tenantId, table.requestKey),
    index('ai_suggestions_target_index').on(table.tenantId, table.targetEntity, table.targetId, table.status),
    check('ai_suggestions_request_key_check', sql`${table.requestKey} ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'`),
    check('ai_suggestions_kind_check', tokenCheck(table.kind)),
    check('ai_suggestions_target_type_check', sql`${table.targetType} in ('entity_field', 'import_mapping')`),
    check('ai_suggestions_target_entity_check', tokenCheck(table.targetEntity)),
    check('ai_suggestions_target_field_check', tokenCheck(table.targetField)),
    check('ai_suggestions_base_version_check', sql`${table.baseVersion} >= 0`),
    check('ai_suggestions_source_hash_check', sql`octet_length(${table.sourceHash}) = 32`),
    check(
      'ai_suggestions_source_location_check',
      sql`${table.sourceLocation} is null or jsonb_typeof(${table.sourceLocation}) = 'object'`,
    ),
    check('ai_suggestions_confidence_check', sql`${table.confidence} between 0 and 1`),
    check('ai_suggestions_model_check', tokenCheck(table.model)),
    check(
      'ai_suggestions_provider_check',
      sql`${table.provider} in ('anthropic', 'openai', 'azure_openai', 'mistral', 'local')`,
    ),
    check(
      'ai_suggestions_processing_region_check',
      sql`${table.processingRegion} in ('ca', 'eu', 'us', 'other', 'local')`,
    ),
    check('ai_suggestions_configuration_source_check', sql`${table.configurationSource} in ('tenant', 'platform')`),
    check('ai_suggestions_status_check', sql`${table.status} in ('pending', 'accepted', 'rejected')`),
    check(
      'ai_suggestions_decision_check',
      sql`(${table.status} = 'pending') = (${table.decidedAt} is null)
        and (${table.decidedAt} is null) = (${table.decidedBy} is null)`,
    ),
  ],
);

export const aiSuggestionsAccess = defineTableAccess({
  table: 'ai_suggestions',
  tenantKey: 'tenant_id',
  // Only the AI worker stores suggestions; people decide them through the app, once (guard trigger).
  grants: { pl_app: ['SELECT'], pl_ai_worker: ['INSERT'] },
  columnGrants: { pl_app: { status: ['UPDATE'], decided_at: ['UPDATE'], decided_by: ['UPDATE'] } },
});
