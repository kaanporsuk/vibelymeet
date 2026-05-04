-- Durable client-perceived launch latency checkpoints for Video Date.
-- This keeps the safety gates server-owned while giving operators a per-session
-- waterfall from "I'm ready" to the first blurred remote frame.

CREATE INDEX IF NOT EXISTS event_loop_obs_video_date_launch_latency_idx
  ON public.event_loop_observability_events (session_id, actor_id, created_at DESC)
  WHERE operation = 'video_date_launch_latency_checkpoint';

CREATE OR REPLACE FUNCTION public.video_date_launch_latency_safe_text(
  p_value text,
  p_max_len integer DEFAULT 140
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v_value = '' OR length(v_value) > GREATEST(1, LEAST(COALESCE(p_max_len, 140), 240)) THEN
    RETURN NULL;
  END IF;

  IF v_value !~ '^[A-Za-z0-9_.:_-]+$' THEN
    RETURN NULL;
  END IF;

  RETURN v_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_launch_latency_safe_text(text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_date_launch_latency_safe_int(
  p_value text,
  p_min integer DEFAULT 0,
  p_max integer DEFAULT 86400000
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
  v_number bigint;
  v_min integer := COALESCE(p_min, 0);
  v_max integer := COALESCE(p_max, 86400000);
BEGIN
  IF v_value = '' OR v_value !~ '^[0-9]{1,10}$' THEN
    RETURN NULL;
  END IF;

  v_number := v_value::bigint;
  RETURN LEAST(GREATEST(v_number, LEAST(v_min, v_max)), GREATEST(v_min, v_max))::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_launch_latency_safe_int(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_date_launch_latency_safe_bool(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_value text := lower(btrim(COALESCE(p_value, '')));
BEGIN
  IF v_value = 'true' THEN
    RETURN true;
  END IF;
  IF v_value = 'false' THEN
    RETURN false;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_launch_latency_safe_bool(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_own_ready_at timestamptz;
  v_peer_ready_at timestamptz;
  v_ready_actor_order text;
  v_detail jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_checkpoint NOT IN (
    'ready_gate_impression',
    'ready_tap',
    'ready_gate_transition_started',
    'ready_gate_transition_success',
    'both_ready_observed',
    'room_warmup_started',
    'room_warmup_success',
    'room_warmup_failure',
    'prepare_entry_started',
    'prepare_entry_success',
    'prepare_entry_failure',
    'provider_verify_started',
    'provider_verify_success',
    'provider_verify_skipped',
    'token_created',
    'navigation_started',
    'date_route_entered',
    'video_stage_shell_visible',
    'permission_check_started',
    'permission_check_success',
    'enter_handshake_started',
    'enter_handshake_success',
    'enter_handshake_failure',
    'daily_token_started',
    'daily_token_success',
    'daily_token_failure',
    'daily_join_started',
    'daily_join_success',
    'daily_join_failure',
    'local_video_ready',
    'remote_seen',
    'first_remote_frame',
    'remote_readable',
    'warmup_timer_started'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_checkpoint');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  IF v_session.participant_1_id = v_actor THEN
    v_own_ready_at := v_session.ready_participant_1_at;
    v_peer_ready_at := v_session.ready_participant_2_at;
  ELSE
    v_own_ready_at := v_session.ready_participant_2_at;
    v_peer_ready_at := v_session.ready_participant_1_at;
  END IF;

  v_ready_actor_order := CASE
    WHEN v_own_ready_at IS NULL OR v_peer_ready_at IS NULL THEN NULL
    WHEN v_own_ready_at <= v_peer_ready_at THEN 'first_ready'
    ELSE 'second_ready'
  END;

  v_latency_ms := CASE
    WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
    WHEN v_checkpoint = 'first_remote_frame' THEN
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
    ELSE COALESCE(
      public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
    )
  END;

  v_outcome := CASE
    WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
      THEN v_payload->>'outcome'
    WHEN v_checkpoint LIKE '%failure' THEN 'failure'
    ELSE 'success'
  END;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'client_event_name', 'ready_gate_to_date_latency_checkpoint',
    'checkpoint', v_checkpoint,
    'platform', CASE
      WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
      ELSE NULL
    END,
    'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
    'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
    'outcome', v_outcome,
    'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
    'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
    'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
    'ready_actor_order', COALESCE(v_ready_actor_order, public.video_date_launch_latency_safe_text(v_payload->>'ready_actor_order')),
    'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
    'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
    'ready_gate_open_to_ready_tap_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_gate_open_to_ready_tap_ms', 0, 86400000),
    'ready_tap_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_both_ready_ms', 0, 86400000),
    'ready_tap_to_prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_prepare_entry_ms', 0, 86400000),
    'ready_tap_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_date_route_ms', 0, 86400000),
    'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
    'ready_tap_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_remote_seen_ms', 0, 86400000),
    'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
    'both_ready_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_date_route_ms', 0, 86400000),
    'both_ready_to_daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_token_ms', 0, 86400000),
    'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
    'both_ready_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_remote_seen_ms', 0, 86400000),
    'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
    'both_ready_to_video_stage_shell_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_video_stage_shell_ms', 0, 86400000),
    'both_ready_to_local_video_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_local_video_ready_ms', 0, 86400000),
    'date_route_bootstrap_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_bootstrap_ms', 0, 86400000),
    'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
    'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
    'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
    'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
    'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
    'daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_ms', 0, 86400000),
    'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
    'room_warmup_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_warmup_ms', 0, 86400000),
    'prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_entry_ms', 0, 86400000),
    'provider_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'provider_verify_ms', 0, 86400000),
    'permission_check_ms', public.video_date_launch_latency_safe_int(v_payload->>'permission_check_ms', 0, 86400000),
    'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
    'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
    'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
    'observed_at', now()
  ));

  INSERT INTO public.event_loop_observability_events (
    operation,
    outcome,
    reason_code,
    latency_ms,
    event_id,
    actor_id,
    session_id,
    detail
  ) VALUES (
    'video_date_launch_latency_checkpoint',
    v_outcome,
    v_checkpoint,
    v_latency_ms,
    v_session.event_id,
    v_actor,
    p_session_id,
    v_detail
  );

  RETURN jsonb_build_object('ok', true, 'inserted', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. Payload is allowlisted and sanitized; no state transitions are changed.';

CREATE OR REPLACE FUNCTION public.get_video_date_session_timeline(p_session_id uuid)
RETURNS TABLE (
  timeline_seq bigint,
  occurred_at timestamptz,
  source text,
  operation text,
  outcome text,
  reason_code text,
  event_id uuid,
  actor_id uuid,
  session_id uuid,
  detail jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH session_row AS (
    SELECT *
    FROM public.video_sessions
    WHERE id = p_session_id
  ),
  timeline_rows AS (
    SELECT
      eo.created_at AS occurred_at,
      'event_loop_observability_events'::text AS source,
      eo.operation,
      eo.outcome,
      eo.reason_code,
      eo.event_id,
      eo.actor_id,
      eo.session_id,
      eo.detail,
      10 AS sort_order
    FROM public.event_loop_observability_events eo
    WHERE eo.session_id = p_session_id
      AND eo.operation IN (
        'handle_swipe',
        'ready_gate_transition',
        'video_date_transition',
        'repair_stale_video_date_prepare_entries',
        'expire_stale_video_sessions',
        'video_date_client_stuck_state',
        'video_date_launch_latency_checkpoint',
        'post_date_half_verdict_saved',
        'post_date_half_verdict_pending',
        'post_date_pending_verdict_completed',
        'post_date_pending_verdict_stale',
        'post_date_pending_verdict_reminder_sent',
        'post_date_pending_verdict_reminder_failed',
        'post_date_half_verdict_timeout',
        'create_date_room_attempt',
        'create_date_room_reused_existing_db_room',
        'create_date_room_provider_already_exists',
        'create_date_room_provider_created',
        'create_date_room_provider_recovered_or_recreated',
        'create_date_room_token_issued',
        'create_date_room_blocked_session_ended',
        'create_date_room_blocked_access_denied',
        'create_date_room_provider_error'
      )

    UNION ALL

    SELECT
      sr.started_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      'session_started',
      sr.event_id,
      NULL::uuid,
      sr.id,
      jsonb_build_object(
        'state', sr.state::text,
        'phase', sr.phase,
        'ready_gate_status', sr.ready_gate_status
      ),
      20
    FROM session_row sr

    UNION ALL

    SELECT
      milestone.occurred_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      milestone.reason_code,
      sr.event_id,
      milestone.actor_id,
      sr.id,
      milestone.detail,
      milestone.sort_order
    FROM session_row sr
    CROSS JOIN LATERAL (
      VALUES
        (
          sr.ready_participant_1_at,
          'participant_1_ready'::text,
          sr.participant_1_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          30
        ),
        (
          sr.ready_participant_2_at,
          'participant_2_ready'::text,
          sr.participant_2_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          31
        ),
        (
          sr.handshake_started_at,
          'handshake_started'::text,
          NULL::uuid,
          jsonb_build_object('state', sr.state::text, 'phase', sr.phase),
          40
        ),
        (
          sr.participant_1_joined_at,
          'participant_1_daily_joined'::text,
          sr.participant_1_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          50
        ),
        (
          sr.participant_2_joined_at,
          'participant_2_daily_joined'::text,
          sr.participant_2_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          51
        ),
        (
          sr.date_started_at,
          'date_started'::text,
          NULL::uuid,
          jsonb_build_object('date_extra_seconds', sr.date_extra_seconds),
          60
        ),
        (
          sr.ended_at,
          COALESCE(sr.ended_reason, 'session_ended'),
          NULL::uuid,
          jsonb_build_object(
            'state', sr.state::text,
            'phase', sr.phase,
            'ended_reason', sr.ended_reason,
            'duration_seconds', sr.duration_seconds
          ),
          70
        )
    ) AS milestone(occurred_at, reason_code, actor_id, detail, sort_order)
    WHERE milestone.occurred_at IS NOT NULL
  )
  SELECT
    row_number() OVER (ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC) AS timeline_seq,
    tr.occurred_at,
    tr.source,
    tr.operation,
    tr.outcome,
    tr.reason_code,
    tr.event_id,
    tr.actor_id,
    tr.session_id,
    tr.detail
  FROM timeline_rows tr
  WHERE tr.occurred_at IS NOT NULL
  ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_session_timeline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_session_timeline(uuid) TO service_role;

COMMENT ON FUNCTION public.get_video_date_session_timeline(uuid) IS
  'Service-role-only operator timeline for a video session. Includes Ready Gate, video date transitions, client launch-latency checkpoints, client stuck-state rows, stale cleanup, Daily provider room/token lifecycle observability, and current video_sessions milestone timestamps.';
