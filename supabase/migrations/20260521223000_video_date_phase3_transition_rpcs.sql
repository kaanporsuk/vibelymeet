-- Vibely Video Date v4 Phase 3.1-3.3 transition RPCs.
--
-- PR 3.1: video_session_mark_ready_v2
-- PR 3.2: video_session_forfeit_v2
-- PR 3.3: video_session_continue_handshake_v2
--
-- These participant-facing RPCs wrap the existing battle-tested transition
-- state machines with v4 command idempotency, visibility-aware event append,
-- explicit session_seq bumps, and provider outbox instructions. They never
-- mint or persist Daily tokens; token issuance remains Edge-owned.

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
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:mark_ready');
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_status text;
  v_changed boolean := false;
  v_actor_role text;
  v_event jsonb := '{}'::jsonb;
  v_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'mark_ready',
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

  v_transition := public.ready_gate_transition(p_session_id, 'mark_ready', NULL);
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
  v_actor_role := CASE
    WHEN v_actor = v_after.participant_1_id THEN 'participant_1'
    WHEN v_actor = v_after.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_changed :=
    v_success
    AND (
      v_before.ready_gate_status IS DISTINCT FROM v_after.ready_gate_status
      OR v_before.ready_participant_1_at IS DISTINCT FROM v_after.ready_participant_1_at
      OR v_before.ready_participant_2_at IS DISTINCT FROM v_after.ready_participant_2_at
    );

  IF v_changed THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      CASE WHEN v_status = 'both_ready' THEN 'ready_gate_both_ready' ELSE 'ready_gate_mark_ready' END,
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'mark_ready',
        'ready_gate_status', v_status,
        'actor_role', v_actor_role
      ),
      jsonb_build_object(
        'ready_gate_status', v_status,
        'actor_role', v_actor_role
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  IF v_success AND v_status = 'both_ready' THEN
    PERFORM public.video_date_outbox_enqueue_v2(
      p_session_id,
      'daily.ensure_video_date_room',
      jsonb_build_object(
        'roomName', COALESCE(NULLIF(v_after.daily_room_name, ''), v_room_name),
        'source', 'video_session_mark_ready_v2'
      ),
      'phase3:ensure_room:' || p_session_id::text,
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

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Phase 3.1 participant mark-ready transition. Wraps ready_gate_transition with v4 command idempotency, participant-safe events, session_seq bumps, and token-free Daily room outbox enqueue.';

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
        'reason', v_reason,
        'actor_role', v_actor_role
      ),
      jsonb_build_object(
        'ready_gate_status', v_status,
        'reason', v_reason,
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
    'reason', v_reason,
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
  'Phase 3.2 participant Ready Gate forfeit transition. Sanitizes participant-visible reason, wraps ready_gate_transition with v4 command idempotency, and enqueues token-free room cleanup.';

CREATE OR REPLACE FUNCTION public.video_session_continue_handshake_v2(
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
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:continue_handshake');
  v_request jsonb := jsonb_build_object('action', 'continue_handshake');
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_actor_role text;
  v_actor_decision_changed boolean := false;
  v_advanced_to_date boolean := false;
  v_event jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'continue_handshake',
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

    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash',
      'state', COALESCE(v_after.state::text, COALESCE(v_begin->'result', '{}'::jsonb)->>'state'),
      'phase', COALESCE(v_after.phase, COALESCE(v_begin->'result', '{}'::jsonb)->>'phase'),
      'date_started_at', COALESCE(
        to_jsonb(v_after.date_started_at),
        COALESCE(v_begin->'result', '{}'::jsonb)->'date_started_at'
      ),
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

  v_transition := public.video_date_transition(p_session_id, 'vibe', NULL);
  v_success := COALESCE(
    jsonb_typeof(v_transition->'success') = 'boolean'
      AND (v_transition->>'success')::boolean,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_actor_role := CASE
    WHEN v_actor = v_after.participant_1_id THEN 'participant_1'
    WHEN v_actor = v_after.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_actor_decision_changed := v_success AND (
    (
      v_actor = v_after.participant_1_id
      AND v_before.participant_1_decided_at IS NULL
      AND v_after.participant_1_decided_at IS NOT NULL
    )
    OR (
      v_actor = v_after.participant_2_id
      AND v_before.participant_2_decided_at IS NULL
      AND v_after.participant_2_decided_at IS NOT NULL
    )
  );
  v_advanced_to_date := v_success AND (
    v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
    OR v_before.state::text IS DISTINCT FROM v_after.state::text
    OR v_before.phase IS DISTINCT FROM v_after.phase
  ) AND (v_after.state::text = 'date' OR v_after.phase = 'date');

  IF v_advanced_to_date THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'handshake_continued_to_date',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'continue_handshake',
        'state', v_after.state::text,
        'phase', v_after.phase,
        'date_started_at', v_after.date_started_at
      ),
      jsonb_build_object(
        'state', v_after.state::text,
        'phase', v_after.phase,
        'date_started_at', v_after.date_started_at
      ),
      true,
      gen_random_uuid()
    );
  ELSIF v_actor_decision_changed THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'handshake_continue_recorded',
      'actor_only',
      v_actor,
      jsonb_build_object(
        'action', 'continue_handshake',
        'actor_role', v_actor_role,
        'state', v_after.state::text,
        'phase', v_after.phase
      ),
      jsonb_build_object(
        'actor_role', v_actor_role,
        'state', v_after.state::text,
        'phase', v_after.phase
      ),
      false,
      gen_random_uuid()
    );
  END IF;

  v_result := COALESCE(v_transition, '{}'::jsonb) || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash',
    'state', v_after.state::text,
    'phase', v_after.phase,
    'date_started_at', v_after.date_started_at,
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

REVOKE ALL ON FUNCTION public.video_session_continue_handshake_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_continue_handshake_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_continue_handshake_v2(uuid, text, text) IS
  'Phase 3.3 participant early-continue handshake transition. Wraps the legacy Vibe decision with v4 command idempotency; one-sided interest is actor-only, mutual continue is participant-visible.';
