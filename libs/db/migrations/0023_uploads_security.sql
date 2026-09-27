-- Uploads (U14, KTD22, R12) are tenant-owned: forced row-level security with the tenant policy.
-- The app role records an upload once it has streamed into quarantine, and moves only the
-- scan's decision; it never deletes an upload.
CALL pl_migration.enable_tenant_row_security('public.uploads');

GRANT SELECT, INSERT ON public.uploads TO pl_app;
GRANT UPDATE (scan_status, scan_finding, scan_signature, scanned_at) ON public.uploads TO pl_app;
GRANT SELECT ON public.uploads TO pl_backup;

-- A scan decides once: a pending upload becomes clean or flagged and never changes again, so a
-- flagged file can never be released and a clean one never re-scanned into another state.
-- ENABLE ALWAYS keeps the guard firing under session_replication_role = replica.
CREATE FUNCTION pl_migration.guard_upload_scan() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.scan_status <> 'pending' OR NEW.scan_status = 'pending' THEN
    RAISE EXCEPTION 'pl.uploads.scan_final: an upload''s scan decides once, from pending'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER uploads_guard_scan BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_upload_scan();
ALTER TABLE public.uploads ENABLE ALWAYS TRIGGER uploads_guard_scan;
