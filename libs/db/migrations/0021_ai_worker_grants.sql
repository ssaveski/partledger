-- The AI layer (U11, R30, R31, KTD17, KTD25). Suggestions and tenant AI keys are tenant-owned:
-- forced row-level security with the tenant policy.
CALL pl_migration.enable_tenant_row_security('public.ai_suggestions');
CALL pl_migration.enable_tenant_row_security('public.tenant_ai_keys');

-- The AI worker only inserts suggestions (and appends their audit entries, granted in 0007); it
-- reads nothing of them and changes nothing anywhere. People decide suggestions through the app.
GRANT INSERT ON public.ai_suggestions TO pl_ai_worker;
GRANT SELECT ON public.ai_suggestions TO pl_app;
GRANT UPDATE (status, decided_at, decided_by) ON public.ai_suggestions TO pl_app;
GRANT SELECT ON public.ai_suggestions TO pl_backup;

-- A tenant's own key is stored sealed; a change of configuration inserts a new row.
GRANT SELECT, INSERT ON public.tenant_ai_keys TO pl_app;
GRANT SELECT ON public.tenant_ai_keys TO pl_backup;

-- A tenant admin changes the tenant's AI policy; the identity trigger keeps id, slug and region fixed.
GRANT UPDATE (ai_provider, ai_key_reference, ai_region_restricted) ON public.tenants TO pl_app;

-- A suggestion is stored pending, and is decided once: accepted or rejected, with who and when.
-- Nothing else about it ever changes. ENABLE ALWAYS keeps the guard firing under
-- session_replication_role = replica.
CREATE FUNCTION pl_migration.guard_suggestion_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'pl.ai.suggestion_pending_only: a suggestion is stored pending'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending'
     OR NEW.status NOT IN ('accepted', 'rejected')
     OR (to_jsonb(NEW) - ARRAY['status', 'decided_at', 'decided_by'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'decided_at', 'decided_by']) THEN
    RAISE EXCEPTION 'pl.ai.suggestion_decided_once: a suggestion is only decided, once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER ai_suggestions_guard_change BEFORE INSERT OR UPDATE ON public.ai_suggestions
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_suggestion_change();
ALTER TABLE public.ai_suggestions ENABLE ALWAYS TRIGGER ai_suggestions_guard_change;

-- A stored tenant key never changes: rotating it stores a new row under a new reference.
CREATE FUNCTION pl_migration.refuse_tenant_ai_key_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'pl.ai.key_fixed: a stored tenant AI key cannot change'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER tenant_ai_keys_refuse_update BEFORE UPDATE ON public.tenant_ai_keys
  FOR EACH ROW EXECUTE FUNCTION pl_migration.refuse_tenant_ai_key_change();
ALTER TABLE public.tenant_ai_keys ENABLE ALWAYS TRIGGER tenant_ai_keys_refuse_update;
