-- Remove post-date auto-next / queued auto-promotion from the Video Date flow.
-- This is intentionally a forward-only cleanup: old applied migrations remain
-- historical, while current public/backend contracts stop exposing queued drain,
-- queued hint, and queued promotion surfaces.

DELETE FROM public.client_feature_flags
WHERE flag_key IN (
  'video_date.post_date_instant_next_v2',
  'video_date.outbox_v2.drain_match_queue'
);

WITH expired_queued AS (
  UPDATE public.video_sessions vs
  SET
    ready_gate_status = 'expired',
    queued_expires_at = NULL,
    ended_at = COALESCE(vs.ended_at, now()),
    ended_reason = COALESCE(vs.ended_reason, 'queued_auto_promotion_removed'),
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    state_updated_at = now()
  WHERE vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
  RETURNING
    vs.id,
    vs.event_id,
    vs.participant_1_id,
    vs.participant_2_id
)
UPDATE public.event_registrations er
SET
  queue_status = CASE
    WHEN er.queue_status IN ('queued', 'in_ready_gate') THEN 'idle'
    ELSE er.queue_status
  END,
  current_room_id = NULL,
  current_partner_id = NULL,
  last_active_at = now(),
  updated_at = now()
FROM expired_queued q
WHERE er.event_id = q.event_id
  AND er.profile_id IN (q.participant_1_id, q.participant_2_id)
  AND er.current_room_id = q.id;

UPDATE public.video_session_commands
SET
  status = 'rejected',
  committed_at = COALESCE(committed_at, now()),
  result_payload = jsonb_build_object(
    'success', false,
    'reason', 'queued_auto_promotion_removed',
    'code', 'AUTO_NEXT_REMOVED'
  )
WHERE command_kind = 'drain_match_queue'
  AND status = 'processing';

CREATE OR REPLACE FUNCTION public.mark_lobby_foreground(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.event_registrations
  SET
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = v_uid
    AND admission_status = 'confirmed';

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'mark_lobby_foreground',
    'success',
    'queued_auto_promotion_removed',
    v_ms,
    p_event_id,
    v_uid,
    NULL,
    jsonb_build_object('promotion_removed', true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_lobby_foreground(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_lobby_foreground(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_lobby_foreground(uuid) IS
  'Foreground heartbeat only. Queued Ready Gate auto-promotion was removed with post-date auto-next.';

DO $$
BEGIN
  IF to_regprocedure('public.handle_swipe_20260610000100_auto_next_base(uuid,uuid,uuid,text)') IS NULL
     AND to_regprocedure('public.handle_swipe_20260601183000_deck_authority_base(uuid,uuid,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
      RENAME TO handle_swipe_20260610000100_auto_next_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260610000100_auto_next_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260610000100_auto_next_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_outcome text;
  v_session_id_text text;
  v_session_id uuid;
  v_removed_outcome text;
BEGIN
  v_result := public.handle_swipe_20260610000100_auto_next_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );

  v_outcome := COALESCE(v_result->>'result', v_result->>'outcome', v_result->>'error');

  IF v_outcome IS DISTINCT FROM 'match_queued' THEN
    RETURN v_result;
  END IF;

  v_session_id_text := COALESCE(v_result->>'video_session_id', v_result->>'match_id');

  IF v_session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_session_id := v_session_id_text::uuid;

    UPDATE public.video_sessions vs
    SET
      ready_gate_status = 'expired',
      queued_expires_at = NULL,
      ended_at = COALESCE(vs.ended_at, now()),
      ended_reason = COALESCE(vs.ended_reason, 'queued_auto_promotion_removed'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE vs.id = v_session_id
      AND vs.ready_gate_status = 'queued';

    UPDATE public.event_registrations er
    SET
      queue_status = CASE
        WHEN er.queue_status IN ('queued', 'in_ready_gate') THEN 'idle'
        ELSE er.queue_status
      END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now(),
      updated_at = now()
    WHERE er.event_id = p_event_id
      AND er.profile_id IN (p_actor_id, p_target_id)
      AND er.current_room_id = v_session_id;
  END IF;

  v_removed_outcome := CASE
    WHEN p_swipe_type = 'super_vibe' THEN 'super_vibe_sent'
    ELSE 'vibe_recorded'
  END;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'result', v_removed_outcome,
    'outcome', v_removed_outcome,
    'event_id', p_event_id,
    'target_id', p_target_id,
    'notification_suppressed', true,
    'notification_suppressed_reason', 'queued_auto_promotion_removed',
    'dedupe_reason', 'queued_auto_promotion_removed',
    'reason', 'queued_auto_promotion_removed',
    'removed_video_session_id', v_session_id,
    'super_vibe_consumed', CASE
      WHEN v_result ? 'super_vibe_consumed' THEN (v_result->>'super_vibe_consumed')::boolean
      ELSE NULL
    END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text) IS
  'Swipe mutation base wrapper. Direct mutual match still opens Ready Gate; legacy match_queued responses are expired and returned as recorded swipes.';

CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_target_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_event_active boolean := false;
  v_event_reason text := 'unknown';
  v_event_ends_at timestamptz;
  v_seconds_until_event_end integer;
  v_has_feedback boolean := false;
  v_pair_blocked_or_reported boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_target_id := CASE
    WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  SELECT
    public.is_blocked(v_uid, v_target_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_uid AND ur.reported_id = v_target_id)
         OR (ur.reporter_id = v_target_id AND ur.reported_id = v_uid)
    )
  INTO v_pair_blocked_or_reported;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) INTO v_has_feedback;

  IF public.video_date_session_is_post_date_survey_eligible(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at
    )
    AND NOT v_has_feedback
    AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'reason', 'survey_required'
    );
  END IF;

  IF v_session.event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'home',
      'route', 'home',
      'session_id', p_session_id,
      'target_id', v_target_id,
      'reason', 'no_event_context'
    );
  END IF;

  v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
  v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

  IF NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    SELECT id INTO v_match_id
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2
    LIMIT 1;
  END IF;

  SELECT state.is_active, state.reason
  INTO v_event_active, v_event_reason
  FROM public.get_event_lobby_active_state(v_session.event_id, v_now) AS state
  LIMIT 1;

  SELECT e.event_date + (COALESCE(e.duration_minutes, 60) * interval '1 minute')
  INTO v_event_ends_at
  FROM public.events e
  WHERE e.id = v_session.event_id;

  IF v_event_ends_at IS NOT NULL THEN
    v_seconds_until_event_end := floor(EXTRACT(EPOCH FROM (v_event_ends_at - v_now)))::integer;
  END IF;

  IF COALESCE(v_event_active, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'lobby',
      'route', 'event_lobby',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'seconds_until_event_end', v_seconds_until_event_end,
      'reason', CASE
        WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
        WHEN v_seconds_until_event_end IS NOT NULL AND v_seconds_until_event_end <= 300 THEN 'last_chance'
        ELSE 'event_active'
      END
    );
  END IF;

  IF v_match_id IS NOT NULL AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'chat',
      'route', 'chat',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'event_active', false,
      'reason', 'event_closed_mutual_match'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'wrap_up',
    'route', 'event_wrap_up',
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'event_active', false,
    'event_reason', v_event_reason,
    'reason', CASE
      WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
      ELSE 'event_not_active'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_post_date_next_surface(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_date_next_surface(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_post_date_next_surface(uuid) IS
  'Participant-only authoritative post-date router. Returns survey, lobby, chat, wrap_up, or home; it no longer searches or routes to another Ready Gate or Video Date.';

DO $$
BEGIN
  IF to_regprocedure('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)') IS NULL
     AND to_regprocedure('public.get_video_date_sprint7_ops_health(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.get_video_date_sprint7_ops_health(uuid)
      RENAME TO get_video_date_sprint7_ops_health_20260610000100_auto_next_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health(
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb;
  v_windows jsonb;
BEGIN
  v_payload := public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(p_event_id);

  IF NOT (v_payload ? 'windows') OR jsonb_typeof(v_payload->'windows') <> 'array' THEN
    RETURN v_payload;
  END IF;

  SELECT COALESCE(
    jsonb_agg(window_item.value - 'queue_drain_miss_count' - 'queue_drain_failure_count'),
    '[]'::jsonb
  )
  INTO v_windows
  FROM jsonb_array_elements(v_payload->'windows') AS window_item(value);

  RETURN jsonb_set(v_payload, '{windows}', v_windows, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_sprint7_ops_health(uuid) IS
  'Service-role sprint safety/privacy ops payload with legacy queue-drain counters removed from window metrics.';

DROP FUNCTION IF EXISTS public.drain_match_queue(uuid);
DROP FUNCTION IF EXISTS public.drain_match_queue(uuid, uuid);
DROP FUNCTION IF EXISTS public.drain_match_queue_v2(uuid, text);
DROP FUNCTION IF EXISTS public.get_video_date_queue_hint_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible(uuid, uuid);
DROP FUNCTION IF EXISTS public.video_date_actor_pending_feedback_gate_v1(uuid, uuid);

DROP FUNCTION IF EXISTS public.drain_match_queue_20260608211359_survey_feedback_base(uuid);
DROP FUNCTION IF EXISTS public.drain_match_queue_v2_20260608211359_survey_feedback_base(uuid, text);
DROP FUNCTION IF EXISTS public.drain_match_queue_v2_20260605232304_single_owner_base(uuid, text);
DROP FUNCTION IF EXISTS public.drain_match_queue_20260502083000_active_base(uuid);
DROP FUNCTION IF EXISTS public.drain_match_queue_20260501180000_active_base(uuid);
DROP FUNCTION IF EXISTS public.get_video_date_queue_hint_v1_20260605232304_single_owner_base(uuid, uuid);

DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_20260505220000_queued_browse_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260503090000_encounter_guard_b(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_202605030900_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260502083000_ready_queue_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid, uuid);
