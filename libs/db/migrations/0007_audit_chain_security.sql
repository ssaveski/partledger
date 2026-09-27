-- The audit chain and its commitment store (KTD11, KTD17). Both are tenant-owned with the
-- tenant policy, which also serves as the SELECT policy that INSERT ... RETURNING needs and as
-- the tenant-only policy for pl_portal and pl_ai_worker.
CALL pl_migration.enable_tenant_row_security('public.audit_entries');
CALL pl_migration.enable_tenant_row_security('public.commitments');

-- Guard triggers bind the owner too, because cascading foreign-key actions run as the owner.
-- ENABLE ALWAYS keeps them firing under session_replication_role = replica.
CREATE FUNCTION pl_migration.refuse_audit_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'pl.audit.insert_only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_entries_refuse_update_delete BEFORE UPDATE OR DELETE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION pl_migration.refuse_audit_change();
CREATE TRIGGER audit_entries_refuse_truncate BEFORE TRUNCATE ON public.audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION pl_migration.refuse_audit_change();
ALTER TABLE public.audit_entries ENABLE ALWAYS TRIGGER audit_entries_refuse_update_delete;
ALTER TABLE public.audit_entries ENABLE ALWAYS TRIGGER audit_entries_refuse_truncate;

-- The one change a commitment allows is its erasure (R39): salt and value cleared once, with
-- the time of erasure, and nothing else touched.
CREATE FUNCTION pl_migration.allow_commitment_erasure_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.erased_at IS NULL
     AND NEW.erased_at IS NOT NULL
     AND NEW.salt IS NULL
     AND NEW.value IS NULL
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.commitment = OLD.commitment
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'pl.audit.erase_only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER commitments_erase_only BEFORE UPDATE OR DELETE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION pl_migration.allow_commitment_erasure_only();
CREATE TRIGGER commitments_refuse_truncate BEFORE TRUNCATE ON public.commitments
  FOR EACH STATEMENT EXECUTE FUNCTION pl_migration.refuse_audit_change();
ALTER TABLE public.commitments ENABLE ALWAYS TRIGGER commitments_erase_only;
ALTER TABLE public.commitments ENABLE ALWAYS TRIGGER commitments_refuse_truncate;

-- The app appends and reads; the portal and the AI worker append and read the chain head only;
-- the verifier reads. Nobody but the owner holds UPDATE, DELETE or TRUNCATE.
GRANT SELECT, INSERT ON public.audit_entries TO pl_app;
GRANT INSERT ON public.audit_entries TO pl_portal, pl_ai_worker;
GRANT SELECT (tenant_id, seq, entry_hash, time) ON public.audit_entries TO pl_portal, pl_ai_worker;
GRANT SELECT ON public.audit_entries TO pl_verifier;
GRANT SELECT ON public.audit_entries TO pl_backup;

GRANT SELECT, INSERT ON public.commitments TO pl_app;
GRANT UPDATE (salt, value, erased_at) ON public.commitments TO pl_app;
GRANT INSERT ON public.commitments TO pl_portal, pl_ai_worker;
GRANT SELECT ON public.commitments TO pl_backup;
