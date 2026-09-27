ALTER TABLE "staff_sessions" DROP CONSTRAINT "staff_sessions_end_reason_check";--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD COLUMN "authentication_level" text;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD COLUMN "authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_authentication_level_check" CHECK ("staff_sessions"."authentication_level" ~ '^[A-Za-z0-9._:-]{1,64}$');--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_end_reason_check" CHECK ("staff_sessions"."end_reason" in ('signed_out', 'idle_timeout', 'refresh_failed', 'identity_changed', 'membership_removed', 'second_factor_reset'));