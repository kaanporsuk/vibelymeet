-- P4 /kaan product, event, and match intelligence read surfaces.
--
-- Migration class: schema + RPC.
-- Intent: add deterministic, read-only intelligence RPCs for dashboards.
-- No ranking, moderation, entitlement, provider, or user-visible behavior changes.

CREATE OR REPLACE FUNCTION public.admin_get_product_intelligence_metrics(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_start timestamptz := COALESCE(p_window_start, now() - interval '30 days');
  v_end timestamptz := COALESCE(p_window_end, now());
  v_profiles integer := 0;
  v_verified_profiles integer := 0;
  v_registrations integer := 0;
  v_first_registrations integer := 0;
  v_matches integer := 0;
  v_video_sessions integer := 0;
  v_completed_sessions integer := 0;
  v_feedback_rows integer := 0;
  v_liked_feedback integer := 0;
  v_reports integer := 0;
  v_blocks integer := 0;
  v_premium_profiles integer := 0;
  v_active_subscriptions integer := 0;
  v_notification_attempts integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Product intelligence permission is required.');
  END IF;

  SELECT count(*)::integer INTO v_profiles
  FROM public.profiles
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_verified_profiles
  FROM public.profiles
  WHERE created_at >= v_start AND created_at < v_end
    AND (email_verified IS TRUE OR phone_verified IS TRUE OR photo_verified IS TRUE);

  SELECT count(*)::integer INTO v_premium_profiles
  FROM public.profiles
  WHERE created_at < v_end
    AND is_premium IS TRUE;

  SELECT count(*)::integer INTO v_registrations
  FROM public.event_registrations
  WHERE registered_at >= v_start AND registered_at < v_end;

  SELECT count(*)::integer INTO v_first_registrations
  FROM (
    SELECT profile_id, min(registered_at) AS first_registered_at
    FROM public.event_registrations
    GROUP BY profile_id
  ) firsts
  WHERE first_registered_at >= v_start AND first_registered_at < v_end;

  SELECT count(*)::integer INTO v_matches
  FROM public.matches
  WHERE matched_at >= v_start AND matched_at < v_end;

  SELECT count(*)::integer INTO v_video_sessions
  FROM public.video_sessions
  WHERE started_at >= v_start AND started_at < v_end;

  SELECT count(*)::integer INTO v_completed_sessions
  FROM public.video_sessions
  WHERE started_at >= v_start AND started_at < v_end
    AND ended_at IS NOT NULL;

  SELECT count(*)::integer, count(*) FILTER (WHERE liked IS TRUE)::integer
  INTO v_feedback_rows, v_liked_feedback
  FROM public.date_feedback
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_reports
  FROM public.user_reports
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_blocks
  FROM public.blocked_users
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_active_subscriptions
  FROM public.subscriptions
  WHERE status IN ('active', 'trialing')
    AND created_at < v_end;

  SELECT count(*)::integer INTO v_notification_attempts
  FROM public.notification_log
  WHERE created_at >= v_start AND created_at < v_end;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'source_semantics', 'Supabase product-state aggregates only; PostHog remains analytical and never overrides product truth.',
    'metrics', jsonb_build_object(
      'new_profiles', v_profiles,
      'verified_new_profiles', v_verified_profiles,
      'verification_rate', CASE WHEN v_profiles > 0 THEN round((v_verified_profiles::numeric / v_profiles::numeric) * 100, 1) ELSE 0 END,
      'event_registrations', v_registrations,
      'first_event_registrations', v_first_registrations,
      'matches', v_matches,
      'video_sessions', v_video_sessions,
      'completed_video_sessions', v_completed_sessions,
      'video_completion_rate', CASE WHEN v_video_sessions > 0 THEN round((v_completed_sessions::numeric / v_video_sessions::numeric) * 100, 1) ELSE 0 END,
      'feedback_rows', v_feedback_rows,
      'liked_feedback_rows', v_liked_feedback,
      'liked_feedback_rate', CASE WHEN v_feedback_rows > 0 THEN round((v_liked_feedback::numeric / v_feedback_rows::numeric) * 100, 1) ELSE 0 END,
      'reports', v_reports,
      'blocks', v_blocks,
      'premium_profiles', v_premium_profiles,
      'active_subscriptions', v_active_subscriptions,
      'notification_attempts', v_notification_attempts
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_event_liquidity_metrics(
  p_event_id uuid DEFAULT NULL,
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_start timestamptz := COALESCE(p_window_start, now() - interval '30 days');
  v_end timestamptz := COALESCE(p_window_end, now() + interval '30 days');
  v_rows jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Product intelligence permission is required.');
  END IF;

  WITH base_events AS (
    SELECT e.*
    FROM public.events e
    WHERE (p_event_id IS NULL OR e.id = p_event_id)
      AND (p_event_id IS NOT NULL OR (e.event_date >= v_start AND e.event_date < v_end))
    ORDER BY e.event_date ASC
    LIMIT CASE WHEN p_event_id IS NULL THEN 50 ELSE 1 END
  ),
  stats AS (
    SELECT
      e.id,
      e.title,
      e.event_date,
      e.status,
      e.archived_at,
      COALESCE(e.city, e.location_name, e.location_address) AS market,
      GREATEST(COALESCE(e.max_attendees, 0), 0) AS capacity,
      count(er.id)::integer AS registrations,
      count(er.id) FILTER (WHERE COALESCE(er.admission_status, 'confirmed') = 'confirmed')::integer AS confirmed,
      count(er.id) FILTER (WHERE er.attended IS TRUE OR er.attendance_marked IS TRUE)::integer AS attended,
      count(er.id) FILTER (WHERE er.queue_status IN ('in_ready_gate', 'in_handshake', 'in_date', 'in_survey', 'completed'))::integer AS lobby_participants,
      count(er.id) FILTER (WHERE lower(COALESCE(p.gender, '')) IN ('man', 'male', 'men'))::integer AS men,
      count(er.id) FILTER (WHERE lower(COALESCE(p.gender, '')) IN ('woman', 'female', 'women'))::integer AS women,
      count(er.id) FILTER (WHERE lower(COALESCE(p.gender, '')) NOT IN ('man', 'male', 'men', 'woman', 'female', 'women'))::integer AS other_gender,
      count(er.id) FILTER (WHERE p.photo_verified IS TRUE)::integer AS photo_verified,
      count(er.id) FILTER (WHERE p.is_premium IS TRUE OR p.subscription_tier IN ('premium', 'vip'))::integer AS premium,
      (SELECT count(*)::integer FROM public.video_sessions vs WHERE vs.event_id = e.id) AS video_sessions,
      (SELECT count(*)::integer FROM public.video_sessions vs WHERE vs.event_id = e.id AND vs.ended_at IS NOT NULL) AS completed_sessions,
      (SELECT count(*)::integer FROM public.event_swipes es WHERE es.event_id = e.id AND es.swipe_type IN ('vibe', 'super_vibe')) AS positive_swipes,
      (SELECT count(*)::integer FROM public.matches m WHERE m.event_id = e.id) AS matches,
      (
        SELECT count(*)::integer
        FROM public.user_reports ur
        WHERE ur.reporter_id IN (SELECT er2.profile_id FROM public.event_registrations er2 WHERE er2.event_id = e.id)
           OR ur.reported_id IN (SELECT er3.profile_id FROM public.event_registrations er3 WHERE er3.event_id = e.id)
      ) AS participant_reports
    FROM base_events e
    LEFT JOIN public.event_registrations er ON er.event_id = e.id
    LEFT JOIN public.profiles p ON p.id = er.profile_id
    GROUP BY e.id, e.title, e.event_date, e.status, e.archived_at, e.city, e.location_name, e.location_address, e.max_attendees
  ),
  scored AS (
    SELECT
      s.*,
      CASE
        WHEN s.capacity > 0 THEN LEAST(s.registrations::numeric / s.capacity::numeric, 1)
        ELSE 0
      END AS fill_factor,
      CASE
        WHEN (s.men + s.women) > 0 THEN 1 - (abs(s.men - s.women)::numeric / NULLIF((s.men + s.women)::numeric, 0))
        ELSE 0.5
      END AS balance_factor,
      CASE WHEN s.registrations > 0 THEN s.photo_verified::numeric / s.registrations::numeric ELSE 0 END AS verified_factor,
      CASE WHEN s.registrations > 0 THEN s.lobby_participants::numeric / s.registrations::numeric ELSE 0 END AS lobby_factor,
      CASE WHEN s.registrations > 0 THEN LEAST(s.matches::numeric / GREATEST(s.registrations::numeric / 2, 1), 1) ELSE 0 END AS match_factor,
      CASE WHEN s.registrations > 0 THEN LEAST(s.participant_reports::numeric / s.registrations::numeric, 1) ELSE 0 END AS report_factor
    FROM stats s
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'event_id', id,
      'title', title,
      'event_date', event_date,
      'raw_status', status,
      'archived', archived_at IS NOT NULL,
      'market', market,
      'score', GREATEST(0, LEAST(100, round(
        fill_factor * 25
        + balance_factor * 20
        + verified_factor * 15
        + lobby_factor * 15
        + match_factor * 15
        + (1 - report_factor) * 10
      )))::integer,
      'confidence', CASE
        WHEN registrations >= 20 THEN 'high'
        WHEN registrations >= 8 THEN 'medium'
        ELSE 'low'
      END,
      'recommendation', CASE
        WHEN archived_at IS NOT NULL THEN 'archived_no_action'
        WHEN registrations = 0 THEN 'needs_supply'
        WHEN fill_factor < 0.3 THEN 'promote_or_delay'
        WHEN balance_factor < 0.45 THEN 'rebalance_supply'
        WHEN report_factor > 0.1 THEN 'trust_review'
        WHEN match_factor >= 0.5 THEN 'healthy'
        ELSE 'monitor'
      END,
      'factors', jsonb_build_object(
        'capacity', capacity,
        'registrations', registrations,
        'confirmed', confirmed,
        'attended_or_marked', attended,
        'lobby_participants', lobby_participants,
        'men', men,
        'women', women,
        'other_gender', other_gender,
        'photo_verified', photo_verified,
        'premium', premium,
        'video_sessions', video_sessions,
        'completed_sessions', completed_sessions,
        'positive_swipes', positive_swipes,
        'matches', matches,
        'participant_reports', participant_reports
      )
    )
    ORDER BY event_date ASC
  ), '[]'::jsonb)
  INTO v_rows
  FROM scored;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'event_id', p_event_id,
    'score_semantics', 'Deterministic v1 planning score only; does not alter event visibility, matching, ranking, or enforcement.',
    'rows', v_rows
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_match_quality_metrics(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_start timestamptz := COALESCE(p_window_start, now() - interval '30 days');
  v_end timestamptz := COALESCE(p_window_end, now());
  v_sessions integer := 0;
  v_completed integer := 0;
  v_feedback integer := 0;
  v_liked integer := 0;
  v_matches integer := 0;
  v_messages integer := 0;
  v_reports integer := 0;
  v_blocks integer := 0;
  v_score integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Product intelligence permission is required.');
  END IF;

  SELECT count(*)::integer, count(*) FILTER (WHERE ended_at IS NOT NULL)::integer
  INTO v_sessions, v_completed
  FROM public.video_sessions
  WHERE started_at >= v_start AND started_at < v_end;

  SELECT count(*)::integer, count(*) FILTER (WHERE liked IS TRUE)::integer
  INTO v_feedback, v_liked
  FROM public.date_feedback
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_matches
  FROM public.matches
  WHERE matched_at >= v_start AND matched_at < v_end;

  SELECT count(*)::integer INTO v_messages
  FROM public.messages
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_reports
  FROM public.user_reports
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_blocks
  FROM public.blocked_users
  WHERE created_at >= v_start AND created_at < v_end;

  v_score := GREATEST(0, LEAST(100, round(
    CASE WHEN v_sessions > 0 THEN (v_completed::numeric / v_sessions::numeric) * 30 ELSE 0 END
    + CASE WHEN v_feedback > 0 THEN (v_liked::numeric / v_feedback::numeric) * 25 ELSE 0 END
    + CASE WHEN v_sessions > 0 THEN LEAST(v_matches::numeric / GREATEST(v_sessions::numeric, 1), 1) * 20 ELSE 0 END
    + CASE WHEN v_matches > 0 THEN LEAST(v_messages::numeric / GREATEST(v_matches::numeric * 2, 1), 1) * 15 ELSE 0 END
    + (1 - LEAST((v_reports + v_blocks)::numeric / GREATEST(v_sessions::numeric * 2, 1), 1)) * 10
  )))::integer;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'quality_score', v_score,
    'confidence', CASE WHEN v_sessions >= 50 THEN 'high' WHEN v_sessions >= 10 THEN 'medium' ELSE 'low' END,
    'score_semantics', 'Deterministic v1 score beyond mutual swipe; does not alter matching/ranking in P4.',
    'factors', jsonb_build_object(
      'video_sessions', v_sessions,
      'completed_sessions', v_completed,
      'feedback_rows', v_feedback,
      'liked_feedback_rows', v_liked,
      'matches', v_matches,
      'messages_after_matches', v_messages,
      'reports', v_reports,
      'blocks', v_blocks
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_retention_activation_metrics(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_start timestamptz := COALESCE(p_window_start, now() - interval '30 days');
  v_end timestamptz := COALESCE(p_window_end, now());
  v_new_users integer := 0;
  v_photo_profiles integer := 0;
  v_vibe_profiles integer := 0;
  v_registered_users integer := 0;
  v_matched_users integer := 0;
  v_d1_retained integer := 0;
  v_d7_retained integer := 0;
  v_d30_retained integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Product intelligence permission is required.');
  END IF;

  SELECT count(*)::integer INTO v_new_users
  FROM public.profiles
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_photo_profiles
  FROM public.profiles
  WHERE created_at >= v_start AND created_at < v_end
    AND (avatar_url IS NOT NULL OR COALESCE(array_length(photos, 1), 0) > 0);

  SELECT count(DISTINCT profile_id)::integer INTO v_vibe_profiles
  FROM public.profile_vibes pv
  JOIN public.profiles p ON p.id = pv.profile_id
  WHERE p.created_at >= v_start AND p.created_at < v_end;

  SELECT count(DISTINCT er.profile_id)::integer INTO v_registered_users
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE p.created_at >= v_start AND p.created_at < v_end;

  SELECT count(DISTINCT user_id)::integer INTO v_matched_users
  FROM (
    SELECT profile_id_1 AS user_id, matched_at FROM public.matches
    UNION ALL
    SELECT profile_id_2 AS user_id, matched_at FROM public.matches
  ) m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE p.created_at >= v_start AND p.created_at < v_end
    AND m.matched_at >= p.created_at;

  SELECT
    count(*) FILTER (WHERE last_seen_at >= created_at + interval '1 day')::integer,
    count(*) FILTER (WHERE last_seen_at >= created_at + interval '7 days')::integer,
    count(*) FILTER (WHERE last_seen_at >= created_at + interval '30 days')::integer
  INTO v_d1_retained, v_d7_retained, v_d30_retained
  FROM public.profiles
  WHERE created_at >= v_start AND created_at < v_end;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'semantics', 'Activation and retention are backend approximations from profiles, registrations, matches, and last_seen_at until a warehouse/PostHog cohort layer is justified.',
    'metrics', jsonb_build_object(
      'new_users', v_new_users,
      'profile_photo_users', v_photo_profiles,
      'vibe_tag_users', v_vibe_profiles,
      'event_registered_users', v_registered_users,
      'matched_users', v_matched_users,
      'd1_retained_users', v_d1_retained,
      'd7_retained_users', v_d7_retained,
      'd30_retained_users', v_d30_retained
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_product_intelligence_metrics(timestamptz, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_event_liquidity_metrics(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_match_quality_metrics(timestamptz, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_retention_activation_metrics(timestamptz, timestamptz, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_product_intelligence_metrics(timestamptz, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_liquidity_metrics(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_match_quality_metrics(timestamptz, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_retention_activation_metrics(timestamptz, timestamptz, jsonb) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506131000',
  'P4 product event match intelligence RPCs',
  'schema-only',
  'Adds read-only deterministic intelligence RPCs. Scores are advisory and do not alter matching, ranking, visibility, or enforcement.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_event_liquidity_metrics(uuid, timestamptz, timestamptz) IS
  'P4 deterministic event liquidity planning score. Advisory only; no product-state mutation.';
COMMENT ON FUNCTION public.admin_get_match_quality_metrics(timestamptz, timestamptz, jsonb) IS
  'P4 deterministic match quality score. Advisory only; no automated ranking/enforcement.';
