-- Video Date startup snapshot + Ready Gate hardening.
--
-- Production Ready Gate startup can be blocked by PostgREST/RLS/helper drift on
-- raw video_sessions reads or auxiliary RPCs. This migration adds one
-- participant-safe startup snapshot and wraps the hot public RPCs so startup
-- returns structured retry/terminal payloads instead of uncaught 500s.

CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_server_now_ms bigint;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_deadline_at timestamptz;
  v_actor_role text;
  v_partner_id uuid;
  v_ready_gate_status text;
  v_i_am_ready boolean := false;
  v_partner_ready boolean := false;
  v_is_participant boolean := false;
  v_is_blocked boolean := false;
  v_inactive_reason text := NULL;
  v_can_mark_ready boolean := false;
  v_can_enter_date boolean := false;
  v_terminal boolean := false;
  v_retryable boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
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
      'error', 'session_not_found',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_is_participant :=
    v_uid = v_session.participant_1_id
    OR v_uid = v_session.participant_2_id;

  IF NOT v_is_participant THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'error_code', 'NOT_PARTICIPANT',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');

  BEGIN
    v_is_blocked := public.is_blocked(v_session.participant_1_id, v_session.participant_2_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'blocked_pair_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'safety_check_unavailable',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'auxiliary_errors', v_auxiliary_errors,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF v_is_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'viewer_role', CASE
        WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
        ELSE 'participant_2'
      END,
      'partner_id', CASE
        WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END,
      'error', 'blocked_pair',
      'error_code', 'BLOCKED_PAIR',
      'reason', 'blocked_pair',
      'ended_reason', 'blocked_pair',
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'can_mark_ready', false,
      'can_enter_date', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'event_active_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      v_inactive_reason := NULL;
  END;

  v_actor_role := CASE
    WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
    WHEN v_uid = v_session.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_partner_id := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;
  v_i_am_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_1_at IS NOT NULL
    ELSE v_session.ready_participant_2_at IS NOT NULL
  END;
  v_partner_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_2_at IS NOT NULL
    ELSE v_session.ready_participant_1_at IS NOT NULL
  END;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_deadline_at := COALESCE(
    v_deadline_row_at,
    CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END
  );

  v_terminal :=
    v_session.ended_at IS NOT NULL
    OR v_session.state::text = 'ended'
    OR v_ready_gate_status IN ('both_ready', 'expired', 'forfeited', 'cancelled', 'ended');

  v_can_mark_ready :=
    v_inactive_reason IS NULL
    AND v_session.ended_at IS NULL
    AND v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      v_session.ready_gate_expires_at IS NULL
      OR v_session.ready_gate_expires_at > v_now
      OR v_ready_gate_status = 'snoozed'
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snooze_expires_at IS NULL
      OR v_session.snooze_expires_at > v_now
    );

  v_can_enter_date :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_session.date_started_at IS NOT NULL
      OR v_session.state::text = 'date'
      OR v_ready_gate_status = 'both_ready'
    )
    AND v_session.daily_room_name IS NOT NULL
    AND v_session.daily_room_url IS NOT NULL;

  v_retryable :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed');

  v_allowed := CASE
    WHEN v_can_mark_ready THEN ARRAY['mark_ready', 'forfeit']::text[]
    WHEN v_can_enter_date THEN ARRAY['enter_date']::text[]
    WHEN v_ready_gate_status = 'both_ready' THEN ARRAY['enter_date']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'snapshot', true,
    'source', 'get_video_date_start_snapshot_v1',
    'session_id', v_session.id,
    'sessionId', v_session.id,
    'event_id', v_session.event_id,
    'eventId', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'partner_id', v_partner_id,
    'partnerId', v_partner_id,
    'viewer_id', v_uid,
    'viewerId', v_uid,
    'actor_role', v_actor_role,
    'actorRole', v_actor_role,
    'status', v_ready_gate_status,
    'ready_gate_status', v_ready_gate_status,
    'result_status', v_ready_gate_status,
    'result_ready_gate_status', v_ready_gate_status,
    'state', v_session.state,
    'phase', v_session.phase,
    'normalized_phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'seq', COALESCE(v_session.session_seq, 0),
    'session_seq', COALESCE(v_session.session_seq, 0),
    'ready_participant_1_at', v_session.ready_participant_1_at,
    'ready_participant_2_at', v_session.ready_participant_2_at,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'snoozed_by', v_session.snoozed_by,
    'snooze_expires_at', v_session.snooze_expires_at,
    'i_am_ready', v_i_am_ready,
    'iAmReady', v_i_am_ready,
    'partner_ready', v_partner_ready,
    'partnerReady', v_partner_ready,
    'is_both_ready', v_ready_gate_status = 'both_ready',
    'isBothReady', v_ready_gate_status = 'both_ready',
    'handshake_started_at', v_session.handshake_started_at,
    'date_started_at', v_session.date_started_at,
    'participant_1_joined_at', v_session.participant_1_joined_at,
    'participant_2_joined_at', v_session.participant_2_joined_at,
    'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
    'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
    'daily_room_name', v_session.daily_room_name,
    'daily_room_url', v_session.daily_room_url,
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'ended_at', v_session.ended_at,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END,
    'ended_reason', v_session.ended_reason,
    'endedReason', v_session.ended_reason,
    'inactive_reason', v_inactive_reason,
    'inactiveReason', v_inactive_reason,
    'can_mark_ready', v_can_mark_ready,
    'canMarkReady', v_can_mark_ready,
    'can_enter_date', v_can_enter_date,
    'canEnterDate', v_can_enter_date,
    'terminal', v_terminal,
    'retryable', v_retryable,
    'allowedActions', to_jsonb(v_allowed),
    'auxiliary_errors', v_auxiliary_errors,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms,
    'serverNow', v_server_now_ms
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'start_snapshot_failed',
      'error_code', 'START_SNAPSHOT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) IS
  'Participant-safe Video Date startup snapshot for Ready Gate/web/native startup. Bypasses fragile raw table reads while preserving participant and block checks.';

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260603150106_start_snapshot_base(uuid, text, text);
ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260603150106_start_snapshot_base;
REVOKE ALL ON FUNCTION public.ready_gate_transition_20260603150106_start_snapshot_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_snapshot jsonb;
  v_result jsonb;
  v_status text;
  v_message text;
  v_server_now_ms bigint;
BEGIN
  IF v_action = 'sync' THEN
    v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );

    RETURN COALESCE(v_snapshot, '{}'::jsonb) || jsonb_build_object(
      'success', COALESCE((v_snapshot->>'ok')::boolean, false),
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot
    );
  END IF;

  v_result := public.ready_gate_transition_20260603150106_start_snapshot_base(
    p_session_id,
    p_action,
    p_reason
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    BEGIN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_snapshot := NULL;
    END;
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_failed',
      'reason', 'ready_gate_transition_failed',
      'code', 'READY_GATE_TRANSITION_FAILED',
      'error_code', 'READY_GATE_TRANSITION_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'terminal', COALESCE((v_snapshot->>'terminal')::boolean, false),
      'startup_snapshot', v_snapshot,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Startup sync uses get_video_date_start_snapshot_v1; mutations delegate to the prior stack with structured error recovery.';

DROP FUNCTION IF EXISTS public.video_session_mark_ready_v2_20260603150106_start_snapshot_base(uuid, text, text);
ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  RENAME TO video_session_mark_ready_v2_20260603150106_start_snapshot_base;
REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260603150106_start_snapshot_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_result jsonb;
  v_status text;
  v_message text;
  v_server_now_ms bigint;
BEGIN
  v_before_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

  IF COALESCE((v_before_snapshot->>'ok')::boolean, false) = false
     AND COALESCE(v_before_snapshot->>'error', '') IN (
       'not_authenticated',
       'session_not_found',
       'not_participant',
       'blocked_pair',
       'safety_check_unavailable'
     ) THEN
    RETURN COALESCE(v_before_snapshot, '{}'::jsonb) || jsonb_build_object(
      'success', false,
      'commandStatus', 'rejected'
    );
  END IF;

  v_result := public.video_session_mark_ready_v2_20260603150106_start_snapshot_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  BEGIN
    v_after_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_after_snapshot := v_before_snapshot;
  END;

  v_status := COALESCE(
    v_result->>'ready_gate_status',
    v_result->>'status',
    v_result->>'result_ready_gate_status',
    v_result->>'result_status',
    v_after_snapshot->>'ready_gate_status',
    v_after_snapshot->>'status',
    v_before_snapshot->>'ready_gate_status',
    v_before_snapshot->>'status',
    'unknown'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'status', v_status,
    'ready_gate_status', v_status,
    'result_status', v_status,
    'result_ready_gate_status', v_status,
    'startup_snapshot', v_after_snapshot,
    'server_now_ms', COALESCE(v_after_snapshot->'server_now_ms', v_result->'server_now_ms'),
    'serverNowMs', COALESCE(v_after_snapshot->'serverNowMs', v_result->'serverNowMs')
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    BEGIN
      v_after_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_after_snapshot := v_before_snapshot;
    END;
    v_status := COALESCE(
      v_after_snapshot->>'ready_gate_status',
      v_after_snapshot->>'status',
      v_before_snapshot->>'ready_gate_status',
      v_before_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'mark_ready_failed',
      'reason', 'mark_ready_failed',
      'code', 'MARK_READY_FAILED',
      'error_code', 'MARK_READY_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'commandStatus', 'rejected',
      'terminal', COALESCE((v_after_snapshot->>'terminal')::boolean, false),
      'startup_snapshot', v_after_snapshot,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant mark-ready transition with startup snapshot preflight/postflight and structured fail-soft recovery for uncaught backend errors.';

DROP FUNCTION IF EXISTS public.record_vd_launch_latency_20260603150106_start_base(uuid, text, jsonb, integer);
ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  RENAME TO record_vd_launch_latency_20260603150106_start_base;
REVOKE ALL ON FUNCTION public.record_vd_launch_latency_20260603150106_start_base(uuid, text, jsonb, integer)
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
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
BEGIN
  RETURN public.record_vd_launch_latency_20260603150106_start_base(
    p_session_id,
    p_checkpoint,
    p_payload,
    p_latency_ms
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'checkpoint_failed',
      'error_code', 'CHECKPOINT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Fail-soft Video Date launch latency checkpoint. Telemetry failures return structured JSON and never block Ready Gate startup.';

DROP FUNCTION IF EXISTS public.get_profile_for_viewer_20260603150106_start_base(uuid);
ALTER FUNCTION public.get_profile_for_viewer(uuid)
  RENAME TO get_profile_for_viewer_20260603150106_start_base;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer_20260603150106_start_base(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_for_viewer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.get_profile_for_viewer_20260603150106_start_base(p_target_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Canonical safe other-user profile read. Returns NULL instead of raising if auxiliary profile helpers are degraded so display lookup cannot block Ready Gate startup.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid)
  TO authenticated, service_role;

ALTER TABLE public.video_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_sessions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.video_sessions
  FROM authenticated;
GRANT SELECT ON TABLE public.video_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_sessions TO service_role;

DROP POLICY IF EXISTS "Participants can view own sessions" ON public.video_sessions;
CREATE POLICY "Participants can view own sessions"
ON public.video_sessions
FOR SELECT
TO authenticated
USING (
  ((select auth.uid()) = participant_1_id OR (select auth.uid()) = participant_2_id)
  AND NOT public.is_blocked(participant_1_id, participant_2_id)
);

DROP POLICY IF EXISTS "Admins can view all video_sessions" ON public.video_sessions;
CREATE POLICY "Admins can view all video_sessions"
ON public.video_sessions
FOR SELECT
TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profiles_have_safety_block(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_has_established_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.viewer_shares_event_with_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_profile_discoverable(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_event_attendance_visible_to_viewer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
