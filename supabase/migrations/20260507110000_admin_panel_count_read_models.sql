-- Admin panel count read models.
--
-- Migration class: read-only RPCs.
-- Intent: remove browser-side HEAD count reads from /kaan admin panels while
-- keeping existing UI semantics intact.

CREATE OR REPLACE FUNCTION public.admin_get_photo_verification_counts(
  p_today_start timestamptz DEFAULT date_trunc('day', now())
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_today_start timestamptz := COALESCE(p_today_start, date_trunc('day', now()));
  v_pending integer := 0;
  v_approved_today integer := 0;
  v_rejected_today integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_pending
  FROM public.photo_verifications
  WHERE status = 'pending';

  SELECT count(*)::integer
  INTO v_approved_today
  FROM public.photo_verifications
  WHERE status = 'approved'
    AND reviewed_at >= v_today_start;

  SELECT count(*)::integer
  INTO v_rejected_today
  FROM public.photo_verifications
  WHERE status = 'rejected'
    AND reviewed_at >= v_today_start;

  RETURN public.admin_json_success(jsonb_build_object(
    'pending', v_pending,
    'approved_today', v_approved_today,
    'rejected_today', v_rejected_today,
    'today_start', v_today_start
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_reports_summary_counts(
  p_week_start timestamptz,
  p_month_start timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_week_start timestamptz := COALESCE(p_week_start, date_trunc('week', now()));
  v_month_start timestamptz := COALESCE(p_month_start, now() - interval '30 days');
  v_open_reports integer := 0;
  v_reports_this_week integer := 0;
  v_suspended integer := 0;
  v_banned_this_month integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_open_reports
  FROM public.user_reports
  WHERE status = 'pending';

  SELECT count(*)::integer
  INTO v_reports_this_week
  FROM public.user_reports
  WHERE created_at >= v_week_start;

  SELECT count(*)::integer
  INTO v_suspended
  FROM public.user_suspensions
  WHERE status = 'active';

  SELECT count(*)::integer
  INTO v_banned_this_month
  FROM public.user_suspensions
  WHERE expires_at IS NULL
    AND suspended_at >= v_month_start;

  RETURN public.admin_json_success(jsonb_build_object(
    'open_reports', v_open_reports,
    'reports_this_week', v_reports_this_week,
    'suspended', v_suspended,
    'banned_this_month', v_banned_this_month,
    'week_start', v_week_start,
    'month_start', v_month_start
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_estimate_push_campaign_reach(
  p_segment jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_segment jsonb := COALESCE(p_segment, '{}'::jsonb);
  v_gender_values text[];
  v_has_gender boolean := false;
  v_has_verified boolean := false;
  v_is_verified boolean := NULL;
  v_has_age boolean := false;
  v_min_age numeric := NULL;
  v_max_age numeric := NULL;
  v_reach integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF jsonb_typeof(v_segment -> 'gender') = 'array' THEN
    SELECT array_agg(gender_value)
    INTO v_gender_values
    FROM (
      SELECT btrim(item.value #>> '{}') AS gender_value
      FROM jsonb_array_elements(v_segment -> 'gender') AS item(value)
      WHERE jsonb_typeof(item.value) = 'string'
        AND btrim(item.value #>> '{}') <> ''
    ) genders;

    v_has_gender := COALESCE(array_length(v_gender_values, 1), 0) > 0;
  END IF;

  IF jsonb_typeof(v_segment -> 'isVerified') = 'boolean' THEN
    v_has_verified := true;
    v_is_verified := (v_segment ->> 'isVerified')::boolean;
  END IF;

  IF jsonb_typeof(v_segment -> 'ageRange') = 'array' THEN
    IF jsonb_array_length(v_segment -> 'ageRange') >= 2
      AND jsonb_typeof((v_segment -> 'ageRange') -> 0) = 'number'
      AND jsonb_typeof((v_segment -> 'ageRange') -> 1) = 'number'
    THEN
      v_min_age := LEAST(
        ((v_segment -> 'ageRange') ->> 0)::numeric,
        ((v_segment -> 'ageRange') ->> 1)::numeric
      );
      v_max_age := GREATEST(
        ((v_segment -> 'ageRange') ->> 0)::numeric,
        ((v_segment -> 'ageRange') ->> 1)::numeric
      );
      v_has_age := true;
    END IF;
  END IF;

  SELECT count(*)::integer
  INTO v_reach
  FROM public.profiles p
  WHERE (NOT v_has_gender OR p.gender = ANY(v_gender_values))
    AND (NOT v_has_verified OR p.photo_verified IS NOT DISTINCT FROM v_is_verified)
    AND (
      NOT v_has_age
      OR (p.age IS NOT NULL AND p.age >= v_min_age AND p.age <= v_max_age)
    );

  RETURN public.admin_json_success(jsonb_build_object(
    'estimated_reach', v_reach,
    'segment_semantics', 'gender, isVerified, and ageRange only'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail_counts(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_registrations integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_event_registrations
  FROM public.event_registrations
  WHERE profile_id = p_user_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'event_registrations', v_event_registrations
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_match_message_counts(p_match_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_ids uuid[] := COALESCE(p_match_ids, ARRAY[]::uuid[]);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF COALESCE(array_length(v_ids, 1), 0) > 200 THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'At most 200 match ids may be counted at once.');
  END IF;

  WITH requested AS (
    SELECT DISTINCT requested_id.id AS match_id
    FROM unnest(v_ids) AS requested_id(id)
    WHERE requested_id.id IS NOT NULL
  ),
  counted AS (
    SELECT
      r.match_id,
      count(m.id)::integer AS message_count
    FROM requested r
    LEFT JOIN public.messages m ON m.match_id = r.match_id
    GROUP BY r.match_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('match_id', match_id, 'message_count', message_count)
      ORDER BY match_id
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM counted;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'max_match_ids', 200
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_photo_verification_counts(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_reports_summary_counts(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_estimate_push_campaign_reach(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_detail_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_match_message_counts(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_photo_verification_counts(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reports_summary_counts(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_estimate_push_campaign_reach(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_match_message_counts(uuid[]) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507110000',
  'Admin panel count read models',
  'schema-only',
  'Adds read-only admin RPCs for remaining /kaan count surfaces. No data rewrite or production mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_photo_verification_counts(timestamptz) IS
  'Read-only /kaan photo verification count summary.';
COMMENT ON FUNCTION public.admin_get_reports_summary_counts(timestamptz, timestamptz) IS
  'Read-only /kaan reports summary counts using caller-provided date boundaries.';
COMMENT ON FUNCTION public.admin_estimate_push_campaign_reach(jsonb) IS
  'Read-only /kaan push campaign reach estimate for supported targeting filters.';
COMMENT ON FUNCTION public.admin_get_user_detail_counts(uuid) IS
  'Read-only /kaan user detail count summary.';
COMMENT ON FUNCTION public.admin_get_match_message_counts(uuid[]) IS
  'Read-only /kaan batched match message counts, capped at 200 match ids.';
