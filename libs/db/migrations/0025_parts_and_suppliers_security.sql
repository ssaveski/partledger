-- Parts, suppliers, contacts, identity checks and the approved-supplier list (U10, R9, R10) are
-- tenant-owned: forced row-level security with the tenant policy. The app role never deletes
-- one: parts and suppliers are deactivated, contacts removed by time, identity checks only
-- added, and an approval taken off the list becomes notApproved.
CALL pl_migration.enable_tenant_row_security('public.parts');
CALL pl_migration.enable_tenant_row_security('public.suppliers');
CALL pl_migration.enable_tenant_row_security('public.supplier_contacts');
CALL pl_migration.enable_tenant_row_security('public.supplier_identity_checks');
CALL pl_migration.enable_tenant_row_security('public.approved_supplier_entries');

-- Tenant, id, source and creation time get no UPDATE grant, so they never change.
GRANT SELECT, INSERT ON public.parts TO pl_app;
GRANT UPDATE (part_number, revision, description, category, unit, active, version, updated_at)
  ON public.parts TO pl_app;
GRANT SELECT, INSERT ON public.suppliers TO pl_app;
GRANT UPDATE (code, name, country, vat_id, lei, status, version, updated_at) ON public.suppliers TO pl_app;
GRANT SELECT, INSERT ON public.supplier_contacts TO pl_app;
GRANT UPDATE (removed_at) ON public.supplier_contacts TO pl_app;
GRANT SELECT, INSERT ON public.supplier_identity_checks TO pl_app;
GRANT SELECT, INSERT ON public.approved_supplier_entries TO pl_app;
GRANT UPDATE (status, scope, expires_on, version, updated_at) ON public.approved_supplier_entries TO pl_app;

GRANT SELECT ON public.parts, public.suppliers, public.supplier_contacts, public.supplier_identity_checks,
  public.approved_supplier_entries TO pl_backup;

-- A removed contact stays removed: links sent to it are revoked for good (KTD21).
CREATE TRIGGER supplier_contacts_freeze_removed BEFORE UPDATE ON public.supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION pl_migration.freeze_set_timestamp('removed_at');
ALTER TABLE public.supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_freeze_removed;

-- Every change to a part, supplier or approval moves its version on by exactly one, so a
-- change that names a stale version can never land on top of another (R33).
CREATE FUNCTION pl_migration.advance_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'pl.masterData.version: %.version must move from % to %', TG_TABLE_NAME, OLD.version, OLD.version + 1
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER parts_advance_version BEFORE UPDATE ON public.parts
  FOR EACH ROW EXECUTE FUNCTION pl_migration.advance_version();
ALTER TABLE public.parts ENABLE ALWAYS TRIGGER parts_advance_version;
CREATE TRIGGER suppliers_advance_version BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION pl_migration.advance_version();
ALTER TABLE public.suppliers ENABLE ALWAYS TRIGGER suppliers_advance_version;
CREATE TRIGGER approved_supplier_entries_advance_version BEFORE UPDATE ON public.approved_supplier_entries
  FOR EACH ROW EXECUTE FUNCTION pl_migration.advance_version();
ALTER TABLE public.approved_supplier_entries ENABLE ALWAYS TRIGGER approved_supplier_entries_advance_version;

-- ERP ownership (R9) is enforced here as well as in the commands. Rows sourced from the ERP,
-- their ERP-owned columns, and an approved-supplier list mirrored from the ERP change only in a
-- transaction that declares itself the ERP import:
--
--   select set_config('app.master_data_writer', 'erp_import', true);
--
-- Only the import path (apps/api/src/imports/, U12 and U13) may set it, transaction-locally,
-- and a unit test (apps/api/src/master-data-writer.spec.ts) refuses it anywhere else in
-- application code; test fixtures standing in for the import may set it too. Everything else is refused with insufficient_privilege (42501).
CREATE FUNCTION pl_migration.guard_erp_owned_part() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('app.master_data_writer', true) IS NOT DISTINCT FROM 'erp_import' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'erp' THEN
      RAISE EXCEPTION 'pl.masterData.erpOwned: only the ERP import adds parts from the ERP'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.source = 'erp' AND (
         NEW.part_number IS DISTINCT FROM OLD.part_number
      OR NEW.revision IS DISTINCT FROM OLD.revision
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.active IS DISTINCT FROM OLD.active) THEN
    RAISE EXCEPTION 'pl.masterData.erpOwned: the ERP owns this part''s number, revision, description, unit and status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION pl_migration.guard_erp_owned_supplier() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('app.master_data_writer', true) IS NOT DISTINCT FROM 'erp_import' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'erp' THEN
      RAISE EXCEPTION 'pl.masterData.erpOwned: only the ERP import adds suppliers from the ERP'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.source = 'erp' AND (
         NEW.code IS DISTINCT FROM OLD.code
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.country IS DISTINCT FROM OLD.country
      OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'pl.masterData.erpOwned: the ERP owns this supplier''s code, name, country and status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- Row-level security applies inside the trigger, so it reads the writing tenant's own row.
CREATE FUNCTION pl_migration.guard_erp_owned_approved_list() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('app.master_data_writer', true) IS NOT DISTINCT FROM 'erp_import' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants tenant
              WHERE tenant.id = NEW.tenant_id AND tenant.supplier_list_source = 'erp') THEN
    RAISE EXCEPTION 'pl.masterData.erpOwned: this tenant''s approved-supplier list mirrors its ERP'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER parts_guard_erp_owned BEFORE INSERT OR UPDATE ON public.parts
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_erp_owned_part();
ALTER TABLE public.parts ENABLE ALWAYS TRIGGER parts_guard_erp_owned;
CREATE TRIGGER suppliers_guard_erp_owned BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_erp_owned_supplier();
ALTER TABLE public.suppliers ENABLE ALWAYS TRIGGER suppliers_guard_erp_owned;
CREATE TRIGGER approved_supplier_entries_guard_erp_owned BEFORE INSERT OR UPDATE ON public.approved_supplier_entries
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_erp_owned_approved_list();
ALTER TABLE public.approved_supplier_entries ENABLE ALWAYS TRIGGER approved_supplier_entries_guard_erp_owned;
