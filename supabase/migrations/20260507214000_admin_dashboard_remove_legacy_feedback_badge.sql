-- Admin dashboard badge counts: remove legacy feedback badge.
--
-- Migration class: schema-only RPC cleanup.
-- Intent: keep the current /kaan badge read model aligned with the governed
-- Support inbox and removed legacy Feedback tab. Public event discovery/RLS is
-- unchanged.

CREATE OR REPLACE FUNCTION public.admin_get_dashboard_badge_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_unread_notifications integer := 0;
  v_open_support_tickets integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_unread_notifications
  FROM public.admin_notifications
  WHERE read IS NOT TRUE;

  SELECT count(*)::integer
  INTO v_open_support_tickets
  FROM public.support_tickets
  WHERE status IN ('submitted', 'in_review');

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'unread_notifications', v_unread_notifications,
    'open_support_tickets', v_open_support_tickets
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_badge_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_badge_counts() TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507214000',
  'Admin dashboard badge counts remove legacy feedback',
  'schema-only',
  'Redefines the read-only /kaan badge RPC to remove the obsolete legacy feedback count after the Feedback tab was retired. No data rewrite or production mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_dashboard_badge_counts() IS
  'Read-only /kaan dashboard badge counts for unread admin notifications and admin-actionable support tickets.';
