CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"command" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_id_credential_id_command_key_key" UNIQUE("tenant_id","credential_id","command","key"),
	CONSTRAINT "idempotency_keys_key_check" CHECK ("idempotency_keys"."key" ~ '^[A-Za-z0-9_-]{16,128}$'),
	CONSTRAINT "idempotency_keys_command_check" CHECK ("idempotency_keys"."command" ~ '^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$'),
	CONSTRAINT "idempotency_keys_fingerprint_check" CHECK (octet_length("idempotency_keys"."fingerprint") = 32),
	CONSTRAINT "idempotency_keys_expiry_check" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at")
);
--> statement-breakpoint
DROP INDEX "credentials_tenant_id_index";--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_credential_fkey" FOREIGN KEY ("tenant_id","credential_id") REFERENCES "public"."credentials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_index" ON "idempotency_keys" USING btree ("tenant_id","expires_at");