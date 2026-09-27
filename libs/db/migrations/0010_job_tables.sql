CREATE TABLE "job_item_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job" text NOT NULL,
	"item_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"failure" text,
	"last_job_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_item_outcomes_tenant_id_job_item_key_key" UNIQUE("tenant_id","job","item_key"),
	CONSTRAINT "job_item_outcomes_job_check" CHECK ("job_item_outcomes"."job" ~ '^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$'),
	CONSTRAINT "job_item_outcomes_item_key_check" CHECK ("job_item_outcomes"."item_key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'),
	CONSTRAINT "job_item_outcomes_status_check" CHECK ("job_item_outcomes"."status" in ('done', 'failed')),
	CONSTRAINT "job_item_outcomes_attempts_check" CHECK ("job_item_outcomes"."attempts" >= 1),
	CONSTRAINT "job_item_outcomes_failure_check" CHECK (("job_item_outcomes"."status" = 'done' and "job_item_outcomes"."failure" is null)
        or ("job_item_outcomes"."status" = 'failed' and "job_item_outcomes"."failure" ~ '^[a-zA-Z][a-zA-Z0-9._]{0,99}$'))
);
--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"params" jsonb NOT NULL,
	"raised_by_job_id" uuid,
	"raised_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operational_alerts_tenant_id_kind_key_key" UNIQUE("tenant_id","kind","key"),
	CONSTRAINT "operational_alerts_kind_check" CHECK ("operational_alerts"."kind" ~ '^[a-z][a-zA-Z0-9]{0,99}$'),
	CONSTRAINT "operational_alerts_key_check" CHECK ("operational_alerts"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'),
	CONSTRAINT "operational_alerts_params_check" CHECK (jsonb_typeof("operational_alerts"."params") = 'object')
);
--> statement-breakpoint
ALTER TABLE "job_item_outcomes" ADD CONSTRAINT "job_item_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_item_outcomes_status_index" ON "job_item_outcomes" USING btree ("tenant_id","job","status");