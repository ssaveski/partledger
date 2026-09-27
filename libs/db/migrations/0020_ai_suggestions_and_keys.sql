CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_entity" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_field" text NOT NULL,
	"base_version" integer NOT NULL,
	"suggested_value" jsonb NOT NULL,
	"source_hash" "bytea" NOT NULL,
	"source_location" jsonb,
	"confidence" double precision NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"processing_region" text NOT NULL,
	"configuration_source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "ai_suggestions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_suggestions_tenant_id_request_key_key" UNIQUE("tenant_id","request_key"),
	CONSTRAINT "ai_suggestions_request_key_check" CHECK ("ai_suggestions"."request_key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'),
	CONSTRAINT "ai_suggestions_kind_check" CHECK (length("ai_suggestions"."kind") <= 100 and "ai_suggestions"."kind" ~ '^[a-z][a-zA-Z0-9]*([._:-][a-zA-Z0-9]+)*$'),
	CONSTRAINT "ai_suggestions_target_type_check" CHECK ("ai_suggestions"."target_type" in ('entity_field', 'import_mapping')),
	CONSTRAINT "ai_suggestions_target_entity_check" CHECK (length("ai_suggestions"."target_entity") <= 100 and "ai_suggestions"."target_entity" ~ '^[a-z][a-zA-Z0-9]*([._:-][a-zA-Z0-9]+)*$'),
	CONSTRAINT "ai_suggestions_target_field_check" CHECK (length("ai_suggestions"."target_field") <= 100 and "ai_suggestions"."target_field" ~ '^[a-z][a-zA-Z0-9]*([._:-][a-zA-Z0-9]+)*$'),
	CONSTRAINT "ai_suggestions_base_version_check" CHECK ("ai_suggestions"."base_version" >= 0),
	CONSTRAINT "ai_suggestions_source_hash_check" CHECK (octet_length("ai_suggestions"."source_hash") = 32),
	CONSTRAINT "ai_suggestions_source_location_check" CHECK ("ai_suggestions"."source_location" is null or jsonb_typeof("ai_suggestions"."source_location") = 'object'),
	CONSTRAINT "ai_suggestions_confidence_check" CHECK ("ai_suggestions"."confidence" between 0 and 1),
	CONSTRAINT "ai_suggestions_model_check" CHECK (length("ai_suggestions"."model") <= 100 and "ai_suggestions"."model" ~ '^[a-z][a-zA-Z0-9]*([._:-][a-zA-Z0-9]+)*$'),
	CONSTRAINT "ai_suggestions_provider_check" CHECK ("ai_suggestions"."provider" in ('anthropic', 'openai', 'azure_openai', 'mistral', 'local')),
	CONSTRAINT "ai_suggestions_processing_region_check" CHECK ("ai_suggestions"."processing_region" in ('ca', 'eu', 'us', 'other', 'local')),
	CONSTRAINT "ai_suggestions_configuration_source_check" CHECK ("ai_suggestions"."configuration_source" in ('tenant', 'platform')),
	CONSTRAINT "ai_suggestions_status_check" CHECK ("ai_suggestions"."status" in ('pending', 'accepted', 'rejected')),
	CONSTRAINT "ai_suggestions_decision_check" CHECK (("ai_suggestions"."status" = 'pending') = ("ai_suggestions"."decided_at" is null)
        and ("ai_suggestions"."decided_at" is null) = ("ai_suggestions"."decided_by" is null))
);
--> statement-breakpoint
CREATE TABLE "tenant_ai_keys" (
	"tenant_id" uuid NOT NULL,
	"key_reference" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"resource_name" text,
	"endpoint_region" text,
	"key_service_key_id" text NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"sealed_secret" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenant_ai_keys_pkey" PRIMARY KEY("tenant_id","key_reference"),
	CONSTRAINT "tenant_ai_keys_key_reference_check" CHECK ("tenant_ai_keys"."key_reference" ~ '^[a-z0-9][a-z0-9/_.:-]{0,199}$'),
	CONSTRAINT "tenant_ai_keys_provider_check" CHECK ("tenant_ai_keys"."provider" in ('anthropic', 'openai', 'azure_openai', 'mistral')),
	CONSTRAINT "tenant_ai_keys_model_check" CHECK (length("tenant_ai_keys"."model") <= 100 and "tenant_ai_keys"."model" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'),
	CONSTRAINT "tenant_ai_keys_resource_name_check" CHECK (("tenant_ai_keys"."provider" = 'azure_openai') = ("tenant_ai_keys"."resource_name" is not null)
        and ("tenant_ai_keys"."resource_name" is null or "tenant_ai_keys"."resource_name" ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')),
	CONSTRAINT "tenant_ai_keys_endpoint_region_check" CHECK (("tenant_ai_keys"."provider" in ('openai', 'azure_openai')) = ("tenant_ai_keys"."endpoint_region" is not null)
        and ("tenant_ai_keys"."endpoint_region" is null or "tenant_ai_keys"."endpoint_region" ~ '^[a-z][a-z0-9]{1,39}$')),
	CONSTRAINT "tenant_ai_keys_key_service_key_id_check" CHECK ("tenant_ai_keys"."key_service_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
	CONSTRAINT "tenant_ai_keys_wrapped_data_key_check" CHECK (octet_length("tenant_ai_keys"."wrapped_data_key") between 16 and 4096),
	CONSTRAINT "tenant_ai_keys_sealed_secret_check" CHECK (octet_length("tenant_ai_keys"."sealed_secret") between 29 and 8192)
);
--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ai_keys" ADD CONSTRAINT "tenant_ai_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_target_index" ON "ai_suggestions" USING btree ("tenant_id","target_entity","target_id","status");