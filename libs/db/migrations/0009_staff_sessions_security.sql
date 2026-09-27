-- Staff sessions are tenant-owned (KTD11, KTD20): forced row-level security with the tenant
-- policy. The app role starts sessions and may change only a session's moving parts (its
-- encrypted refresh token, last activity, last refresh and its end); it never deletes one.
CALL pl_migration.enable_tenant_row_security('public.staff_sessions');

GRANT SELECT, INSERT ON public.staff_sessions TO pl_app;
GRANT UPDATE (refresh_token_ciphertext, last_seen_at, refreshed_at, ended_at, end_reason) ON public.staff_sessions TO pl_app;
GRANT SELECT ON public.staff_sessions TO pl_backup;

-- An ended session is final: once ended_at is set, no update may touch the row, so a session
-- that was signed out, timed out or refused at refresh can never be reopened. ENABLE ALWAYS
-- keeps the guard firing under session_replication_role = replica.
CREATE FUNCTION pl_migration.freeze_ended_staff_session() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'pl.auth.session_ended: an ended staff session cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER staff_sessions_freeze_ended BEFORE UPDATE ON public.staff_sessions
  FOR EACH ROW EXECUTE FUNCTION pl_migration.freeze_ended_staff_session();
ALTER TABLE public.staff_sessions ENABLE ALWAYS TRIGGER staff_sessions_freeze_ended;
