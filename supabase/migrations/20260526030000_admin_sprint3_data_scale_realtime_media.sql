-- Admin Sprint 3: data scale, scoped realtime support, and media expiry contracts.
--
-- Migration class: schema-only RPC/read-model hardening.
-- Intent: make the Reports read model truly pageable beyond the old 200-row
-- cap, expose deterministic total_count metadata, and ensure newly-added admin
-- job tables can drive scoped realtime invalidation when their panels are open.

CREATE INDEX IF NOT EXISTS idx_user_reports_admin_created_id
  ON public.user_reports (created_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_user_reports_admin_status_created_id
  ON public.user_reports (status, created_at DESC, id ASC);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_reply_delivery_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.account_deletion_completion_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.admin_get_reports_read_model(text, text, text, integer, text);

CREATE OR REPLACE FUNCTION public.admin_get_reports_read_model(
  p_status text DEFAULT 'all',
  p_sort_field text DEFAULT 'created_at',
  p_sort_direction text DEFAULT 'desc',
  p_limit integer DEFAULT 50,
  p_search text DEFAULT NULL,
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
  v_status text := lower(COALESCE(NULLIF(btrim(p_status), ''), 'all'));
  v_sort_field text := lower(COALESCE(NULLIF(btrim(p_sort_field), ''), 'created_at'));
  v_sort_direction text := lower(COALESCE(NULLIF(btrim(p_sort_direction), ''), 'desc'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_reports jsonb := '[]'::jsonb;
  v_total_count integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF v_status NOT IN ('all', 'pending', 'reviewed', 'action_taken', 'dismissed') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Report status filter is invalid.');
  END IF;

  IF v_sort_field NOT IN ('created_at', 'status') THEN
    v_sort_field := 'created_at';
  END IF;

  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    v_sort_direction := 'desc';
  END IF;

  WITH filtered AS (
    SELECT
      ur.id,
      ur.reporter_id,
      ur.reported_id,
      ur.reason,
      ur.details,
      ur.status,
      ur.created_at,
      jsonb_build_object(
        'id', reporter.id,
        'name', reporter.name,
        'avatar_url', reporter.avatar_url,
        'photos', reporter.photos
      ) AS reporter_profile,
      jsonb_build_object(
        'id', reported.id,
        'name', reported.name,
        'avatar_url', reported.avatar_url,
        'photos', reported.photos
      ) AS reported_profile
    FROM public.user_reports ur
    LEFT JOIN public.profiles reporter ON reporter.id = ur.reporter_id
    LEFT JOIN public.profiles reported ON reported.id = ur.reported_id
    WHERE (v_status = 'all' OR ur.status = v_status)
      AND (
        v_search IS NULL
        OR position(v_search in lower(COALESCE(reporter.name, ''))) > 0
        OR position(v_search in lower(COALESCE(reported.name, ''))) > 0
        OR position(v_search in lower(COALESCE(ur.reason::text, ''))) > 0
        OR position(v_search in lower(COALESCE(ur.details, ''))) > 0
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total_count FROM filtered
  ),
  ranked AS (
    SELECT
      filtered.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'asc' THEN filtered.status END ASC,
          CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'desc' THEN filtered.status END DESC,
          CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN filtered.created_at END ASC,
          CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'desc' THEN filtered.created_at END DESC,
          filtered.id ASC
      ) AS row_order
    FROM filtered
  ),
  page AS (
    SELECT *
    FROM ranked
    ORDER BY row_order
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT total_count FROM counted), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', page.id,
          'reporter_id', page.reporter_id,
          'reported_id', page.reported_id,
          'reason', page.reason,
          'details', page.details,
          'status', page.status,
          'created_at', page.created_at,
          'reporter_profile', page.reporter_profile,
          'reported_profile', page.reported_profile
        )
        ORDER BY page.row_order
      ),
      '[]'::jsonb
    )
  INTO v_total_count, v_reports
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'reports', v_reports,
    'limit', v_limit,
    'offset', v_offset,
    'total_count', v_total_count
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text, integer)
  TO authenticated;

COMMENT ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text, integer) IS
  'Admin-only paginated reports read model. Returns page rows plus limit, offset, and total_count for /kaan Reports.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260526030000',
  'Admin Sprint 3 data scale realtime media',
  'schema-only',
  'Adds non-unique indexes, updates an admin read-only reports RPC for pagination metadata, and expands realtime publication membership for admin job panels. No user data rewrite or destructive action.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
