-- PR 1189 Codex review follow-up.
--
-- The event-active mark-ready preflight must set the same local lock and
-- statement timeouts as the hot path before taking its row lock.

BEGIN;

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
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb := '{}'::jsonb;
  v_status text;
  v_date_capable boolean := false;
  v_message text;
BEGIN
  PERFORM set_config('lock_timeout', '1200ms', true);
  PERFORM set_config('statement_timeout', '7000ms', true);

  IF p_session_id IS NULL OR v_actor IS NULL THEN
    RETURN public.video_session_mark_ready_v2_20260604131708_event_active_base(
      p_session_id,
      p_idempotency_key,
      p_request_hash
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF FOUND
     AND v_session.event_id IS NOT NULL
     AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
     AND v_session.ended_at IS NULL
     AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
     AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
     AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NOT NULL THEN
      v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_status := COALESCE(v_after.ready_gate_status, v_session.ready_gate_status, 'ended');
      v_date_capable := (
        v_after.handshake_started_at IS NOT NULL
        OR v_after.date_started_at IS NOT NULL
        OR v_after.daily_room_name IS NOT NULL
        OR v_after.daily_room_url IS NOT NULL
        OR v_after.participant_1_joined_at IS NOT NULL
        OR v_after.participant_2_joined_at IS NOT NULL
        OR v_after.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR COALESCE(v_after.phase, '') IN ('handshake', 'date')
      );

      IF v_after.ended_at IS NOT NULL
         OR v_status IN ('expired', 'cancelled', 'ended', 'forfeited') THEN
        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'ready_gate_expires_at', v_after.ready_gate_expires_at,
          'reason', COALESCE(v_after.ended_reason, 'ready_gate_event_ended'),
          'error_code', COALESCE(v_after.ended_reason, 'ready_gate_event_ended'),
          'inactive_reason', v_inactive_reason,
          'terminal', true,
          'event_id', v_after.event_id,
          'event_active_preflight_blocked', true,
          'cleanup', v_cleanup,
          'commandStatus', 'rejected',
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'event_not_active',
        'code', 'EVENT_NOT_ACTIVE',
        'error_code', 'EVENT_NOT_ACTIVE',
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'status', v_status,
        'ready_gate_status', v_status,
        'result_status', v_status,
        'result_ready_gate_status', v_status,
        'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
        'date_capable', v_date_capable,
        'retryable', false,
        'terminal', false,
        'event_id', COALESCE(v_after.event_id, v_session.event_id),
        'event_active_preflight_blocked', true,
        'cleanup', v_cleanup,
        'commandStatus', 'rejected',
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;
  END IF;

  RETURN public.video_session_mark_ready_v2_20260604131708_event_active_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'mark_ready_event_active_preflight_failed',
      'reason', 'mark_ready_event_active_preflight_failed',
      'code', 'MARK_READY_EVENT_ACTIVE_PREFLIGHT_FAILED',
      'error_code', 'MARK_READY_EVENT_ACTIVE_PREFLIGHT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'terminal', false,
      'event_active_preflight_degraded', true,
      'commandStatus', 'rejected',
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
  'Ready Gate mark-ready RPC with event-active preflight timeouts, original-attempt grace cap, retryable replay preservation, and standardized response fields.';

NOTIFY pgrst, 'reload schema';

COMMIT;
