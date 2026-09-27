-- Notifications (U34, KTD33) are tenant-owned: forced row-level security with the tenant policy.
-- The app role records notifications and moves only their delivery state; it never deletes one.
CALL pl_migration.enable_tenant_row_security('public.notifications');
CALL pl_migration.enable_tenant_row_security('public.alert_recipients');

GRANT SELECT, INSERT ON public.notifications TO pl_app;
GRANT UPDATE (status, attempts, failure, sent_at, failed_at) ON public.notifications TO pl_app;
GRANT SELECT, INSERT ON public.alert_recipients TO pl_app;
GRANT UPDATE (removed_at) ON public.alert_recipients TO pl_app;
GRANT UPDATE (notified_at) ON public.operational_alerts TO pl_app;
GRANT SELECT ON public.notifications, public.alert_recipients TO pl_backup;

-- A sent or failed notification is final, so a redelivered send job can never send it again
-- or rewrite what happened. ENABLE ALWAYS keeps the guard firing under
-- session_replication_role = replica.
CREATE FUNCTION pl_migration.freeze_delivered_notification() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'pl.notifications.final: a sent or failed notification cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER notifications_freeze_delivered BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION pl_migration.freeze_delivered_notification();
ALTER TABLE public.notifications ENABLE ALWAYS TRIGGER notifications_freeze_delivered;

-- An operational alert is handed to its recipients once: its notified_at is set once and never
-- changes, and a removed alert recipient stays removed.
CREATE FUNCTION pl_migration.freeze_set_timestamp() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  column_name text := TG_ARGV[0];
BEGIN
  IF to_jsonb(OLD) ->> column_name IS NOT NULL THEN
    RAISE EXCEPTION 'pl.notifications.final: %.% is set once', TG_TABLE_NAME, column_name
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER operational_alerts_freeze_notified BEFORE UPDATE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION pl_migration.freeze_set_timestamp('notified_at');
ALTER TABLE public.operational_alerts ENABLE ALWAYS TRIGGER operational_alerts_freeze_notified;

CREATE TRIGGER alert_recipients_freeze_removed BEFORE UPDATE ON public.alert_recipients
  FOR EACH ROW EXECUTE FUNCTION pl_migration.freeze_set_timestamp('removed_at');
ALTER TABLE public.alert_recipients ENABLE ALWAYS TRIGGER alert_recipients_freeze_removed;
