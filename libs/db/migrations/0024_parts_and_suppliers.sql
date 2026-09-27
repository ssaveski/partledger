CREATE TABLE "approved_supplier_entries" (
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text NOT NULL,
	"scope" text[] NOT NULL,
	"expires_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approved_supplier_entries_pkey" PRIMARY KEY("tenant_id","supplier_id"),
	CONSTRAINT "approved_supplier_entries_status_check" CHECK ("approved_supplier_entries"."status" in ('approved', 'conditional', 'suspended', 'notApproved')),
	CONSTRAINT "approved_supplier_entries_scope_check" CHECK ("approved_supplier_entries"."scope" <@ array['castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics']::text[]),
	CONSTRAINT "approved_supplier_entries_not_approved_check" CHECK ("approved_supplier_entries"."status" <> 'notApproved' or (cardinality("approved_supplier_entries"."scope") = 0 and "approved_supplier_entries"."expires_on" is null)),
	CONSTRAINT "approved_supplier_entries_active_scope_check" CHECK ("approved_supplier_entries"."status" not in ('approved', 'conditional') or cardinality("approved_supplier_entries"."scope") > 0),
	CONSTRAINT "approved_supplier_entries_version_check" CHECK ("approved_supplier_entries"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"part_number" text NOT NULL,
	"revision" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "parts_tenant_id_part_number_key" UNIQUE("tenant_id","part_number"),
	CONSTRAINT "parts_part_number_check" CHECK ("parts"."part_number" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
	CONSTRAINT "parts_revision_check" CHECK ("parts"."revision" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$'),
	CONSTRAINT "parts_description_check" CHECK (length("parts"."description") <= 500),
	CONSTRAINT "parts_category_check" CHECK ("parts"."category" in ('castings', 'machinedParts', 'fasteners', 'seals', 'sheetMetal', 'electronics')),
	CONSTRAINT "parts_unit_check" CHECK ("parts"."unit" in ('each', 'kilogram', 'metre')),
	CONSTRAINT "parts_source_check" CHECK ("parts"."source" in ('erp', 'platform')),
	CONSTRAINT "parts_version_check" CHECK ("parts"."version" >= 1),
	CONSTRAINT "parts_updated_check" CHECK ("parts"."updated_at" >= "parts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "supplier_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "supplier_contacts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_contacts_name_check" CHECK (length("supplier_contacts"."name") between 1 and 200),
	CONSTRAINT "supplier_contacts_email_check" CHECK ("supplier_contacts"."email" ~ '^[^@\s]{1,64}@[^@\s]{1,255}$' and "supplier_contacts"."email" = lower("supplier_contacts"."email")),
	CONSTRAINT "supplier_contacts_role_check" CHECK ("supplier_contacts"."role" in ('sales', 'quality', 'logistics', 'finance', 'other')),
	CONSTRAINT "supplier_contacts_removed_check" CHECK ("supplier_contacts"."removed_at" is null or "supplier_contacts"."removed_at" >= "supplier_contacts"."added_at")
);
--> statement-breakpoint
CREATE TABLE "supplier_identity_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"register" text NOT NULL,
	"identifier" text NOT NULL,
	"result" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supplier_identity_checks_register_check" CHECK ("supplier_identity_checks"."register" in ('vies', 'lei')),
	CONSTRAINT "supplier_identity_checks_identifier_check" CHECK ("supplier_identity_checks"."identifier" ~ '^[A-Z0-9+*]{4,20}$'),
	CONSTRAINT "supplier_identity_checks_result_check" CHECK ("supplier_identity_checks"."result" in ('verified', 'mismatch', 'notFound', 'notChecked'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"vat_id" text,
	"lei" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "suppliers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "suppliers_code_check" CHECK ("suppliers"."code" ~ '^[A-Z0-9-]{2,20}$'),
	CONSTRAINT "suppliers_name_check" CHECK (length("suppliers"."name") between 1 and 200),
	CONSTRAINT "suppliers_country_check" CHECK ("suppliers"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "suppliers_vat_id_check" CHECK ("suppliers"."vat_id" is null or "suppliers"."vat_id" ~ '^[A-Z]{2}[A-Z0-9+*]{2,12}$'),
	CONSTRAINT "suppliers_lei_check" CHECK ("suppliers"."lei" is null or "suppliers"."lei" ~ '^[A-Z0-9]{18}[0-9]{2}$'),
	CONSTRAINT "suppliers_status_check" CHECK ("suppliers"."status" in ('active', 'inactive')),
	CONSTRAINT "suppliers_source_check" CHECK ("suppliers"."source" in ('erp', 'platform')),
	CONSTRAINT "suppliers_version_check" CHECK ("suppliers"."version" >= 1),
	CONSTRAINT "suppliers_updated_check" CHECK ("suppliers"."updated_at" >= "suppliers"."created_at")
);
--> statement-breakpoint
ALTER TABLE "approved_supplier_entries" ADD CONSTRAINT "approved_supplier_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_supplier_entries" ADD CONSTRAINT "approved_supplier_entries_supplier_fkey" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_fkey" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_identity_checks" ADD CONSTRAINT "supplier_identity_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_identity_checks" ADD CONSTRAINT "supplier_identity_checks_supplier_fkey" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_contacts_current_email_key" ON "supplier_contacts" USING btree ("tenant_id","supplier_id","email") WHERE "supplier_contacts"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "supplier_identity_checks_latest_idx" ON "supplier_identity_checks" USING btree ("tenant_id","supplier_id","register","checked_at" DESC NULLS LAST);