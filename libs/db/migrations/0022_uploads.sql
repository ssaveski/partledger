CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"attestation" text NOT NULL,
	"uploader_type" text NOT NULL,
	"uploader_id" uuid,
	"credential_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"scan_status" text NOT NULL,
	"scan_finding" text,
	"scan_signature" text,
	"scanned_at" timestamp with time zone,
	CONSTRAINT "uploads_purpose_check" CHECK ("uploads"."purpose" in ('evidence', 'import')),
	CONSTRAINT "uploads_media_type_check" CHECK (("uploads"."purpose" = 'evidence' and "uploads"."media_type" in ('application/pdf', 'image/png', 'image/jpeg'))
        or ("uploads"."purpose" = 'import' and "uploads"."media_type" in
            ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'))),
	CONSTRAINT "uploads_file_name_check" CHECK (length("uploads"."file_name") between 1 and 255 and "uploads"."file_name" !~ '[/\\[:cntrl:]]'),
	CONSTRAINT "uploads_size_check" CHECK ("uploads"."size_bytes" > 0 and "uploads"."size_bytes" <= 20971520),
	CONSTRAINT "uploads_content_hash_check" CHECK ("uploads"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "uploads_attestation_check" CHECK ("uploads"."attestation" in ('noControlledTechnicalData.v1')),
	CONSTRAINT "uploads_uploader_type_check" CHECK ("uploads"."uploader_type" in ('person', 'supplier_token')),
	CONSTRAINT "uploads_scan_status_check" CHECK ("uploads"."scan_status" in ('pending', 'clean', 'flagged')),
	CONSTRAINT "uploads_scan_finding_check" CHECK (("uploads"."scan_status" = 'flagged') = ("uploads"."scan_finding" is not null)
        and ("uploads"."scan_finding" is null
             or "uploads"."scan_finding" in ('malware', 'scanLimitExceeded', 'pdfActiveContent', 'contentChanged'))),
	CONSTRAINT "uploads_scan_signature_check" CHECK ("uploads"."scan_signature" is null
        or ("uploads"."scan_status" = 'flagged' and "uploads"."scan_signature" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')),
	CONSTRAINT "uploads_scanned_check" CHECK (("uploads"."scan_status" = 'pending') = ("uploads"."scanned_at" is null))
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_credential_fkey" FOREIGN KEY ("tenant_id","credential_id") REFERENCES "public"."credentials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_credential_index" ON "uploads" USING btree ("tenant_id","credential_id");--> statement-breakpoint
CREATE INDEX "uploads_tenant_uploaded_index" ON "uploads" USING btree ("tenant_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "uploads_pending_index" ON "uploads" USING btree ("tenant_id","uploaded_at") WHERE "uploads"."scan_status" = 'pending';