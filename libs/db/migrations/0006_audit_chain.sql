CREATE TABLE "audit_entries" (
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"prev_hash" "bytea" NOT NULL,
	"entry_hash" "bytea" NOT NULL,
	"canonical" "bytea" NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"acted_under" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"schema_version" smallint NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "audit_entries_pkey" PRIMARY KEY("tenant_id","seq"),
	CONSTRAINT "audit_entries_tenant_id_prev_hash_key" UNIQUE("tenant_id","prev_hash"),
	CONSTRAINT "audit_entries_seq_check" CHECK ("audit_entries"."seq" >= 1),
	CONSTRAINT "audit_entries_prev_hash_check" CHECK (octet_length("audit_entries"."prev_hash") = 32),
	CONSTRAINT "audit_entries_entry_hash_check" CHECK (octet_length("audit_entries"."entry_hash") = 32),
	CONSTRAINT "audit_entries_actor_type_check" CHECK ("audit_entries"."actor_type" in ('person', 'ai_agent', 'supplier_token', 'system', 'platform_operator')),
	CONSTRAINT "audit_entries_schema_version_check" CHECK ("audit_entries"."schema_version" = 1)
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"tenant_id" uuid NOT NULL,
	"commitment" "bytea" NOT NULL,
	"salt" "bytea",
	"value" text,
	"created_at" timestamp with time zone NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "commitments_pkey" PRIMARY KEY("tenant_id","commitment"),
	CONSTRAINT "commitments_commitment_check" CHECK (octet_length("commitments"."commitment") = 32),
	CONSTRAINT "commitments_salt_check" CHECK ("commitments"."salt" is null or octet_length("commitments"."salt") = 32),
	CONSTRAINT "commitments_erasure_check" CHECK (("commitments"."erased_at" is null and "commitments"."salt" is not null and "commitments"."value" is not null)
        or ("commitments"."erased_at" is not null and "commitments"."salt" is null and "commitments"."value" is null))
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;