-- The one path to a credential before a tenant is known (KTD37): a SECURITY DEFINER
-- function with a pinned search_path that returns at most one row, by kind and id. It is
-- owned by pl_credential_resolver, which can read the credential table and nothing else.
CREATE POLICY credentials_resolver_read ON public.credentials FOR SELECT TO pl_credential_resolver USING (true);

CREATE FUNCTION public.resolve_credential(requested_kind text, requested_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  kind text,
  subject_id uuid,
  secret_hash bytea,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT credential.id, credential.tenant_id, credential.kind, credential.subject_id,
         credential.secret_hash, credential.expires_at, credential.revoked_at
    FROM public.credentials AS credential
   WHERE credential.kind = requested_kind
     AND credential.id = requested_id;
END;

REVOKE ALL ON FUNCTION public.resolve_credential(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_credential(text, uuid) TO pl_app, pl_portal;

-- A new owner needs CREATE on the schema only for the moment of the change.
GRANT CREATE ON SCHEMA public TO pl_credential_resolver;
ALTER FUNCTION public.resolve_credential(text, uuid) OWNER TO pl_credential_resolver;
REVOKE CREATE ON SCHEMA public FROM pl_credential_resolver;
