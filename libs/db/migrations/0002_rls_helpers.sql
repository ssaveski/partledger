-- Row-level security (KTD10, KTD11). Every table is ENABLEd and FORCEd, so the owner, and
-- with it cascading foreign-key actions, is bound by the policies too. The tenant policy has
-- no branch for an empty context: without `app.tenant_id` it matches nothing.
CREATE SCHEMA pl_migration;
REVOKE ALL ON SCHEMA pl_migration FROM PUBLIC;

-- Later migrations call this for every new tenant-owned table, so each gets the same policies.
CREATE PROCEDURE pl_migration.enable_tenant_row_security(target regclass, tenant_key name DEFAULT 'tenant_id')
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  table_name text := (SELECT relname FROM pg_catalog.pg_class WHERE oid = target);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY %I ON %s USING (%I = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (%I = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
    table_name || '_tenant_isolation', target, tenant_key, tenant_key
  );
  -- The one allowed read-all exception (KTD32): the nightly dump reads every tenant's rows.
  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO pl_backup USING (true)', table_name || '_backup_read', target);
END
$$;
REVOKE ALL ON PROCEDURE pl_migration.enable_tenant_row_security(regclass, name) FROM PUBLIC;

CALL pl_migration.enable_tenant_row_security('public.tenants', 'id');
CALL pl_migration.enable_tenant_row_security('public.credentials');
