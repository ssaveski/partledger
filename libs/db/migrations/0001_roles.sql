-- Roles and grants (KTD11, KTD37). Runs as pl_migrator, which owns the database and holds
-- CREATEROLE but not BYPASSRLS. Roles are cluster-wide, so creation is idempotent; login
-- passwords are set per environment by the operator and never live in this repository.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['pl_app', 'pl_portal', 'pl_ai_worker', 'pl_verifier', 'pl_backup'] LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
        runtime_role
      );
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pl_credential_resolver') THEN
    CREATE ROLE pl_credential_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  -- Temporary tables could shadow names inside a function; only the listed roles may connect.
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO pl_app, pl_portal, pl_ai_worker, pl_verifier, pl_backup',
    current_database()
  );
END
$$;

-- The migrator hands resolve_credential to the resolver role, which needs SET on it, but
-- never acts with the resolver's privileges implicitly.
GRANT pl_credential_resolver TO pl_migrator WITH INHERIT FALSE, SET TRUE;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pl_app, pl_portal, pl_ai_worker, pl_verifier, pl_backup, pl_credential_resolver;

ALTER DEFAULT PRIVILEGES FOR ROLE pl_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT SELECT ON public.tenants TO pl_app;
GRANT INSERT ON public.credentials TO pl_app;
GRANT SELECT ON public.credentials TO pl_credential_resolver;
GRANT SELECT ON public.tenants, public.credentials TO pl_backup;
