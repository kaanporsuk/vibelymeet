-- Admin final public interface closure: explicit role/session invalidation
-- events for fast admin-access revocation across web, mobile web, and native
-- shells that render the admin surface.

CREATE TABLE IF NOT EXISTS public.admin_session_invalidation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('role_granted', 'role_revoked', 'role_changed', 'session_invalidated')),
  role public.app_role,
  previous_role public.app_role,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_session_invalidation_events_user_created
  ON public.admin_session_invalidation_events(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_session_invalidation_events_created
  ON public.admin_session_invalidation_events(created_at DESC, id DESC);

ALTER TABLE public.admin_session_invalidation_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.admin_session_invalidation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_session_invalidation_events TO service_role;

DROP POLICY IF EXISTS admin_session_invalidation_events_service_role_all
  ON public.admin_session_invalidation_events;
CREATE POLICY admin_session_invalidation_events_service_role_all
  ON public.admin_session_invalidation_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS admin_session_invalidation_events_user_select_own
  ON public.admin_session_invalidation_events;
CREATE POLICY admin_session_invalidation_events_user_select_own
  ON public.admin_session_invalidation_events
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS admin_session_invalidation_events_admin_select
  ON public.admin_session_invalidation_events;
CREATE POLICY admin_session_invalidation_events_admin_select
  ON public.admin_session_invalidation_events
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.record_admin_session_invalidation_from_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_metadata jsonb := jsonb_build_object('source', 'user_roles_trigger', 'operation', TG_OP);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
      INSERT INTO public.admin_session_invalidation_events (
        user_id,
        event_type,
        role,
        previous_role,
        reason,
        metadata
      ) VALUES (
        NEW.user_id,
        'role_granted',
        NEW.role,
        NULL,
        'user_role_changed',
        v_metadata
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
      INSERT INTO public.admin_session_invalidation_events (
        user_id,
        event_type,
        role,
        previous_role,
        reason,
        metadata
      ) VALUES (
        OLD.user_id,
        'role_revoked',
        OLD.role,
        OLD.role,
        'user_role_changed',
        v_metadata
      );
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    IF NEW.role IN ('admin'::public.app_role, 'moderator'::public.app_role)
       OR OLD.role IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
      INSERT INTO public.admin_session_invalidation_events (
        user_id,
        event_type,
        role,
        previous_role,
        reason,
        metadata
      ) VALUES (
        NEW.user_id,
        'role_changed',
        NEW.role,
        OLD.role,
        'user_role_changed',
        v_metadata
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.role IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
    INSERT INTO public.admin_session_invalidation_events (
      user_id,
      event_type,
      role,
      previous_role,
      reason,
      metadata
    ) VALUES (
      OLD.user_id,
      'role_revoked',
      OLD.role,
      OLD.role,
      'user_role_changed',
      v_metadata || jsonb_build_object('moved_to_another_user', true)
    );
  END IF;

  IF NEW.role IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
    INSERT INTO public.admin_session_invalidation_events (
      user_id,
      event_type,
      role,
      previous_role,
      reason,
      metadata
    ) VALUES (
      NEW.user_id,
      'role_granted',
      NEW.role,
      NULL,
      'user_role_changed',
      v_metadata || jsonb_build_object('moved_from_another_user', true)
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_admin_session_invalidation_from_user_role
  ON public.user_roles;
CREATE TRIGGER trg_admin_session_invalidation_from_user_role
  AFTER INSERT OR UPDATE OR DELETE
  ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.record_admin_session_invalidation_from_user_role();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_session_invalidation_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

COMMENT ON TABLE public.admin_session_invalidation_events IS
  'Append-only role/session invalidation stream used by admin clients to refetch verify-admin immediately after role changes.';

COMMENT ON FUNCTION public.record_admin_session_invalidation_from_user_role() IS
  'Records session invalidation events whenever user_roles changes so admin access revocation does not wait for cache expiry.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260526040000',
  'Admin role session invalidation events',
  'schema+policy',
  'Adds an append-only invalidation event table, RLS policies, a user_roles trigger, and realtime publication membership. No user data rewrite or destructive action.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
