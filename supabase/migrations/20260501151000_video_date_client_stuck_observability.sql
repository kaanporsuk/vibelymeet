-- Client-perceived stuck-state observability for Vibe Video Date.
--
-- This is observability only: clients can append one sparse, allowlisted row per
-- session/user/event name. The RPC derives actor/event identity server-side and
-- writes into the existing service-role operator timeline table.

CREATE UNIQUE INDEX IF NOT EXISTS event_loop_obs_video_date_client_stuck_once_idx
  ON public.event_loop_observability_events (session_id, actor_id, operation, reason_code)
  WHERE operation = 'video_date_client_stuck_state';

CREATE OR REPLACE FUNCTION public.video_date_client_stuck_safe_text(
  p_value text,
  p_max_len integer DEFAULT 120
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v_value = '' OR length(v_value) > GREATEST(1, LEAST(COALESCE(p_max_len, 120), 240)) THEN
    RETURN NULL;
  END IF;

  IF v_value !~ '^[A-Za-z0-9_.:-]+$' THEN
    RETURN NULL;
  END IF;

  RETURN v_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_client_stuck_safe_text(text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_date_client_stuck_safe_int(
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

REVOKE ALL ON FUNCTION public.video_date_client_stuck_safe_int(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_date_client_stuck_safe_bool(p_value text)
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

REVOKE ALL ON FUNCTION public.video_date_client_stuck_safe_bool(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_video_date_client_stuck_observability(
  p_session_id uuid,
  p_event_name text,
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
  v_event_name text := lower(btrim(COALESCE(p_event_name, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_detail jsonb;
  v_rowcnt integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_event_name NOT IN (
    'ready_gate_handoff_slow',
    'prepare_date_entry_failed',
    'daily_join_confirmation_failed',
    'peer_missing_terminal',
    'native_background_recovery_started',
    'native_background_recovery_failed',
    'native_background_expired'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_event_name');
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

  v_latency_ms := CASE
    WHEN p_latency_ms IS NULL THEN NULL
    ELSE LEAST(86400000, GREATEST(0, p_latency_ms))
  END;

  v_outcome := CASE
    WHEN v_event_name IN (
      'prepare_date_entry_failed',
      'daily_join_confirmation_failed',
      'native_background_recovery_failed'
    ) THEN 'failure'
    WHEN v_event_name IN (
      'ready_gate_handoff_slow',
      'peer_missing_terminal',
      'native_background_expired'
    ) THEN 'timeout'
    ELSE 'success'
  END;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'client_event_name', v_event_name,
    'platform', CASE
      WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
      ELSE NULL
    END,
    'source', public.video_date_client_stuck_safe_text(v_payload->>'source'),
    'source_surface', public.video_date_client_stuck_safe_text(v_payload->>'source_surface'),
    'source_action', public.video_date_client_stuck_safe_text(v_payload->>'source_action'),
    'reason_code', public.video_date_client_stuck_safe_text(v_payload->>'reason_code'),
    'code', public.video_date_client_stuck_safe_text(v_payload->>'code'),
    'phase', public.video_date_client_stuck_safe_text(v_payload->>'phase'),
    'latency_bucket', public.video_date_client_stuck_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_client_stuck_safe_text(v_payload->>'entry_attempt_id'),
    'video_date_trace_id', public.video_date_client_stuck_safe_text(v_payload->>'video_date_trace_id'),
    'attempt', public.video_date_client_stuck_safe_int(v_payload->>'attempt', 0, 100),
    'attempt_count', public.video_date_client_stuck_safe_int(v_payload->>'attempt_count', 0, 100),
    'elapsed_ms', public.video_date_client_stuck_safe_int(v_payload->>'elapsed_ms', 0, 86400000),
    'duration_ms', public.video_date_client_stuck_safe_int(v_payload->>'duration_ms', 0, 86400000),
    'grace_ms', public.video_date_client_stuck_safe_int(v_payload->>'grace_ms', 0, 86400000),
    'watchdog_ms', public.video_date_client_stuck_safe_int(v_payload->>'watchdog_ms', 0, 86400000),
    'auto_recovery_count', public.video_date_client_stuck_safe_int(v_payload->>'auto_recovery_count', 0, 100),
    'http_status', public.video_date_client_stuck_safe_int(v_payload->>'http_status', 100, 599),
    'retryable', public.video_date_client_stuck_safe_bool(v_payload->>'retryable'),
    'exhausted', public.video_date_client_stuck_safe_bool(v_payload->>'exhausted'),
    'will_retry', public.video_date_client_stuck_safe_bool(v_payload->>'will_retry'),
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
    'video_date_client_stuck_state',
    v_outcome,
    v_event_name,
    v_latency_ms,
    v_session.event_id,
    v_actor,
    p_session_id,
    v_detail
  )
  ON CONFLICT (session_id, actor_id, operation, reason_code)
    WHERE operation = 'video_date_client_stuck_state'
    DO NOTHING;

  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_rowcnt = 1,
    'deduped', v_rowcnt = 0
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer) IS
  'Authenticated participant-only sparse client stuck-state audit ingestion for Video Date. Payload is allowlisted and sanitized; no state transitions are changed.';

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
  'Service-role-only operator timeline for a video session. Includes Ready Gate, video date transitions, client stuck-state rows, stale cleanup, Daily provider room/token lifecycle observability, and current video_sessions milestone timestamps.';
