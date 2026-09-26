CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"secret_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_kind_check" CHECK ("credentials"."kind" in ('staff_session', 'supplier_link', 'drop_credential', 'platform_operator')),
	CONSTRAINT "credentials_secret_hash_check" CHECK (octet_length("credentials"."secret_hash") = 32),
	CONSTRAINT "credentials_expiry_check" CHECK ("credentials"."expires_at" > "credentials"."created_at")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"region" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_check" CHECK ("tenants"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "tenants_region_check" CHECK ("tenants"."region" in ('ca', 'eu')),
	CONSTRAINT "tenants_display_name_check" CHECK (length("tenants"."display_name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_tenant_id_index" ON "credentials" USING btree ("tenant_id");