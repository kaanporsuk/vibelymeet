CREATE OR REPLACE FUNCTION public.ready_gate_transition(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_status text;
  v_server_now_ms bigint;
  v_message text;
BEGIN
  IF v_action = 'mark_ready' THEN
    RETURN public.video_session_mark_ready_v2(
      p_session_id,
      p_session_id::text || ':phase3:mark_ready:legacy_ready_gate_transition',
      NULL
    ) || jsonb_build_object('legacy_ready_gate_transition_bridge', true);
  END IF;

  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
       AND (
         v_session.ready_gate_expires_at IS NULL
         OR v_session.ready_gate_expires_at > now()
         OR v_session.ready_gate_status = 'both_ready'
       )
       AND (
         v_session.ready_gate_status <> 'snoozed'
         OR v_session.snooze_expires_at IS NULL
         OR v_session.snooze_expires_at > now()
       ) THEN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

      IF NULLIF(COALESCE(v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'), '') IS NULL THEN
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
    END IF;
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
      'startup_snapshot', v_snapshot,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$
