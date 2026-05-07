-- Admin review comment follow-up.
--
-- Migration class: schema-only RPC corrections.
-- Intent: address Codex review comments on recent /kaan admin PRs with a
-- forward migration instead of relying on edits to already-applied migrations.

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

DROP FUNCTION IF EXISTS public.admin_get_reports_read_model(text, text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_get_reports_read_model(
  p_status text DEFAULT 'all',
  p_sort_field text DEFAULT 'created_at',
  p_sort_direction text DEFAULT 'desc',
  p_limit integer DEFAULT 200,
  p_search text DEFAULT NULL
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
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_search text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_reports jsonb := '[]'::jsonb;
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

  WITH report_rows AS (
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
      ) AS reported_profile,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'asc' THEN ur.status END ASC,
          CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'desc' THEN ur.status END DESC,
          CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN ur.created_at END ASC,
          CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'desc' THEN ur.created_at END DESC,
          ur.id ASC
      ) AS row_order
    FROM public.user_reports ur
    LEFT JOIN public.profiles reporter ON reporter.id = ur.reporter_id
    LEFT JOIN public.profiles reported ON reported.id = ur.reported_id
    WHERE (v_status = 'all' OR ur.status = v_status)
      AND (
        v_search IS NULL
        OR position(v_search in lower(COALESCE(reporter.name, ''))) > 0
        OR position(v_search in lower(COALESCE(reported.name, ''))) > 0
        OR position(v_search in lower(COALESCE(ur.reason::text, ''))) > 0
      )
    ORDER BY
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'asc' THEN ur.status END ASC,
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'desc' THEN ur.status END DESC,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN ur.created_at END ASC,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'desc' THEN ur.created_at END DESC,
      ur.id ASC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'reporter_id', reporter_id,
        'reported_id', reported_id,
        'reason', reason,
        'details', details,
        'status', status,
        'created_at', created_at,
        'reporter_profile', reporter_profile,
        'reported_profile', reported_profile
      )
      ORDER BY row_order
    ),
    '[]'::jsonb
  )
  INTO v_reports
  FROM report_rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'reports', v_reports,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_push_campaign_draft(
  p_campaign_id uuid,
  p_title text,
  p_body text,
  p_target_segment jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_campaign_id uuid;
  v_existing_status text;
  v_segment jsonb := COALESCE(p_target_segment, '{}'::jsonb);
  v_cached jsonb;
  v_response jsonb;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR p_body IS NULL OR btrim(p_body) = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign title and body are required.');
  END IF;

  IF jsonb_typeof(v_segment) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign target segment must be a JSON object.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(v_segment) AS keys(key)
    WHERE keys.key NOT IN ('gender', 'isVerified', 'ageRange')
  ) THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign target segment contains unsupported filters.');
  END IF;

  IF v_segment ? 'gender' AND jsonb_typeof(v_segment -> 'gender') <> 'array' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign gender filter must be an array.');
  END IF;

  IF v_segment ? 'isVerified' AND jsonb_typeof(v_segment -> 'isVerified') <> 'boolean' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign verified filter must be boolean.');
  END IF;

  IF v_segment ? 'ageRange' AND (
    jsonb_typeof(v_segment -> 'ageRange') <> 'array'
    OR jsonb_array_length(v_segment -> 'ageRange') <> 2
    OR jsonb_typeof((v_segment -> 'ageRange') -> 0) <> 'number'
    OR jsonb_typeof((v_segment -> 'ageRange') -> 1) <> 'number'
  ) THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign age range filter must be two numbers.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_upsert_push_campaign_draft',
    p_idempotency_key,
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'title', p_title,
      'body', p_body,
      'target_segment', v_segment
    )
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  IF p_campaign_id IS NULL THEN
    INSERT INTO public.push_campaigns (
      title,
      body,
      target_segment,
      status,
      scheduled_at,
      sent_at,
      created_by
    )
    VALUES (
      btrim(p_title),
      btrim(p_body),
      v_segment::text,
      'draft',
      NULL,
      NULL,
      v_admin_id
    )
    RETURNING id INTO v_campaign_id;
  ELSE
    SELECT status
    INTO v_existing_status
    FROM public.push_campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_response := public.admin_json_error('NOT_FOUND', 'Campaign was not found.');
      RETURN public.admin_idempotency_complete(
        v_admin_id,
        'admin_upsert_push_campaign_draft',
        p_idempotency_key,
        v_response
      );
    END IF;

    IF v_existing_status <> 'draft' THEN
      v_response := public.admin_json_error('INVALID_TRANSITION', 'Only draft campaigns can be edited.');
      RETURN public.admin_idempotency_complete(
        v_admin_id,
        'admin_upsert_push_campaign_draft',
        p_idempotency_key,
        v_response
      );
    END IF;

    UPDATE public.push_campaigns
    SET title = btrim(p_title),
        body = btrim(p_body),
        target_segment = v_segment::text
    WHERE id = p_campaign_id
    RETURNING id INTO v_campaign_id;
  END IF;

  v_audit_id := public.log_admin_action(
    'admin_upsert_push_campaign_draft',
    'push_campaign',
    v_campaign_id,
    jsonb_build_object(
      'created', p_campaign_id IS NULL,
      'target_segment_keys', (SELECT COALESCE(jsonb_agg(key), '[]'::jsonb) FROM jsonb_object_keys(v_segment) AS keys(key))
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'campaign_id', v_campaign_id,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(
    v_admin_id,
    'admin_upsert_push_campaign_draft',
    p_idempotency_key,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_push_campaign_draft(
  p_campaign_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_existing_status text;
  v_cached jsonb;
  v_response jsonb;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_campaign_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Campaign id is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_delete_push_campaign_draft',
    p_idempotency_key,
    jsonb_build_object('campaign_id', p_campaign_id)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT status
  INTO v_existing_status
  FROM public.push_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Campaign was not found.');
    RETURN public.admin_idempotency_complete(
      v_admin_id,
      'admin_delete_push_campaign_draft',
      p_idempotency_key,
      v_response
    );
  END IF;

  IF v_existing_status <> 'draft' THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Only draft campaigns can be deleted.');
    RETURN public.admin_idempotency_complete(
      v_admin_id,
      'admin_delete_push_campaign_draft',
      p_idempotency_key,
      v_response
    );
  END IF;

  DELETE FROM public.push_campaigns
  WHERE id = p_campaign_id;

  v_audit_id := public.log_admin_action(
    'admin_delete_push_campaign_draft',
    'push_campaign',
    p_campaign_id,
    jsonb_build_object('status', v_existing_status)
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'campaign_id', p_campaign_id,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(
    v_admin_id,
    'admin_delete_push_campaign_draft',
    p_idempotency_key,
    v_response
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_badge_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_push_campaign_draft(uuid, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_push_campaign_draft(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_badge_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_push_campaign_draft(uuid, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_push_campaign_draft(uuid, text) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507123000',
  'Admin review comment follow-up',
  'schema-only',
  'Redefines admin badge, reports read-model, and push campaign draft RPCs. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_dashboard_badge_counts() IS
  'Read-only /kaan dashboard badge counts for unread admin notifications, admin-actionable support tickets, and new legacy feedback.';
COMMENT ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer, text) IS
  'Read-only /kaan reports list read model with reporter and reported profile summaries, filtered by search before limiting.';
COMMENT ON FUNCTION public.admin_upsert_push_campaign_draft(uuid, text, text, jsonb, text) IS
  'Governed /kaan push campaign draft create/update RPC with idempotent validation responses.';
COMMENT ON FUNCTION public.admin_delete_push_campaign_draft(uuid, text) IS
  'Governed /kaan push campaign draft delete RPC with idempotent validation responses.';
