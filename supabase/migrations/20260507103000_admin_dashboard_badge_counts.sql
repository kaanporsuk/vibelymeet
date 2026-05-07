-- Admin dashboard badge counts.
--
-- Migration class: read-only RPC.
-- Intent: keep /kaan sidebar/header badge counts behind backend admin authority
-- and remove browser-side HEAD count reads from hardened admin tables.

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
  v_new_feedback integer := 0;
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

  SELECT count(*)::integer
  INTO v_new_feedback
  FROM public.feedback
  WHERE status = 'new';

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'unread_notifications', v_unread_notifications,
    'open_support_tickets', v_open_support_tickets,
    'new_feedback', v_new_feedback
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_badge_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_badge_counts() TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507103000',
  'Admin dashboard badge counts',
  'schema-only',
  'Adds one read-only admin RPC for /kaan badge counts. No data rewrite or production mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_dashboard_badge_counts() IS
  'Read-only /kaan dashboard badge counts for unread admin notifications, open support tickets, and new legacy feedback.';
