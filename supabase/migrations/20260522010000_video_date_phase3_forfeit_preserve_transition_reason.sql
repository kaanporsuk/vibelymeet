-- Preserve the wrapped Ready Gate transition reason in video_session_forfeit_v2.
-- The original Phase 3 wrapper overwrote transition-specific rejection reasons
-- (for example event_not_active) with the sanitized caller-supplied forfeit
-- reason, which made clients and observability misclassify terminal failures.

CREATE OR REPLACE FUNCTION public.video_session_forfeit_v2(
  p_session_id uuid,
  p_reason text DEFAULT NULL,
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
  v_reason text := lower(btrim(COALESCE(p_reason, 'ready_gate_forfeit')));
  v_key text;
  v_request jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_status text;
  v_actor_role text;
  v_changed boolean := false;
  v_event jsonb := '{}'::jsonb;
  v_delete_room_name text;
  v_result_reason text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  IF v_reason NOT IN ('ready_gate_forfeit', 'not_now', 'timeout', 'skip', 'user_exit', 'manual_exit') THEN
    v_reason := 'ready_gate_forfeit';
  END IF;

  v_key := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:forfeit');
  v_request := jsonb_build_object('action', 'forfeit', 'reason', v_reason);

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'forfeit',
    v_key,
    v_request,
    p_request_hash
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'commandStatus', COALESCE(v_begin->>'status', 'rejected')
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_status := COALESCE(
      v_after.ready_gate_status,
      COALESCE(v_begin->'result', '{}'::jsonb)->>'ready_gate_status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'result_ready_gate_status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'result_status'
    );

    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash',
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'reason', COALESCE(v_after.ended_reason, COALESCE(v_begin->'result', '{}'::jsonb)->>'reason', v_reason),
      'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
    );
  END IF;

  IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash'
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result;
  END IF;

  v_transition := public.ready_gate_transition(p_session_id, 'forfeit', v_reason);
  v_success := COALESCE(
    jsonb_typeof(v_transition->'success') = 'boolean'
      AND (v_transition->>'success')::boolean,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_status := COALESCE(
    v_transition->>'ready_gate_status',
    v_transition->>'status',
    v_transition->>'result_ready_gate_status',
    v_transition->>'result_status',
    v_after.ready_gate_status
  );
  v_result_reason := COALESCE(
    NULLIF(v_transition->>'reason', ''),
    NULLIF(v_transition->>'error', ''),
    NULLIF(v_after.ended_reason, ''),
    v_reason
  );
  v_actor_role := CASE
    WHEN v_actor = v_after.participant_1_id THEN 'participant_1'
    WHEN v_actor = v_after.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_changed :=
    v_success
    AND (
      v_before.ready_gate_status IS DISTINCT FROM v_after.ready_gate_status
      OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
      OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
    );

  IF v_changed THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'ready_gate_forfeited',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'forfeit',
        'ready_gate_status', v_status,
        'reason', v_result_reason,
        'actor_role', v_actor_role
      ),
      jsonb_build_object(
        'ready_gate_status', v_status,
        'reason', v_result_reason,
        'actor_role', v_actor_role
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_before.daily_room_name, ''));
  IF v_success
     AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended' OR v_status = 'forfeited')
     AND v_delete_room_name IS NOT NULL THEN
    PERFORM public.video_date_outbox_enqueue_v2(
      p_session_id,
      'daily.delete_video_date_room',
      jsonb_build_object(
        'roomName', v_delete_room_name,
        'source', 'video_session_forfeit_v2'
      ),
      'phase3:delete_room:' || p_session_id::text,
      now()
    );
  END IF;

  v_result := COALESCE(v_transition, '{}'::jsonb) || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash',
    'status', v_status,
    'ready_gate_status', v_status,
    'result_status', v_status,
    'result_ready_gate_status', v_status,
    'reason', v_result_reason,
    'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq)
  );

  PERFORM public.video_session_command_finish_v2(
    v_command_id,
    v_actor,
    CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_forfeit_v2(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_forfeit_v2(uuid, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_forfeit_v2(uuid, text, text, text) IS
  'Phase 3.2 participant Ready Gate forfeit transition. Preserves wrapped transition rejection reasons while retaining v4 command idempotency and token-free room cleanup.';
