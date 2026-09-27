CREATE TABLE "staff_sessions" (
	"tenant_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"refresh_token_ciphertext" "bytea" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "staff_sessions_pkey" PRIMARY KEY("tenant_id","credential_id"),
	CONSTRAINT "staff_sessions_end_reason_check" CHECK ("staff_sessions"."end_reason" in ('signed_out', 'idle_timeout', 'refresh_failed', 'identity_changed', 'membership_removed')),
	CONSTRAINT "staff_sessions_ended_check" CHECK (("staff_sessions"."ended_at" is null) = ("staff_sessions"."end_reason" is null)),
	CONSTRAINT "staff_sessions_ciphertext_check" CHECK (octet_length("staff_sessions"."refresh_token_ciphertext") > 28)
);
--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_credential_fkey" FOREIGN KEY ("tenant_id","credential_id") REFERENCES "public"."credentials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_sessions_subject_index" ON "staff_sessions" USING btree ("tenant_id","subject_id");