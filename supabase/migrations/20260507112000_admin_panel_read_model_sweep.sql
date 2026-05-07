-- Admin panel read-model sweep.
--
-- Migration class: schema-only RPC additions.
-- Intent: move remaining /kaan admin browser-side list/detail reads, and push
-- draft writes, behind backend admin RPC contracts.

CREATE OR REPLACE FUNCTION public.admin_list_photo_verifications(
  p_status text,
  p_reviewed_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_status text := lower(COALESCE(NULLIF(btrim(p_status), ''), 'pending'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF v_status NOT IN ('pending', 'approved', 'rejected') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Photo verification status is invalid.');
  END IF;

  WITH verification_rows AS (
    SELECT
      pv.id,
      pv.user_id,
      pv.profile_photo_url,
      pv.selfie_url,
      pv.status,
      pv.created_at,
      pv.client_confidence_score,
      pv.client_match_result,
      pv.rejection_reason,
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'age', p.age,
        'avatar_url', p.avatar_url
      ) AS profile,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_status = 'pending' THEN pv.created_at END ASC,
          CASE WHEN v_status <> 'pending' THEN pv.created_at END DESC,
          pv.id ASC
      ) AS row_order
    FROM public.photo_verifications pv
    LEFT JOIN public.profiles p ON p.id = pv.user_id
    WHERE pv.status = v_status
      AND (
        v_status = 'pending'
        OR p_reviewed_since IS NULL
        OR pv.reviewed_at >= p_reviewed_since
      )
    ORDER BY
      CASE WHEN v_status = 'pending' THEN pv.created_at END ASC,
      CASE WHEN v_status <> 'pending' THEN pv.created_at END DESC,
      pv.id ASC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'user_id', user_id,
        'profile_photo_url', profile_photo_url,
        'selfie_url', selfie_url,
        'status', status,
        'created_at', created_at,
        'client_confidence_score', client_confidence_score,
        'client_match_result', client_match_result,
        'rejection_reason', rejection_reason,
        'profile', profile
      )
      ORDER BY row_order
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM verification_rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_reports_read_model(
  p_status text DEFAULT 'all',
  p_sort_field text DEFAULT 'created_at',
  p_sort_direction text DEFAULT 'desc',
  p_limit integer DEFAULT 200
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
    WHERE v_status = 'all' OR ur.status = v_status
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

CREATE OR REPLACE FUNCTION public.admin_get_push_campaigns_read_model()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_campaigns jsonb := '[]'::jsonb;
  v_aggregate jsonb := '{}'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  WITH event_stats AS (
    SELECT
      pne.campaign_id,
      count(*)::integer AS total,
      count(*) FILTER (WHERE pne.status = 'queued')::integer AS queued,
      count(*) FILTER (WHERE pne.status IN ('sent', 'delivered', 'opened', 'clicked'))::integer AS sent,
      count(*) FILTER (WHERE pne.status IN ('delivered', 'opened', 'clicked'))::integer AS delivered,
      count(*) FILTER (WHERE pne.status IN ('opened', 'clicked'))::integer AS opened,
      count(*) FILTER (WHERE pne.status = 'clicked')::integer AS clicked,
      count(*) FILTER (WHERE pne.status IN ('failed', 'bounced'))::integer AS failed
    FROM public.push_notification_events pne
    WHERE pne.campaign_id IS NOT NULL
    GROUP BY pne.campaign_id
  ),
  campaign_rows AS (
    SELECT
      pc.id,
      pc.title,
      pc.body,
      pc.status,
      pc.target_segment,
      pc.scheduled_at,
      pc.sent_at,
      pc.created_at,
      jsonb_build_object(
        'total', COALESCE(es.total, 0),
        'queued', COALESCE(es.queued, 0),
        'sent', COALESCE(es.sent, 0),
        'delivered', COALESCE(es.delivered, 0),
        'opened', COALESCE(es.opened, 0),
        'clicked', COALESCE(es.clicked, 0),
        'failed', COALESCE(es.failed, 0)
      ) AS stats
    FROM public.push_campaigns pc
    LEFT JOIN event_stats es ON es.campaign_id = pc.id
    ORDER BY pc.created_at DESC, pc.id ASC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'title', title,
        'body', body,
        'status', status,
        'target_segment', target_segment,
        'scheduled_at', scheduled_at,
        'sent_at', sent_at,
        'created_at', created_at,
        'stats', stats
      )
    ),
    '[]'::jsonb
  )
  INTO v_campaigns
  FROM campaign_rows;

  WITH event_stats AS (
    SELECT
      pne.campaign_id,
      count(*)::integer AS total,
      count(*) FILTER (WHERE pne.status = 'queued')::integer AS queued,
      count(*) FILTER (WHERE pne.status IN ('sent', 'delivered', 'opened', 'clicked'))::integer AS sent,
      count(*) FILTER (WHERE pne.status IN ('delivered', 'opened', 'clicked'))::integer AS delivered,
      count(*) FILTER (WHERE pne.status IN ('opened', 'clicked'))::integer AS opened,
      count(*) FILTER (WHERE pne.status = 'clicked')::integer AS clicked,
      count(*) FILTER (WHERE pne.status IN ('failed', 'bounced'))::integer AS failed
    FROM public.push_notification_events pne
    WHERE pne.campaign_id IS NOT NULL
    GROUP BY pne.campaign_id
  )
  SELECT jsonb_build_object(
    'total', COALESCE(sum(total), 0)::integer,
    'queued', COALESCE(sum(queued), 0)::integer,
    'sent', COALESCE(sum(sent), 0)::integer,
    'delivered', COALESCE(sum(delivered), 0)::integer,
    'opened', COALESCE(sum(opened), 0)::integer,
    'clicked', COALESCE(sum(clicked), 0)::integer,
    'failed', COALESCE(sum(failed), 0)::integer
  )
  INTO v_aggregate
  FROM event_stats;

  RETURN public.admin_json_success(jsonb_build_object(
    'campaigns', v_campaigns,
    'aggregate_stats', COALESCE(v_aggregate, jsonb_build_object(
      'total', 0,
      'queued', 0,
      'sent', 0,
      'delivered', 0,
      'opened', 0,
      'clicked', 0,
      'failed', 0
    ))
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail_read_model(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_profile jsonb;
  v_vibes jsonb := '[]'::jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_daily_drops jsonb := '[]'::jsonb;
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

  SELECT to_jsonb(p) || jsonb_build_object(
    'event_registrations', v_event_registrations,
    'event_registrations_unavailable', false
  )
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'User profile was not found.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', vt.label,
        'emoji', vt.emoji,
        'category', vt.category
      )
      ORDER BY vt.category ASC NULLS LAST, vt.label ASC
    ),
    '[]'::jsonb
  )
  INTO v_vibes
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_user_id;

  WITH user_matches AS (
    SELECT
      m.id,
      m.matched_at,
      m.profile_id_1,
      m.profile_id_2,
      CASE WHEN m.profile_id_1 = p_user_id THEN m.profile_id_2 ELSE m.profile_id_1 END AS other_user_id
    FROM public.matches m
    WHERE m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id
    ORDER BY m.matched_at DESC, m.id ASC
    LIMIT 20
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', um.id,
        'matched_at', um.matched_at,
        'profile_id_1', um.profile_id_1,
        'profile_id_2', um.profile_id_2,
        'other_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY um.matched_at DESC, um.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM user_matches um
  LEFT JOIN public.profiles p ON p.id = um.other_user_id;

  WITH user_drops AS (
    SELECT
      dd.id,
      dd.user_a_id,
      dd.user_b_id,
      dd.status,
      dd.drop_date,
      dd.created_at,
      CASE WHEN dd.user_a_id = p_user_id THEN dd.user_b_id ELSE dd.user_a_id END AS partner_id
    FROM public.daily_drops dd
    WHERE dd.user_a_id = p_user_id OR dd.user_b_id = p_user_id
    ORDER BY dd.created_at DESC, dd.id ASC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ud.id,
        'user_a_id', ud.user_a_id,
        'user_b_id', ud.user_b_id,
        'status', ud.status,
        'drop_date', ud.drop_date,
        'created_at', ud.created_at,
        'partner_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY ud.created_at DESC, ud.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_daily_drops
  FROM user_drops ud
  LEFT JOIN public.profiles p ON p.id = ud.partner_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'profile', v_profile,
    'vibes', v_vibes,
    'matches', v_matches,
    'daily_drops', v_daily_drops
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_match_threads(
  p_user_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200);
  v_threads jsonb := '[]'::jsonb;
  v_total integer := 0;
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
  INTO v_total
  FROM public.matches m
  WHERE m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id;

  WITH user_matches AS (
    SELECT
      m.id,
      m.profile_id_1,
      m.profile_id_2,
      m.matched_at,
      m.last_message_at,
      m.archived_at,
      CASE WHEN m.profile_id_1 = p_user_id THEN m.profile_id_2 ELSE m.profile_id_1 END AS other_user_id
    FROM public.matches m
    WHERE m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id
    ORDER BY m.matched_at DESC, m.id ASC
    LIMIT v_limit
  ),
  message_counts AS (
    SELECT
      um.id AS match_id,
      count(msg.id)::integer AS message_count
    FROM user_matches um
    LEFT JOIN public.messages msg ON msg.match_id = um.id
    GROUP BY um.id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', um.id,
        'profile_id_1', um.profile_id_1,
        'profile_id_2', um.profile_id_2,
        'matched_at', um.matched_at,
        'last_message_at', um.last_message_at,
        'archived_at', um.archived_at,
        'message_count', COALESCE(mc.message_count, 0),
        'other_user', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos,
          'age', p.age,
          'gender', p.gender
        )
      )
      ORDER BY um.matched_at DESC, um.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_threads
  FROM user_matches um
  LEFT JOIN message_counts mc ON mc.match_id = um.id
  LEFT JOIN public.profiles p ON p.id = um.other_user_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'matches', v_threads,
    'total_matches', v_total,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_match_thread_messages(
  p_user_id uuid,
  p_match_id uuid,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_messages jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_user_id IS NULL OR p_match_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id and match id are required.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = p_match_id
      AND (m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id)
  ) THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Match was not found for this user.');
  END IF;

  WITH message_rows AS (
    SELECT
      msg.id,
      msg.content,
      msg.sender_id,
      msg.created_at,
      msg.read_at
    FROM public.messages msg
    WHERE msg.match_id = p_match_id
    ORDER BY msg.created_at ASC, msg.id ASC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'content', content,
        'sender_id', sender_id,
        'created_at', created_at,
        'read_at', read_at
      )
      ORDER BY created_at ASC, id ASC
    ),
    '[]'::jsonb
  )
  INTO v_messages
  FROM message_rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'messages', v_messages,
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
      RETURN public.admin_json_error('NOT_FOUND', 'Campaign was not found.');
    END IF;

    IF v_existing_status <> 'draft' THEN
      RETURN public.admin_json_error('INVALID_TRANSITION', 'Only draft campaigns can be edited.');
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
    RETURN public.admin_json_error('NOT_FOUND', 'Campaign was not found.');
  END IF;

  IF v_existing_status <> 'draft' THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Only draft campaigns can be deleted.');
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

REVOKE ALL ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_push_campaigns_read_model() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_detail_read_model(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_match_threads(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_match_thread_messages(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_push_campaign_draft(uuid, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_push_campaign_draft(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_push_campaigns_read_model() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail_read_model(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_match_threads(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_match_thread_messages(uuid, uuid, integer) TO authenticated;
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
  '20260507112000',
  'Admin panel read model sweep',
  'schema-only',
  'Adds backend admin read models and governed push campaign draft RPCs. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_photo_verifications(text, timestamptz, integer) IS
  'Read-only /kaan photo verification list read model with profile summary.';
COMMENT ON FUNCTION public.admin_get_reports_read_model(text, text, text, integer) IS
  'Read-only /kaan reports list read model with reporter and reported profile summaries.';
COMMENT ON FUNCTION public.admin_get_push_campaigns_read_model() IS
  'Read-only /kaan push campaign list and delivery stat read model.';
COMMENT ON FUNCTION public.admin_get_user_detail_read_model(uuid) IS
  'Read-only /kaan user detail drawer read model.';
COMMENT ON FUNCTION public.admin_get_user_match_threads(uuid, integer) IS
  'Read-only /kaan match thread summary read model.';
COMMENT ON FUNCTION public.admin_get_match_thread_messages(uuid, uuid, integer) IS
  'Read-only /kaan match thread messages read model validated against viewed user.';
COMMENT ON FUNCTION public.admin_upsert_push_campaign_draft(uuid, text, text, jsonb, text) IS
  'Governed /kaan push campaign draft create/update RPC.';
COMMENT ON FUNCTION public.admin_delete_push_campaign_draft(uuid, text) IS
  'Governed /kaan push campaign draft delete RPC.';
