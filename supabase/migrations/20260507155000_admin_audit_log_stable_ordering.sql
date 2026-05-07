-- Keep the Admin Activity Log RPC ordering deterministic for paged incident review.

CREATE OR REPLACE FUNCTION public.admin_search_admin_audit_logs(
  p_actor_id uuid DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'audit.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Audit read permission is required.');
  END IF;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  )
  SELECT count(*)::integer INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  ),
  page AS (
    SELECT
      al.id,
      al.admin_id,
      admin_profile.name AS admin_name,
      al.action_type,
      al.target_type,
      al.target_id,
      al.details,
      al.created_at
    FROM filtered al
    LEFT JOIN public.profiles admin_profile ON admin_profile.id = al.admin_id
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'scope', 'admin_activity_logs',
    'incident_usage', 'Use action_type, target_type, target_id, actor, and date filters to reconstruct production-impacting admin actions.'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'P3 read-only admin audit explorer with permission-checked filters and deterministic pagination ordering.';
