CREATE TABLE "alert_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_address" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "alert_recipients_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "alert_recipients_email_address_check" CHECK (length("alert_recipients"."email_address") <= 254 and "alert_recipients"."email_address" = lower("alert_recipients"."email_address")
        and "alert_recipients"."email_address" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"alert_recipient_id" uuid,
	"params" jsonb NOT NULL,
	"operational_alert_id" uuid,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "notifications_alert_recipient_key" UNIQUE("tenant_id","operational_alert_id","channel","recipient_kind","recipient_id"),
	CONSTRAINT "notifications_channel_check" CHECK ("notifications"."channel" in ('email', 'inApp')),
	CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" ~ '^[a-z][a-zA-Z0-9]{0,99}$'),
	CONSTRAINT "notifications_recipient_kind_check" CHECK ("notifications"."recipient_kind" in ('person', 'supplierContact', 'alertRecipient', 'operator')),
	CONSTRAINT "notifications_alert_recipient_check" CHECK (("notifications"."recipient_kind" = 'alertRecipient') = ("notifications"."alert_recipient_id" is not null)
        and ("notifications"."alert_recipient_id" is null or "notifications"."alert_recipient_id" = "notifications"."recipient_id")),
	CONSTRAINT "notifications_operator_check" CHECK ("notifications"."recipient_kind" <> 'operator' or "notifications"."recipient_id" = '00000000-0000-4000-8000-00000000fa11'),
	CONSTRAINT "notifications_params_check" CHECK (jsonb_typeof("notifications"."params") = 'object'),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "notifications_attempts_check" CHECK ("notifications"."attempts" >= 0),
	CONSTRAINT "notifications_sent_check" CHECK (("notifications"."status" = 'sent') = ("notifications"."sent_at" is not null)),
	CONSTRAINT "notifications_failed_check" CHECK (("notifications"."status" = 'failed') = ("notifications"."failed_at" is not null)
        and ("notifications"."status" = 'failed') = ("notifications"."failure" is not null)),
	CONSTRAINT "notifications_failure_check" CHECK ("notifications"."failure" ~ '^[a-zA-Z][a-zA-Z0-9._]{0,99}$'),
	CONSTRAINT "notifications_in_app_check" CHECK ("notifications"."channel" <> 'inApp' or ("notifications"."recipient_kind" = 'person' and "notifications"."status" = 'sent'))
);
--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
-- Before the foreign key that references it.
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_operational_alert_fkey" FOREIGN KEY ("tenant_id","operational_alert_id") REFERENCES "public"."operational_alerts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_recipient_fkey" FOREIGN KEY ("tenant_id","alert_recipient_id") REFERENCES "public"."alert_recipients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_recipients_active_address_key" ON "alert_recipients" USING btree ("tenant_id","email_address") WHERE "alert_recipients"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_index" ON "notifications" USING btree ("tenant_id","recipient_kind","recipient_id","created_at");
