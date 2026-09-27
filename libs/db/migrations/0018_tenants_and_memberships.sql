CREATE TABLE "directory_entries" (
	"slug" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	CONSTRAINT "directory_entries_slug_check" CHECK ("directory_entries"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "directory_entries_region_check" CHECK ("directory_entries"."region" in ('ca', 'eu'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "memberships_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_email_check" CHECK ("memberships"."email" ~ '^[^@\s]{1,64}@[^@\s]{1,255}$' and "memberships"."email" = lower("memberships"."email")),
	CONSTRAINT "memberships_display_name_check" CHECK (length("memberships"."display_name") between 1 and 200),
	CONSTRAINT "memberships_removed_check" CHECK ("memberships"."removed_at" is null or "memberships"."removed_at" >= "memberships"."invited_at")
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_assignments_pkey" PRIMARY KEY("tenant_id","membership_id","role"),
	CONSTRAINT "role_assignments_role_check" CHECK ("role_assignments"."role" in ('tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "enabled_packs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "supplier_list_source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_key_reference" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_region_restricted" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "base_currency" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "identity_organization_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_membership_fkey" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships" USING btree ("tenant_id","user_id") WHERE "memberships"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_id_email_key" ON "memberships" USING btree ("tenant_id","email") WHERE "memberships"."removed_at" is null;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_enabled_packs_check" CHECK ("tenants"."enabled_packs" <@ array['canada']::text[]);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_supplier_list_source_check" CHECK ("tenants"."supplier_list_source" in ('erp', 'platform'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ai_provider_check" CHECK ("tenants"."ai_provider" in ('platform_default', 'anthropic', 'openai', 'azure_openai', 'mistral'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ai_key_reference_check" CHECK (("tenants"."ai_provider" = 'platform_default') = ("tenants"."ai_key_reference" is null)
        and ("tenants"."ai_key_reference" is null or "tenants"."ai_key_reference" ~ '^[a-z0-9][a-z0-9/_.:-]{0,199}$'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_base_currency_check" CHECK ("tenants"."base_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_identity_organization_id_check" CHECK ("tenants"."identity_organization_id" is null or "tenants"."identity_organization_id" ~ '^[A-Za-z0-9-]{1,64}$');