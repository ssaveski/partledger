-- Tenants, memberships, roles and the directory (R1, R3, KTD11, KTD20).

-- Provisioning inserts a tenant in a transaction whose app.tenant_id is the new tenant's id, so
-- the tenant policy's check admits exactly that row.
GRANT INSERT ON public.tenants TO pl_app;

-- A tenant is pinned to its region at creation (R1); its id and slug never change either.
-- ENABLE ALWAYS keeps the guard firing under session_replication_role = replica.
CREATE FUNCTION pl_migration.keep_tenant_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.region IS DISTINCT FROM OLD.region OR NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'pl.tenants.identity_fixed: a tenant''s id, slug and region cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tenants_keep_identity BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION pl_migration.keep_tenant_identity();
ALTER TABLE public.tenants ENABLE ALWAYS TRIGGER tenants_keep_identity;

-- Memberships and role assignments are tenant-owned.
CALL pl_migration.enable_tenant_row_security('public.memberships');
CALL pl_migration.enable_tenant_row_security('public.role_assignments');

GRANT SELECT, INSERT ON public.memberships TO pl_app;
GRANT UPDATE (removed_at) ON public.memberships TO pl_app;
GRANT SELECT ON public.memberships TO pl_backup;
GRANT SELECT, INSERT, DELETE ON public.role_assignments TO pl_app;
GRANT SELECT ON public.role_assignments TO pl_backup;

-- A membership changes once, when the member is removed, and never after; its person and
-- tenant never change.
CREATE FUNCTION pl_migration.guard_membership_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.removed_at IS NOT NULL
     OR NEW.removed_at IS NULL
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
    RAISE EXCEPTION 'pl.tenants.membership_fixed: a membership only records its removal, once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- A person named by the audit chain, as its actor or anywhere in a payload, stays a row: the
-- chain's references must keep resolving. Row-level security applies inside the trigger, so it
-- sees the audit entries of the tenant whose membership is being deleted.
CREATE FUNCTION pl_migration.refuse_referenced_membership_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audit_entries entry
     WHERE entry.tenant_id = OLD.tenant_id
       AND (entry.actor_id = OLD.user_id::text
            OR pg_catalog.jsonb_path_exists(
                 entry.payload, '$.** ? (@ == $user)', pg_catalog.jsonb_build_object('user', OLD.user_id::text)))
  ) THEN
    RAISE EXCEPTION 'pl.tenants.member_referenced: a member named by audit entries cannot be deleted'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER memberships_guard_change BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION pl_migration.guard_membership_change();
CREATE TRIGGER memberships_refuse_referenced_delete BEFORE DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION pl_migration.refuse_referenced_membership_delete();
ALTER TABLE public.memberships ENABLE ALWAYS TRIGGER memberships_guard_change;
ALTER TABLE public.memberships ENABLE ALWAYS TRIGGER memberships_refuse_referenced_delete;

-- A removed member holds no role and can be granted none.
CREATE FUNCTION pl_migration.refuse_role_for_removed_member() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.tenant_id = NEW.tenant_id AND membership.user_id = NEW.user_id
       AND membership.removed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pl.tenants.member_removed: a removed member cannot hold a role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_assignments_refuse_removed_member BEFORE INSERT OR UPDATE ON public.role_assignments
  FOR EACH ROW EXECUTE FUNCTION pl_migration.refuse_role_for_removed_member();
ALTER TABLE public.role_assignments ENABLE ALWAYS TRIGGER role_assignments_refuse_removed_member;

-- The directory is global: it maps a slug to a region and holds nothing else, and it is read
-- before any tenant is known. Row-level security is still forced; its policies are exact.
ALTER TABLE public.directory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_entries_lookup ON public.directory_entries FOR SELECT TO pl_app USING (true);
-- Only the tenant of the provisioning transaction can be registered, with its own slug and region.
CREATE POLICY directory_entries_register ON public.directory_entries FOR INSERT TO pl_app
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenants
                       WHERE tenants.slug = directory_entries.slug AND tenants.region = directory_entries.region));
CREATE POLICY directory_entries_backup_read ON public.directory_entries FOR SELECT TO pl_backup USING (true);

GRANT SELECT, INSERT ON public.directory_entries TO pl_app;
GRANT SELECT ON public.directory_entries TO pl_backup;
