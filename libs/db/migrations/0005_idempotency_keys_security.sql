-- Idempotency keys are tenant-owned (KTD11, KTD14): forced row-level security with the
-- tenant policy, and the app role may record a result, take over an expired key and purge
-- expired keys.
CALL pl_migration.enable_tenant_row_security('public.idempotency_keys');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.idempotency_keys TO pl_app;
GRANT SELECT ON public.idempotency_keys TO pl_backup;
