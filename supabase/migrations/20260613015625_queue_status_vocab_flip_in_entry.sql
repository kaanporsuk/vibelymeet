-- queue_status vocabulary flip: 'in_handshake' -> 'in_entry' (+ queue-era prune)
--
-- Companion to the PR-5 session vocab flip (handshake->entry): event_registrations.queue_status
-- still carried the old word. Two-gate change: the allowlist lives in BOTH the table CHECK
-- constraint AND function bodies, so both flip in this one migration.
--
-- Inventory evidence (read-only, 2026-06-13, live project schdyxcunwcvddlcshwd):
--   * event_registrations had 0 rows total (disposable test data, cleaned up) -> the UPDATEs
--     below are forward-safety no-ops at apply time.
--   * column default is 'idle'.
--   * 11 live functions referenced 'in_handshake'; all are regenerated below verbatim from
--     pg_get_functiondef with only the vocabulary flipped.
--   * pruned from CHECK (zero writers + zero live rows + zero client readers, queue-era residue):
--       - 'searching': only mention = read-only count FILTER in admin_get_event_live_analytics
--         + partial index idx_event_registrations_queue predicate (dropped below).
--       - 'matched': zero mentions in any live function, view, policy, index, or client.
--       - 'completed': only mentions = read-only count FILTERs in the two admin analytics fns.
--   * kept: idle (column default + many writers), browsing, in_ready_gate, in_entry (renamed),
--     in_date, in_survey, offline (update_participant_status presence writer).
--   * no views, matviews, RLS policies, or comments reference the old vocabulary.

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS valid_queue_status;

-- 0 rows live at inventory time; defensive forward-safety in case rows appear between
-- inventory and apply (new CHECK below must validate every row).
UPDATE public.event_registrations SET queue_status = 'in_entry' WHERE queue_status = 'in_handshake';
UPDATE public.event_registrations SET queue_status = 'idle'
WHERE queue_status IN ('searching', 'matched', 'completed');

ALTER TABLE public.event_registrations ADD CONSTRAINT valid_queue_status CHECK (
  queue_status = ANY (ARRAY[
    'idle'::text,
    'browsing'::text,
    'in_ready_gate'::text,
    'in_entry'::text,
    'in_date'::text,
    'in_survey'::text,
    'offline'::text
  ])
);

-- Queue-era partial index over the pruned 'searching' value (would be permanently empty).
DROP INDEX IF EXISTS public.idx_event_registrations_queue;

-- ===== admin_get_event_liquidity_metrics(uuid,timestamp with time zone,timestamp with time zone) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.admin_get_event_liquidity_metrics(p_event_id uuid DEFAULT NULL::uuid, p_window_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_window_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
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
      count(er.id) FILTER (WHERE er.queue_status IN ('in_ready_gate', 'in_entry', 'in_date', 'in_survey', 'completed'))::integer AS lobby_participants,
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
$function$
;

-- ===== admin_get_event_live_analytics(uuid) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.admin_get_event_live_analytics(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_date timestamptz;
  v_event_duration_minutes integer;
  v_active_users integer := 0;
  v_browsing integer := 0;
  v_in_ready_gate integer := 0;
  v_in_dates integer := 0;
  v_in_survey integer := 0;
  v_in_queue integer := 0;
  v_registrations integer := 0;
  v_confirmed integer := 0;
  v_waitlisted integer := 0;
  v_attended integer := 0;
  v_attendance_marked integer := 0;
  v_no_show integer := 0;
  v_gender_count jsonb := jsonb_build_object('man', 0, 'woman', 0, 'non-binary', 0);
  v_video_sessions integer := 0;
  v_completed_sessions integer := 0;
  v_mutual_vibes integer := 0;
  v_extended_sessions integer := 0;
  v_avg_duration integer := 0;
  v_match_rate integer := 0;
  v_extension_rate integer := 0;
  v_matches integer := 0;
  v_participant_reports integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Intelligence read permission is required.');
  END IF;

  SELECT e.event_date, e.duration_minutes
  INTO v_event_date, v_event_duration_minutes
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  SELECT
    count(*) FILTER (WHERE er.queue_status IS NOT NULL AND er.queue_status NOT IN ('idle', 'offline', 'completed'))::integer,
    count(*) FILTER (WHERE er.queue_status = 'browsing')::integer,
    count(*) FILTER (WHERE er.queue_status = 'in_ready_gate')::integer,
    count(*) FILTER (WHERE er.queue_status IN ('in_entry', 'in_date'))::integer,
    count(*) FILTER (WHERE er.queue_status = 'in_survey')::integer,
    count(*) FILTER (WHERE er.queue_status = 'searching')::integer,
    count(*)::integer,
    count(*) FILTER (WHERE er.admission_status = 'confirmed')::integer,
    count(*) FILTER (WHERE er.admission_status = 'waitlisted')::integer,
    count(*) FILTER (WHERE er.attended IS TRUE)::integer,
    count(*) FILTER (WHERE er.attendance_marked IS TRUE)::integer,
    count(*) FILTER (WHERE er.attendance_marked IS TRUE AND er.attended IS NOT TRUE)::integer,
    jsonb_build_object(
      'man', count(*) FILTER (WHERE p.gender = 'man')::integer,
      'woman', count(*) FILTER (WHERE p.gender = 'woman')::integer,
      'non-binary', count(*) FILTER (WHERE p.gender = 'non-binary')::integer
    )
  INTO
    v_active_users,
    v_browsing,
    v_in_ready_gate,
    v_in_dates,
    v_in_survey,
    v_in_queue,
    v_registrations,
    v_confirmed,
    v_waitlisted,
    v_attended,
    v_attendance_marked,
    v_no_show,
    v_gender_count
  FROM public.event_registrations er
  LEFT JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL AND vs.participant_1_liked IS TRUE AND vs.participant_2_liked IS TRUE)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL AND COALESCE(vs.duration_seconds, 0) > 60)::integer,
    COALESCE(round(avg(COALESCE(vs.duration_seconds, 0)) FILTER (WHERE vs.ended_at IS NOT NULL)), 0)::integer
  INTO
    v_video_sessions,
    v_completed_sessions,
    v_mutual_vibes,
    v_extended_sessions,
    v_avg_duration
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id;

  IF v_completed_sessions > 0 THEN
    v_match_rate := round((v_mutual_vibes::numeric / v_completed_sessions::numeric) * 100)::integer;
    v_extension_rate := round((v_extended_sessions::numeric / v_completed_sessions::numeric) * 100)::integer;
  END IF;

  SELECT count(*)::integer
  INTO v_matches
  FROM public.matches
  WHERE event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_participant_reports
  FROM public.user_reports ur
  WHERE ur.created_at >= v_event_date - interval '1 day'
    AND ur.created_at <= v_event_date + make_interval(mins => COALESCE(v_event_duration_minutes, 60)) + interval '1 day'
    AND (
      ur.reporter_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
      OR ur.reported_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
    );

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'active_users', v_active_users,
    'browsing', v_browsing,
    'in_ready_gate', v_in_ready_gate,
    'in_dates', v_in_dates,
    'in_survey', v_in_survey,
    'in_queue', v_in_queue,
    'match_rate', v_match_rate,
    'extension_rate', v_extension_rate,
    'avg_duration_seconds', v_avg_duration,
    'gender_count', v_gender_count,
    'video_sessions', v_video_sessions,
    'completed_video_sessions', v_completed_sessions,
    'registrations', v_registrations,
    'confirmed_registrations', v_confirmed,
    'waitlisted_registrations', v_waitlisted,
    'confirmed_attendance', v_attended,
    'attendance_marked_count', v_attendance_marked,
    'no_show_count', v_no_show,
    'persistent_matches', v_matches,
    'participant_reports_near_event_window', v_participant_reports,
    'report_scope', 'participant_reports_near_event_window'
  ));
END;
$function$
;

-- ===== block_user_with_cleanup(uuid,text,uuid) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.block_user_with_cleanup(p_blocked_id uuid, p_reason text DEFAULT NULL::text, p_match_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_blocker_id uuid := auth.uid();
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
  v_inserted boolean := false;
  v_match_ids uuid[] := '{}'::uuid[];
  v_session_ids uuid[] := '{}'::uuid[];
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_matches_deleted int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
  v_daily_drops_invalidated int := 0;
  v_event_vibes_deleted int := 0;
  v_video_sessions_closed int := 0;
  v_registrations_cleared int := 0;
BEGIN
  IF v_blocker_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_blocked_id IS NULL OR p_blocked_id = v_blocker_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_target', 'error', 'invalid_target');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_blocker_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'profile_not_found', 'error', 'profile_not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_blocked_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'target_not_found', 'error', 'target_not_found');
  END IF;

  INSERT INTO public.blocked_users (blocker_id, blocked_id, reason)
  VALUES (v_blocker_id, p_blocked_id, v_reason)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING true INTO v_inserted;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_match_ids
  FROM (
    SELECT id
    FROM public.matches
    WHERE (profile_id_1 = LEAST(v_blocker_id, p_blocked_id)
       AND profile_id_2 = GREATEST(v_blocker_id, p_blocked_id))
       OR (profile_id_1 = v_blocker_id AND profile_id_2 = p_blocked_id)
       OR (profile_id_1 = p_blocked_id AND profile_id_2 = v_blocker_id)
    FOR UPDATE
  ) pair_matches;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_session_ids
  FROM (
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND (
        (participant_1_id = v_blocker_id AND participant_2_id = p_blocked_id)
        OR (participant_1_id = p_blocked_id AND participant_2_id = v_blocker_id)
      )
    FOR UPDATE
  ) pair_sessions;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE ((proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id)
      OR match_id = ANY(v_match_ids))
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND dp.status = 'active'
    AND (
      ds.match_id = ANY(v_match_ids)
      OR (ds.proposer_id = v_blocker_id AND ds.recipient_id = p_blocked_id)
      OR (ds.proposer_id = p_blocked_id AND ds.recipient_id = v_blocker_id)
    );
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE (match_id = ANY(v_match_ids)
      OR (proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id))
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  UPDATE public.daily_drops
  SET
    status = 'invalidated',
    updated_at = now()
  WHERE user_a_id = LEAST(v_blocker_id, p_blocked_id)
    AND user_b_id = GREATEST(v_blocker_id, p_blocked_id)
    AND status IN ('active_unopened', 'active_viewed', 'active_opener_sent');
  GET DIAGNOSTICS v_daily_drops_invalidated = ROW_COUNT;

  DELETE FROM public.event_vibes
  WHERE (sender_id = v_blocker_id AND receiver_id = p_blocked_id)
     OR (sender_id = p_blocked_id AND receiver_id = v_blocker_id);
  GET DIAGNOSTICS v_event_vibes_deleted = ROW_COUNT;

  UPDATE public.video_sessions
  SET
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'blocked_pair'),
    state = 'ended'::public.video_date_state,
    state_updated_at = now(),
    phase = 'ended',
    ready_gate_status = CASE
      WHEN ready_gate_status IN ('forfeited', 'expired') THEN ready_gate_status
      ELSE 'forfeited'
    END
  WHERE id = ANY(v_session_ids);
  GET DIAGNOSTICS v_video_sessions_closed = ROW_COUNT;

  UPDATE public.event_registrations
  SET
    current_room_id = NULL,
    current_partner_id = NULL,
    queue_status = CASE
      WHEN queue_status IN ('queued', 'in_ready_gate', 'in_entry', 'in_date', 'in_survey') THEN 'browsing'
      ELSE queue_status
    END,
    last_active_at = now()
  WHERE current_room_id = ANY(v_session_ids)
     OR (profile_id = v_blocker_id AND current_partner_id = p_blocked_id)
     OR (profile_id = p_blocked_id AND current_partner_id = v_blocker_id);
  GET DIAGNOSTICS v_registrations_cleared = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = ANY(v_match_ids);
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'status', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'blocked_id', p_blocked_id,
    'hint_match_id', p_match_id,
    'cleanup', jsonb_build_object(
      'matches_found', COALESCE(array_length(v_match_ids, 1), 0),
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'matches_deleted', v_matches_deleted,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed,
      'daily_drops_invalidated', v_daily_drops_invalidated,
      'event_vibes_deleted', v_event_vibes_deleted,
      'video_sessions_closed', v_video_sessions_closed,
      'registrations_cleared', v_registrations_cleared
    )
  );
END;
$function$
;

-- ===== confirm_vde_event_inactive_base_v1(uuid,text,text,text) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.confirm_vde_event_inactive_base_v1(p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_gate_live boolean := false;
  v_already_entry boolean := false;
  v_blocked boolean := false;
  v_registration_count integer := 0;
  v_update_count integer := 0;
  v_queue_status text;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily room metadata is required',
      'code', 'DB_ROOM_PERSIST_FAILED'
    );
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', COALESCE(v_session.phase, 'ended'),
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_session.participant_1_id AND bu.blocked_id = v_session.participant_2_id)
       OR (bu.blocker_id = v_session.participant_2_id AND bu.blocked_id = v_session.participant_1_id)
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This call is no longer available.',
      'code', 'BLOCKED_PAIR',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_already_entry := (
    v_session.entry_started_at IS NOT NULL
    OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
    OR v_session.date_started_at IS NOT NULL
  );

  v_gate_live := (
    COALESCE(v_session.ready_gate_status, '') = 'both_ready'
    AND v_session.ready_gate_expires_at IS NOT NULL
    AND v_session.ready_gate_expires_at > v_now
  );

  IF NOT v_already_entry AND NOT v_gate_live THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Both participants must be ready before starting the video date',
      'code', 'READY_GATE_NOT_READY',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT count(*) INTO v_registration_count
  FROM (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    FOR UPDATE
  ) locked_registrations;

  IF v_registration_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_missing',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'registration_count', v_registration_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_queue_status := CASE
    WHEN v_session.date_started_at IS NOT NULL
      OR v_session.state = 'date'::public.video_date_state
      OR v_session.phase = 'date'
      THEN 'in_date'
    ELSE 'in_entry'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_queue_status,
    current_room_id = v_session.id,
    current_partner_id = CASE
      WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_update_failed',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'updated_count', v_update_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  UPDATE public.video_sessions
  SET
    daily_room_name = p_room_name,
    daily_room_url = p_room_url,
    state = CASE
      WHEN date_started_at IS NOT NULL OR state = 'date'::public.video_date_state THEN state
      ELSE 'entry'::public.video_date_state
    END,
    phase = CASE
      WHEN date_started_at IS NOT NULL OR phase = 'date' THEN phase
      ELSE 'entry'
    END,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
  RETURNING * INTO v_session;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'confirm_prepare_entry_prepared',
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'entry_attempt_id', p_entry_attempt_id,
      'state_after', v_session.state::text,
      'phase_after', v_session.phase,
      'room_metadata_persisted', true,
      'registration_status', v_queue_status,
      'entry_timer', 'deferred_until_both_daily_joined'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'state', v_session.state::text,
    'phase', v_session.phase,
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'entry_started_at', v_session.entry_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'daily_room_name', v_session.daily_room_name,
    'daily_room_url', v_session.daily_room_url,
    'entry_attempt_id', p_entry_attempt_id
  );
END;
$function$
;

-- ===== get_active_session_context(uuid) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.get_active_session_context(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration jsonb := NULL;
  v_current_session jsonb := NULL;
  v_open_sessions jsonb := '[]'::jsonb;
  v_recent_ended_sessions jsonb := '[]'::jsonb;
  v_feedback_session_ids jsonb := '[]'::jsonb;
  v_active_session jsonb := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'active_session', NULL,
      'registration', NULL,
      'current_session', NULL,
      'open_sessions', '[]'::jsonb,
      'recent_ended_sessions', '[]'::jsonb,
      'feedback_session_ids', '[]'::jsonb,
      'reason', 'missing_user'
    );
  END IF;

  SELECT to_jsonb(r)
  INTO v_registration
  FROM (
    SELECT
      er.event_id,
      er.current_room_id,
      er.queue_status,
      er.current_partner_id
    FROM public.event_registrations er
    WHERE er.profile_id = v_user_id
      AND er.queue_status IN ('in_entry', 'in_date', 'in_survey', 'in_ready_gate')
      AND er.current_room_id IS NOT NULL
      AND (p_event_id IS NULL OR er.event_id = p_event_id)
    ORDER BY
      CASE er.queue_status
        WHEN 'in_entry' THEN 0
        WHEN 'in_date' THEN 1
        WHEN 'in_ready_gate' THEN 2
        WHEN 'in_survey' THEN 3
        ELSE 4
      END,
      er.registered_at DESC NULLS LAST
    LIMIT 1
  ) r;

  IF v_registration IS NOT NULL THEN
    SELECT to_jsonb(vs)
    INTO v_current_session
    FROM (
      SELECT
        id,
        event_id,
        participant_1_id,
        participant_2_id,
        ended_at,
        ended_reason,
        state,
        phase,
        entry_started_at,
        date_started_at,
        date_extra_seconds,
        ready_gate_status,
        ready_gate_expires_at,
        reconnect_grace_ends_at,
        started_at,
        state_updated_at,
        participant_1_joined_at,
        participant_2_joined_at,
        daily_room_name,
        daily_room_url
      FROM public.video_sessions
      WHERE id = (v_registration->>'current_room_id')::uuid
        AND (
          participant_1_id = v_user_id
          OR participant_2_id = v_user_id
        )
      LIMIT 1
    ) vs;

    IF v_current_session IS NOT NULL AND v_current_session->>'ended_at' IS NULL THEN
      v_active_session := jsonb_build_object(
        'kind',
          CASE
            WHEN v_registration->>'queue_status' = 'in_ready_gate' THEN 'ready_gate'
            ELSE 'video'
          END,
        'session_id', v_current_session->>'id',
        'event_id', v_registration->>'event_id',
        'queue_status', v_registration->>'queue_status'
      );
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_open_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      state,
      phase,
      entry_started_at,
      date_started_at,
      date_extra_seconds,
      ready_gate_status,
      ready_gate_expires_at,
      reconnect_grace_ends_at,
      started_at,
      state_updated_at,
      participant_1_joined_at,
      participant_2_joined_at,
      daily_room_name,
      daily_room_url
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY entry_started_at DESC NULLS LAST, ready_gate_expires_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_recent_ended_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      ended_reason,
      date_started_at,
      participant_1_joined_at,
      participant_2_joined_at,
      state,
      phase
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NOT NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY ended_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(df.session_id), '[]'::jsonb)
  INTO v_feedback_session_ids
  FROM public.date_feedback df
  WHERE df.user_id = v_user_id
    AND df.session_id IN (
      SELECT ended_vs.id
      FROM public.video_sessions ended_vs
      WHERE (ended_vs.participant_1_id = v_user_id OR ended_vs.participant_2_id = v_user_id)
        AND ended_vs.ended_at IS NOT NULL
        AND (p_event_id IS NULL OR ended_vs.event_id = p_event_id)
      ORDER BY ended_vs.ended_at DESC NULLS LAST
      LIMIT 10
    );

  IF v_active_session IS NULL AND jsonb_array_length(v_open_sessions) > 0 THEN
    v_current_session := v_open_sessions->0;
    v_active_session := jsonb_build_object(
      'kind',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'entry_started_at', '') = ''
          THEN 'ready_gate'
          ELSE 'video'
        END,
      'session_id', v_current_session->>'id',
      'event_id', v_current_session->>'event_id',
      'queue_status',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'entry_started_at', '') = ''
          THEN 'in_ready_gate'
          ELSE COALESCE(NULLIF(v_current_session->>'phase', ''), NULLIF(v_current_session->>'state', ''), 'in_entry')
        END
    );
  END IF;

  RETURN jsonb_build_object(
    'active_session', v_active_session,
    'registration', v_registration,
    'current_session', v_current_session,
    'open_sessions', v_open_sessions,
    'recent_ended_sessions', v_recent_ended_sessions,
    'feedback_session_ids', v_feedback_session_ids,
    'reason', CASE WHEN v_active_session IS NULL THEN 'no_active_session_shadow_context' ELSE 'active_session_shadow_context' END
  );
END;
$function$
;

-- ===== handle_swipe_20260506090000_stale_room_base(uuid,uuid,uuid,text) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.handle_swipe_20260506090000_stale_room_base(p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active record;
  v_inactive_reason text;
  v_existing_swipe_type text;
  v_existing_swipe_created_at timestamptz;
  v_mutual boolean := false;
  v_session_id uuid;
  v_existing_status text;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_now timestamptz := now();
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('success', false, 'result', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN jsonb_build_object('success', false, 'result', 'invalid_request', 'error', 'invalid_request');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'not_registered', 'error', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, v_now);

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'event_not_active',
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'message', 'This event is no longer active.',
      'notification_suppressed', true,
      'dedupe_reason', 'event_not_active'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_target_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'target_not_found', 'error', 'target_not_found');
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_actor_id, p_target_id) THEN
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'pair_already_met_this_event',
      NULL,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'target_id', p_target_id,
        'swipe_type', p_swipe_type,
        'terminal_encounter_pair', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'pair_already_met_this_event',
      'result', 'pair_already_met_this_event',
      'error', 'pair_already_met_this_event',
      'message', 'You already met this person in this event. Keep browsing for new people.',
      'notification_suppressed', true,
      'dedupe_reason', 'terminal_encounter_pair'
    );
  END IF;

  IF public.is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'result', 'blocked', 'error', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports
    WHERE reporter_id = p_actor_id
      AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'reported', 'error', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'account_paused',
      'result', 'account_paused',
      'error', 'account_paused',
      'message', 'Resume your account before swiping in this event.',
      'notification_suppressed', true
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_actor_id OR z.participant_2_id = p_actor_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'pre_swipe_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'ready_gate_conflict_guard', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_target_id OR z.participant_2_id = p_target_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_active_session_conflict'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_idempotency:' || p_event_id::text || ':' ||
        p_actor_id::text || ':' || p_target_id::text,
      0
    )
  );

  SELECT es.swipe_type, es.created_at
  INTO v_existing_swipe_type, v_existing_swipe_created_at
  FROM public.event_swipes es
  WHERE es.event_id = p_event_id
    AND es.actor_id = p_actor_id
    AND es.target_id = p_target_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_swipe_type IS DISTINCT FROM p_swipe_type THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'swipe_already_recorded',
        'result', 'swipe_already_recorded',
        'error', 'swipe_already_recorded',
        'message', 'You already swiped on this person.',
        'existing_swipe_type', v_existing_swipe_type,
        'requested_swipe_type', p_swipe_type,
        'duplicate', true,
        'idempotent', true,
        'replay', true,
        'notification_suppressed', true,
        'dedupe_reason', 'swipe_type_conflict'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes peer
      WHERE peer.event_id = p_event_id
        AND peer.actor_id = p_target_id
        AND peer.target_id = p_actor_id
        AND peer.swipe_type IN ('vibe', 'super_vibe')
        AND v_existing_swipe_type IN ('vibe', 'super_vibe')
    ) INTO v_mutual;

    IF v_mutual THEN
      SELECT vs.id, vs.ready_gate_status
      INTO v_session_id, v_existing_status
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND vs.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND vs.participant_2_id = GREATEST(p_actor_id, p_target_id)
        AND vs.ended_at IS NULL
      ORDER BY vs.started_at DESC
      LIMIT 1;

      IF v_session_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'outcome', 'already_matched',
          'result', 'already_matched',
          'match_id', v_session_id,
          'video_session_id', v_session_id,
          'event_id', p_event_id,
          'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
          'ready_gate_status', v_existing_status,
          'existing_swipe_type', v_existing_swipe_type,
          'requested_swipe_type', p_swipe_type,
          'duplicate', true,
          'idempotent', true,
          'replay', true,
          'notification_suppressed', true,
          'dedupe_reason', 'existing_match'
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_swiped',
      'result', 'already_swiped',
      'existing_swipe_type', v_existing_swipe_type,
      'requested_swipe_type', p_swipe_type,
      'duplicate', true,
      'idempotent', true,
      'replay', true,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_swipe',
      'swipe_recorded_at', v_existing_swipe_created_at
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'outcome', 'pass_recorded', 'result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'handle_swipe_super_vibe_cap:' || p_event_id::text || ':' || p_actor_id::text,
        0
      )
    );

    SELECT COUNT(*)
    INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'limit_reached', 'result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > v_now - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object(
        'success', true,
        'outcome', 'already_super_vibed_recently',
        'result', 'already_super_vibed_recently'
      );
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_mutual_pair:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_target_id
      AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF NOT v_mutual THEN
    IF p_swipe_type = 'super_vibe' THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'super_vibe_sent', 'result', 'super_vibe_sent');
    END IF;

    RETURN jsonb_build_object('success', true, 'outcome', 'vibe_recorded', 'result', 'vibe_recorded');
  END IF;

  v_t0 := clock_timestamp();

  UPDATE public.event_registrations
  SET
    queue_status = 'browsing',
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = p_actor_id
    AND admission_status = 'confirmed'
    AND (queue_status IS NULL OR queue_status IN ('browsing', 'idle'));

  INSERT INTO public.video_sessions (
    event_id,
    participant_1_id,
    participant_2_id,
    ready_gate_status,
    ready_gate_expires_at
  )
  VALUES (
    p_event_id,
    LEAST(p_actor_id, p_target_id),
    GREATEST(p_actor_id, p_target_id),
    'ready',
    v_now + interval '30 seconds'
  )
  ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    SELECT id, ready_gate_status
    INTO v_session_id, v_existing_status
    FROM public.video_sessions
    WHERE event_id = p_event_id
      AND participant_1_id = LEAST(p_actor_id, p_target_id)
      AND participant_2_id = GREATEST(p_actor_id, p_target_id)
      AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'pair_already_met_this_event',
        'result', 'pair_already_met_this_event',
        'error', 'pair_already_met_this_event',
        'message', 'You already met this person in this event. Keep browsing for new people.',
        'notification_suppressed', true,
        'dedupe_reason', 'same_event_pair_not_reopenable'
      );
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = CASE
        WHEN v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN 'in_ready_gate'
        ELSE queue_status
      END,
      current_room_id = v_session_id,
      current_partner_id = CASE
        WHEN profile_id = p_actor_id THEN p_target_id
        ELSE p_actor_id
      END,
      last_active_at = v_now
    WHERE event_id = p_event_id
      AND profile_id IN (p_actor_id, p_target_id)
      AND (queue_status IS NULL OR queue_status NOT IN ('in_entry', 'in_date', 'in_survey'));

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'no_op',
      'already_matched',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'ready_gate_status', v_existing_status
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_matched',
      'result', 'already_matched',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id,
      'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
      'ready_gate_status', v_existing_status,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_match'
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_session_id,
    current_partner_id = CASE
      WHEN profile_id = p_actor_id THEN p_target_id
      ELSE p_actor_id
    END,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id IN (p_actor_id, p_target_id);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'handle_swipe',
    'success',
    'match_immediate',
    v_ms,
    p_event_id,
    p_actor_id,
    v_session_id,
    jsonb_build_object(
      'swipe_type', p_swipe_type,
      'mutual', true,
      'immediate', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'match',
    'result', 'match',
    'match_id', v_session_id,
    'video_session_id', v_session_id,
    'event_id', p_event_id,
    'immediate', true,
    'ready_gate_status', 'ready'
  );
END;
$function$
;

-- ===== mark_video_date_daily_alive(uuid,text,text,text,text,text) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_event_id uuid;
  v_eligibility jsonb := '{}'::jsonb;
  v_provider jsonb := '{}'::jsonb;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_payload jsonb;
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_reason_code text;
  v_observed boolean := false;
  -- heartbeat worker state (formerly the 20260607155414 lifecycle base)
  v_now timestamptz;
  v_status text;
  v_routeable boolean := false;
  v_started_entry boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_provider_presence jsonb := '{}'::jsonb;
  v_join_stamp_accepted boolean := false;
  v_presence_event_recorded boolean := false;
  v_noop_observability_recorded boolean := false;
  v_presence_throttle interval;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Lifecycle eligibility precheck (formerly the hot base). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_daily_alive',
        'provider_presence_required', true,
        'provider_backed_current', false,
        'provider_presence_missing', true,
        'join_stamp_accepted', false,
        'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
        'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
        'owner_state', v_owner_state,
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    SELECT vs.event_id INTO v_event_id
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    -- ── Current-provider-session proof precheck (formerly the hot base):
    -- proof-missing calls are structured ok:true no-ops, never stamps. ──
    v_provider := public.video_date_current_provider_session_proof_v1(
      p_session_id,
      v_actor,
      v_provider_session_id,
      v_owner_state,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_provider->>'ok')::boolean, false) IS NOT TRUE THEN
      v_reason_code := COALESCE(v_provider->>'code', 'DAILY_JOIN_PROVIDER_PROOF_MISSING');

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          CASE
            WHEN COALESCE((v_provider->>'provider_presence_terminal')::boolean, false)
              THEN 'daily_alive_provider_session_left'
            ELSE 'daily_alive_provider_join_pending'
          END,
          NULL,
          v_event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', v_owner_state,
            'provider_proof', v_provider,
            'join_stamp_accepted', false,
            'lifecycle_eligibility_checked', true,
            'retryable', COALESCE((v_provider->>'retryable')::boolean, true),
            'rejection_code', v_reason_code
          )
        );
        v_observed := true;
      EXCEPTION
        WHEN OTHERS THEN
          v_observed := false;
      END;

      v_payload := v_provider
        || jsonb_build_object(
          'ok', true,
          'success', true,
          'rpc', 'mark_video_date_daily_alive',
          'error', lower(v_reason_code),
          'code', v_reason_code,
          'error_code', v_reason_code,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true,
          'join_stamp_accepted', false,
          'waiting_for_stable_copresence', true,
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'owner_state', v_owner_state,
          'lifecycle_eligibility_checked', true,
          'provider_join_webhook_required', true,
          'provider_proof_observed', v_observed
        );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    -- ── Heartbeat worker (formerly the 20260607155414 lifecycle base). ──
    BEGIN
      v_now := clock_timestamp();

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object(
          'ok', false,
          'error', 'unauthorized',
          'retryable', false
        );
      ELSE
        SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
        IF NOT FOUND THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'not_found',
            'retryable', false
          );
        ELSIF v_actor IS DISTINCT FROM v_row.participant_1_id
          AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'forbidden',
            'retryable', false
          );
        ELSIF v_row.ended_at IS NOT NULL THEN
          UPDATE public.video_date_surface_claims
          SET released_at = COALESCE(released_at, v_now),
              updated_at = v_now
          WHERE profile_id = v_actor
            AND session_id = p_session_id
            AND surface = 'video_date'
            AND released_at IS NULL;

          v_result := jsonb_build_object(
            'ok', false,
            'error', 'session_ended',
            'retryable', false,
            'terminal', true,
            'queue_status', 'in_survey',
            'ended_at', v_row.ended_at,
            'ended_reason', v_row.ended_reason,
            'surface_claim_released', true
          );
        ELSE
          v_routeable :=
            v_row.ready_gate_status = 'both_ready'
            AND (
              v_row.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
              OR v_row.phase IN ('entry', 'date')
              OR v_row.entry_started_at IS NOT NULL
              OR v_row.date_started_at IS NOT NULL
            );

          IF NOT v_routeable THEN
            v_result := jsonb_build_object(
              'ok', false,
              'error', 'not_routeable',
              'retryable', true,
              'retry_after_ms', 750,
              'ready_gate_status', v_row.ready_gate_status,
              'state', v_row.state,
              'phase', v_row.phase
            );
          ELSE
            SELECT
              vde.event_type,
              vde.occurred_at,
              public.video_date_daily_provider_session_id_from_event_v1(
                vde.provider_participant_id,
                vde.payload
              )
            INTO
              v_latest_provider_event_type,
              v_latest_provider_event_at,
              v_latest_provider_session_id
            FROM public.video_date_daily_webhook_events vde
            WHERE vde.session_id = p_session_id
              AND vde.provider_user_id = v_actor::text
              AND vde.event_type IN ('participant.joined', 'participant.left')
            ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
            LIMIT 1;

            v_provider_backed_current :=
              v_owner_state = 'joined'
              AND v_provider_session_id IS NOT NULL
              AND (
                v_latest_provider_event_type IS NULL
                OR (
                  v_latest_provider_event_type = 'participant.joined'
                  AND v_latest_provider_session_id = v_provider_session_id
                )
                OR (
                  v_latest_provider_event_type = 'participant.left'
                  AND v_latest_provider_session_id IS NOT NULL
                  AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
                )
              );

            v_presence_throttle := CASE
              WHEN v_provider_backed_current THEN interval '6 seconds'
              ELSE interval '30 seconds'
            END;

            IF NOT EXISTS (
              SELECT 1
              FROM public.video_date_presence_events vpe
              WHERE vpe.session_id = p_session_id
                AND vpe.actor_id = v_actor
                AND vpe.event_type = 'client_daily_alive'
                AND vpe.provider_session_id IS NOT DISTINCT FROM v_provider_session_id
                AND vpe.owner_state IS NOT DISTINCT FROM v_owner_state
                AND vpe.occurred_at >= v_now - v_presence_throttle
              LIMIT 1
            ) THEN
              INSERT INTO public.video_date_presence_events (
                session_id,
                actor_id,
                source,
                event_type,
                owner_id,
                call_instance_id,
                provider_session_id,
                entry_attempt_id,
                owner_state,
                occurred_at,
                details
              ) VALUES (
                p_session_id,
                v_actor,
                'mark_video_date_daily_alive',
                'client_daily_alive',
                NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                v_provider_session_id,
                NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                v_owner_state,
                v_now,
                jsonb_build_object(
                  'rpc', 'mark_video_date_daily_alive',
                  'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                  'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                  'provider_session_id', v_provider_session_id,
                  'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                  'owner_state', v_owner_state,
                  'provider_presence_required', true,
                  'provider_backed_current', v_provider_backed_current,
                  'join_stamp_accepted', v_provider_backed_current,
                  'latest_provider_event_type', v_latest_provider_event_type,
                  'latest_provider_event_at', v_latest_provider_event_at,
                  'latest_provider_session_id', v_latest_provider_session_id,
                  'provider_participant_id_source', 'provider_participant_id_or_payload',
                  'throttle_window_seconds', EXTRACT(EPOCH FROM v_presence_throttle)::integer
                )
              );
              v_presence_event_recorded := true;
            END IF;

            IF NOT v_provider_backed_current THEN
              IF NOT EXISTS (
                SELECT 1
                FROM public.event_loop_observability_events el
                WHERE el.operation = 'video_date_transition'
                  AND el.session_id = p_session_id
                  AND el.actor_id = v_actor
                  AND el.reason_code = 'daily_alive_without_current_provider_presence'
                  AND el.created_at >= v_now - interval '30 seconds'
                LIMIT 1
              ) THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'daily_alive_without_current_provider_presence',
                  NULL,
                  v_row.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', 'mark_video_date_daily_alive',
                    'owner_state', v_owner_state,
                    'provider_session_id', v_provider_session_id,
                    'provider_presence_required', true,
                    'latest_provider_event_type', v_latest_provider_event_type,
                    'latest_provider_event_at', v_latest_provider_event_at,
                    'latest_provider_session_id', v_latest_provider_session_id,
                    'provider_participant_id_source', 'provider_participant_id_or_payload',
                    'throttled', true
                  )
                );
                v_noop_observability_recorded := true;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_entry'
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', false,
                'waiting_for_stable_copresence', true,
                'retry_after_ms', 3000,
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence_required', true,
                'provider_backed_current', false,
                'presence_event_recorded', v_presence_event_recorded,
                'noop_observability_recorded', v_noop_observability_recorded,
                'latest_provider_event_type', v_latest_provider_event_type,
                'latest_provider_event_at', v_latest_provider_event_at,
                'latest_provider_session_id', v_latest_provider_session_id,
                'provider_presence_missing', true,
                'provider_presence_terminal', v_latest_provider_event_type = 'participant.left',
                'join_stamp_accepted', false,
                'stable_copresence_required', true
              );
            ELSE
              v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

              IF v_actor = v_row.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_1_joined_at IS NULL
                      OR participant_1_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_2_joined_at IS NULL
                      OR participant_2_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              END IF;
              v_join_stamp_accepted := true;

              SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

              v_stable := public.video_date_stable_copresence_v1(p_session_id);
              v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
              v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
              v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);
              v_provider_presence := CASE
                WHEN v_actor = v_row.participant_1_id THEN v_stable->'participant_1_provider_presence'
                ELSE v_stable->'participant_2_provider_presence'
              END;

              IF v_row.date_started_at IS NULL
                 AND v_row.entry_started_at IS NULL
                 AND v_stable_copresence THEN
                UPDATE public.video_sessions
                SET
                  entry_started_at = v_now,
                  state = 'entry'::public.video_date_state,
                  phase = 'entry',
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND date_started_at IS NULL
                  AND entry_started_at IS NULL
                RETURNING * INTO v_row;

                IF FOUND THEN
                  v_started_entry := true;
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'entry_started_after_stable_daily_alive',
                    NULL,
                    v_row.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', 'mark_video_date_daily_alive',
                      'stable_copresence', v_stable,
                      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                      'provider_session_id', v_provider_session_id,
                      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                      'provider_presence_required', true,
                      'stable_copresence_required', true
                    )
                  );
                ELSE
                  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
                END IF;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_entry'
              END;

              UPDATE public.event_registrations
              SET
                queue_status = v_status,
                current_room_id = p_session_id,
                current_partner_id = CASE
                  WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                  ELSE v_row.participant_1_id
                END,
                last_active_at = v_now
              WHERE event_id = v_row.event_id
                AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
                AND (
                  queue_status IS DISTINCT FROM v_status
                  OR current_room_id IS DISTINCT FROM p_session_id
                  OR current_partner_id IS DISTINCT FROM CASE
                    WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                    ELSE v_row.participant_1_id
                  END
                  OR last_active_at < v_now - interval '15 seconds'
                  OR last_active_at IS NULL
                );

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', v_started_entry,
                'entry_started_at', v_row.entry_started_at,
                'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
                'stable_copresence', v_stable,
                'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
                'latest_joined_at', CASE
                  WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_joined_at
                  ELSE v_row.participant_2_joined_at
                END,
                'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence', v_provider_presence,
                'provider_presence_required', true,
                'provider_backed_current', v_provider_backed_current,
                'presence_event_recorded', v_presence_event_recorded,
                'join_stamp_accepted', v_join_stamp_accepted,
                'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
                'participant_1_joined_at', v_row.participant_1_joined_at,
                'participant_1_away_at', v_row.participant_1_away_at,
                'participant_1_active', v_participant_1_active,
                'participant_2_joined_at', v_row.participant_2_joined_at,
                'participant_2_away_at', v_row.participant_2_away_at,
                'participant_2_active', v_participant_2_active,
                'stable_copresence_required', true
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_daily_alive.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'daily_alive_stamp_failed',
          'code', 'DAILY_ALIVE_STAMP_FAILED',
          'error_code', 'DAILY_ALIVE_STAMP_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, remote_seen and strict/hot wrapper bases). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_promotion := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'provider_backed_alive',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_promotion,
      'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
    );

    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'strict_provider_join_proof_checked', true,
      'provider_join_webhook_required', true,
      'provider_proof', v_provider,
      'lifecycle_eligibility_checked', true
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'mark_video_date_daily_alive.single_body',
          'daily_alive_stamp_failed',
          'DAILY_ALIVE_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
            'error', 'daily_alive_failed',
            'reason', 'daily_alive_failed',
            'code', 'DAILY_ALIVE_FAILED',
            'error_code', 'DAILY_ALIVE_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$
;

-- ===== prevent_client_session_registration_state_overwrite() (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.prevent_client_session_registration_state_overwrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.current_room_id IS DISTINCT FROM OLD.current_room_id
       OR NEW.current_partner_id IS DISTINCT FROM OLD.current_partner_id THEN
      RETURN NULL;
    END IF;

    IF NEW.queue_status IS DISTINCT FROM OLD.queue_status
       AND (
         OLD.queue_status IN ('in_ready_gate', 'in_entry', 'in_date')
         OR NEW.queue_status IN ('in_ready_gate', 'in_entry', 'in_date')
       ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

-- ===== repair_video_date_registration_session_drift_v1(uuid,integer,boolean) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.repair_video_date_registration_session_drift_v1(p_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_row record;
  v_items jsonb := '[]'::jsonb;
  v_repaired integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_row IN
    WITH candidates AS (
      SELECT
        vs.id,
        vs.event_id,
        vs.participant_1_id,
        vs.participant_2_id,
        vs.ready_gate_status,
        vs.state_updated_at
      FROM public.video_sessions vs
      WHERE vs.ended_at IS NULL
        AND vs.state::text = 'ready_gate'
        AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
        AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
        AND (p_event_id IS NULL OR vs.event_id = p_event_id)
      ORDER BY vs.state_updated_at DESC NULLS LAST, vs.started_at DESC NULLS LAST
      LIMIT v_limit
    ),
    joined AS (
      SELECT
        c.*,
        er1.profile_id AS p1_profile_id,
        er1.queue_status AS p1_queue_status,
        er1.current_room_id AS p1_current_room_id,
        er1.current_partner_id AS p1_current_partner_id,
        er2.profile_id AS p2_profile_id,
        er2.queue_status AS p2_queue_status,
        er2.current_room_id AS p2_current_room_id,
        er2.current_partner_id AS p2_current_partner_id
      FROM candidates c
      LEFT JOIN public.event_registrations er1
        ON er1.event_id = c.event_id
       AND er1.profile_id = c.participant_1_id
      LEFT JOIN public.event_registrations er2
        ON er2.event_id = c.event_id
       AND er2.profile_id = c.participant_2_id
    ),
    evaluated AS (
      SELECT
        j.*,
        array_remove(ARRAY[
          CASE WHEN j.p1_profile_id IS NULL THEN 'participant_1_registration_missing' END,
          CASE WHEN j.p2_profile_id IS NULL THEN 'participant_2_registration_missing' END,
          CASE WHEN j.p1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_current_room_mismatch' END,
          CASE WHEN j.p2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_current_room_mismatch' END,
          CASE WHEN j.p1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
          CASE WHEN j.p2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
          CASE WHEN j.p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
          CASE WHEN j.p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END
        ]::text[], NULL) AS issues
      FROM joined j
    )
    SELECT *
    FROM evaluated
    WHERE cardinality(issues) > 0
    ORDER BY state_updated_at DESC NULLS LAST
  LOOP
    IF v_row.p1_profile_id IS NULL OR v_row.p2_profile_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'missing_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
        AND er.current_room_id IS NOT NULL
        AND er.current_room_id IS DISTINCT FROM v_row.id
        AND er.queue_status IN ('in_ready_gate', 'in_entry', 'in_date', 'in_survey')
    ) THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'conflicting_active_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE public.event_registrations er
      SET
        current_room_id = v_row.id,
        current_partner_id = CASE
          WHEN er.profile_id = v_row.participant_1_id THEN v_row.participant_2_id
          ELSE v_row.participant_1_id
        END,
        queue_status = 'in_ready_gate',
        updated_at = now()
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id);
    END IF;

    v_repaired := v_repaired + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'session_id', v_row.id,
      'event_id', v_row.event_id,
      'ready_gate_status', v_row.ready_gate_status,
      'action', CASE WHEN p_dry_run THEN 'would_repair' ELSE 'repaired' END,
      'issues', to_jsonb(v_row.issues)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'queued_excluded', true,
    'repairable_count', v_repaired,
    'skipped_count', v_skipped,
    'items', v_items
  );
END;
$function$
;

-- ===== update_participant_status(uuid,text) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.update_participant_status(p_event_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clear_room boolean := false;
  v_status text;
  v_current_status text;
  v_current_room_id uuid;
  v_has_active_joined_session boolean := false;
  v_has_pending_post_date_survey boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR btrim(p_status) = '' THEN
    RETURN;
  END IF;

  v_status := lower(btrim(p_status));
  IF v_status NOT IN (
    'browsing',
    'idle',
    'in_survey',
    'offline'
  ) THEN
    RETURN;
  END IF;

  SELECT queue_status, current_room_id
  INTO v_current_status, v_current_room_id
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND profile_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_current_room_id IS NOT NULL
     AND v_current_status IN ('in_ready_gate', 'in_entry', 'in_date')
     AND v_status IN ('browsing', 'idle', 'in_survey', 'offline') THEN
    RETURN;
  END IF;

  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND vs.ended_at IS NULL
        AND (
          vs.entry_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
        )
    )
    INTO v_has_active_joined_session;

    IF v_has_active_joined_session THEN
      RETURN;
    END IF;
  END IF;

  IF v_current_status = 'in_survey'
     AND v_status IN ('browsing', 'idle', 'offline') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND v_uid IN (vs.participant_1_id, vs.participant_2_id)
        AND (v_current_room_id IS NULL OR vs.id = v_current_room_id)
        AND public.video_date_session_is_post_date_survey_eligible_v2(
          vs.ended_at,
          vs.ended_reason,
          vs.date_started_at,
          vs.state::text,
          vs.phase,
          vs.participant_1_joined_at,
          vs.participant_2_joined_at,
          vs.participant_1_remote_seen_at,
          vs.participant_2_remote_seen_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.date_feedback df
          WHERE df.session_id = vs.id
            AND df.user_id = v_uid
        )
    )
    INTO v_has_pending_post_date_survey;

    IF v_has_pending_post_date_survey THEN
      RETURN;
    END IF;
  END IF;

  -- A release status reaching this point with a room pointer at a terminal
  -- session means the pointer is stale bookkeeping: clear it so nothing can
  -- later key on current_room_id alone (2026-06-12 acceptance follow-up 2a).
  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND (
          vs.ended_at IS NOT NULL
          OR vs.state::text = 'ended'
          OR COALESCE(vs.phase, '') = 'ended'
        )
    )
    INTO v_clear_room;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    last_active_at = now(),
    current_room_id = CASE WHEN v_clear_room THEN NULL ELSE current_room_id END,
    current_partner_id = CASE WHEN v_clear_room THEN NULL ELSE current_partner_id END
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$
;

-- ===== video_date_session_lifecycle_eligibility_v1(uuid,uuid,text) (live def 2026-06-13, vocab flip only) =====
CREATE OR REPLACE FUNCTION public.video_date_session_lifecycle_eligibility_v1(p_session_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'video_date_session_lifecycle_eligibility_v1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := p_actor_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_session_lifecycle_eligibility_v1');
  v_session public.video_sessions%ROWTYPE;
  v_partner_id uuid;
  v_actor_registration public.event_registrations%ROWTYPE;
  v_partner_registration public.event_registrations%ROWTYPE;
  v_actor_eligibility jsonb := '{}'::jsonb;
  v_partner_eligibility jsonb := '{}'::jsonb;
  v_actor_ok boolean := false;
  v_partner_ok boolean := false;
  v_inactive_reason text;
BEGIN
  IF v_actor IS NULL THEN
    BEGIN
      v_actor := auth.uid();
    EXCEPTION
      WHEN OTHERS THEN
        v_actor := NULL;
    END;
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'UNAUTHORIZED',
      'error_code', 'UNAUTHORIZED',
      'error', 'unauthorized',
      'retryable', false,
      'terminal', false,
      'source', v_source
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'SESSION_NOT_FOUND',
      'error_code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'source', v_source
    );
  END IF;

  IF v_actor IS DISTINCT FROM v_session.participant_1_id
     AND v_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'NOT_PARTICIPANT',
      'error_code', 'NOT_PARTICIPANT',
      'error', 'not_participant',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'source', v_source
    );
  END IF;

  v_partner_id := CASE
    WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR COALESCE(v_session.phase, '') = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'SESSION_ENDED',
      'error_code', 'SESSION_ENDED',
      'error', 'session_ended',
      'retryable', false,
      'terminal', true,
      'session_ended', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'source', v_source
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL
     AND v_session.date_started_at IS NULL
     AND v_session.state::text IS DISTINCT FROM 'date'
     AND COALESCE(v_session.phase, '') IS DISTINCT FROM 'date' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'EVENT_INACTIVE',
      'error_code', 'EVENT_INACTIVE',
      'error', 'event_inactive',
      'reason', v_inactive_reason,
      'inactive_reason', v_inactive_reason,
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'source', v_source
    );
  END IF;

  SELECT *
  INTO v_actor_registration
  FROM public.event_registrations
  WHERE event_id = v_session.event_id
    AND profile_id = v_actor;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_EVENT_REGISTRATION_MISSING',
      'error_code', 'ACTOR_EVENT_REGISTRATION_MISSING',
      'error', 'actor_event_registration_missing',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'source', v_source
    );
  END IF;

  SELECT *
  INTO v_partner_registration
  FROM public.event_registrations
  WHERE event_id = v_session.event_id
    AND profile_id = v_partner_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_EVENT_REGISTRATION_MISSING',
      'error_code', 'PARTNER_EVENT_REGISTRATION_MISSING',
      'error', 'partner_event_registration_missing',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF v_actor_registration.current_room_id IS DISTINCT FROM p_session_id
     OR COALESCE(v_actor_registration.queue_status, '') NOT IN (
       'in_ready_gate',
       'in_entry',
       'in_date',
       'in_survey'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_SESSION_REGISTRATION_MISMATCH',
      'error_code', 'ACTOR_SESSION_REGISTRATION_MISMATCH',
      'error', 'actor_session_registration_mismatch',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF v_partner_registration.current_room_id IS DISTINCT FROM p_session_id
     OR COALESCE(v_partner_registration.queue_status, '') NOT IN (
       'in_ready_gate',
       'in_entry',
       'in_date',
       'in_survey'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_SESSION_REGISTRATION_MISMATCH',
      'error_code', 'PARTNER_SESSION_REGISTRATION_MISMATCH',
      'error', 'partner_session_registration_mismatch',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'partner_queue_status', v_partner_registration.queue_status,
      'partner_current_room_id', v_partner_registration.current_room_id,
      'source', v_source
    );
  END IF;

  v_actor_eligibility := public.video_date_participant_eligibility_v1(
    v_actor,
    v_source || '.actor'
  );
  v_partner_eligibility := public.video_date_participant_eligibility_v1(
    v_partner_id,
    v_source || '.partner'
  );

  v_actor_ok := COALESCE((v_actor_eligibility->>'ok')::boolean, false)
    AND COALESCE((v_actor_eligibility->>'eligible')::boolean, false);
  v_partner_ok := COALESCE((v_partner_eligibility->>'ok')::boolean, false)
    AND COALESCE((v_partner_eligibility->>'eligible')::boolean, false);

  IF NOT v_actor_ok THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_NOT_ELIGIBLE',
      'error_code', 'ACTOR_NOT_ELIGIBLE',
      'error', 'actor_not_eligible',
      'retryable', COALESCE((v_actor_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_actor_eligibility->>'terminal')::boolean, true),
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_eligibility', v_actor_eligibility,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF NOT v_partner_ok THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_NOT_ELIGIBLE',
      'error_code', 'PARTNER_NOT_ELIGIBLE',
      'error', 'partner_not_eligible',
      'retryable', COALESCE((v_partner_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_partner_eligibility->>'terminal')::boolean, true),
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'partner_eligibility', v_partner_eligibility,
      'partner_queue_status', v_partner_registration.queue_status,
      'partner_current_room_id', v_partner_registration.current_room_id,
      'source', v_source
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'eligible', true,
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'actor_id', v_actor,
    'partner_id', v_partner_id,
    'actor_queue_status', v_actor_registration.queue_status,
    'actor_current_room_id', v_actor_registration.current_room_id,
    'partner_queue_status', v_partner_registration.queue_status,
    'partner_current_room_id', v_partner_registration.current_room_id,
    'actor_eligibility', v_actor_eligibility,
    'partner_eligibility', v_partner_eligibility,
    'lifecycle_eligibility_checked', true,
    'source', v_source
  );
END;
$function$
;
