-- Vibely Video Date v4 Phase 3.4-3.7 remaining transition RPCs.
--
-- PR 3.4: video_session_handshake_auto_promote_v2
-- PR 3.5: video_session_date_timeout_v2
-- PR 3.6: submit_post_date_verdict_v3
-- PR 3.7: video_session_extend_date_v2
--
-- These functions keep Postgres as product truth, keep Daily as a media
-- provider, and keep Daily tokens out of tables, events, command payloads, and
-- outbox rows. They are additive, feature-flag ready, and compatible with the
-- existing legacy state machines.

CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(
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
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:handshake_auto_promote');
  v_request jsonb := jsonb_build_object('action', 'handshake_auto_promote');
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_event jsonb := '{}'::jsonb;
  v_delete_room_name text;
  v_seconds_remaining integer := NULL;
  v_state_changed boolean := false;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_actor IS DISTINCT FROM v_before.participant_1_id
     AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.state::text = 'date'
     OR v_before.phase = 'date'
     OR v_before.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_before.date_started_at,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.handshake_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', COALESCE(v_before.state::text, 'unknown'),
      'phase', COALESCE(v_before.phase, 'unknown'),
      'reason', 'handshake_not_started',
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_seconds_remaining := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM ((v_before.handshake_started_at + interval '60 seconds') - now())))::int
  );

  IF v_seconds_remaining > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'handshake',
      'phase', 'handshake',
      'reason', 'handshake_auto_promote_not_due',
      'seconds_remaining', v_seconds_remaining,
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.state::text = 'date'
     OR v_before.phase = 'date'
     OR v_before.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_before.date_started_at,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.handshake_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', COALESCE(v_before.state::text, 'unknown'),
      'phase', COALESCE(v_before.phase, 'unknown'),
      'reason', 'handshake_not_started',
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_seconds_remaining := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM ((v_before.handshake_started_at + interval '60 seconds') - now())))::int
  );

  IF v_seconds_remaining > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'handshake',
      'phase', 'handshake',
      'reason', 'handshake_auto_promote_not_due',
      'seconds_remaining', v_seconds_remaining,
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'handshake_auto_promote',
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
      'date_started_at', COALESCE(to_jsonb(v_after.date_started_at), COALESCE(v_begin->'result', '{}'::jsonb)->'date_started_at'),
      'reason', COALESCE(v_after.ended_reason, COALESCE(v_begin->'result', '{}'::jsonb)->>'reason'),
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
  WHERE id = p_session_id
  FOR UPDATE;

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

  v_transition := public.finalize_video_date_handshake_deadline(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2',
    'handshake_auto_promote'
  );
  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_transition->'success') = 'boolean' THEN (v_transition->>'success')::boolean ELSE NULL END,
    CASE WHEN jsonb_typeof(v_transition->'ok') = 'boolean' THEN (v_transition->>'ok')::boolean ELSE NULL END,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_state_changed := v_success AND (
    v_before.state::text IS DISTINCT FROM v_after.state::text
    OR v_before.phase IS DISTINCT FROM v_after.phase
    OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
    OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
    OR v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
  );

  IF v_state_changed AND (v_after.state::text = 'date' OR v_after.phase = 'date') THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'handshake_auto_promoted_to_date',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'handshake_auto_promote',
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
  ELSIF v_state_changed AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended') THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'handshake_auto_promoted_terminal',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'handshake_auto_promote',
        'state', v_after.state::text,
        'phase', v_after.phase,
        'reason', v_after.ended_reason
      ),
      jsonb_build_object(
        'state', v_after.state::text,
        'phase', v_after.phase,
        'reason', v_after.ended_reason
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_before.daily_room_name, ''));
  IF v_success
     AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended')
     AND v_delete_room_name IS NOT NULL THEN
    PERFORM public.video_date_outbox_enqueue_v2(
      p_session_id,
      'daily.delete_video_date_room',
      jsonb_build_object(
        'roomName', v_delete_room_name,
        'source', 'video_session_handshake_auto_promote_v2'
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
    'state', COALESCE(v_after.state::text, COALESCE(v_transition->>'state', 'unknown')),
    'phase', COALESCE(v_after.phase, COALESCE(v_transition->>'phase', 'unknown')),
    'date_started_at', v_after.date_started_at,
    'reason', COALESCE(v_after.ended_reason, v_transition->>'reason'),
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

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text) IS
  'Phase 3.4 participant-safe handshake deadline finalizer. Does not write a command before the deadline is due, preserving retries under clock skew.';

CREATE OR REPLACE FUNCTION public.video_session_date_timeout_v2(
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
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:date_timeout');
  v_request jsonb := jsonb_build_object('action', 'date_timeout');
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_event jsonb := '{}'::jsonb;
  v_delete_room_name text;
  v_seconds_remaining integer := NULL;
  v_state_changed boolean := false;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_actor IS DISTINCT FROM v_before.participant_1_id
     AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.date_started_at IS NULL
     OR (v_before.state::text IS DISTINCT FROM 'date' AND v_before.phase IS DISTINCT FROM 'date') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', COALESCE(v_before.state::text, 'unknown'),
      'phase', COALESCE(v_before.phase, 'unknown'),
      'reason', 'not_in_date_phase',
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_seconds_remaining := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM (
      (v_before.date_started_at + ((300 + COALESCE(v_before.date_extra_seconds, 0)) * interval '1 second')) - now()
    )))::int
  );

  IF v_seconds_remaining > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'date',
      'phase', 'date',
      'reason', 'date_timeout_not_due',
      'seconds_remaining', v_seconds_remaining,
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  IF v_before.date_started_at IS NULL
     OR (v_before.state::text IS DISTINCT FROM 'date' AND v_before.phase IS DISTINCT FROM 'date') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', COALESCE(v_before.state::text, 'unknown'),
      'phase', COALESCE(v_before.phase, 'unknown'),
      'reason', 'not_in_date_phase',
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_seconds_remaining := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM (
      (v_before.date_started_at + ((300 + COALESCE(v_before.date_extra_seconds, 0)) * interval '1 second')) - now()
    )))::int
  );

  IF v_seconds_remaining > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'date',
      'phase', 'date',
      'reason', 'date_timeout_not_due',
      'seconds_remaining', v_seconds_remaining,
      'retryable', true,
      'session_seq', COALESCE(v_before.session_seq, 0)
    );
  END IF;

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'date_timeout',
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
      'reason', COALESCE(v_after.ended_reason, COALESCE(v_begin->'result', '{}'::jsonb)->>'reason'),
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
  WHERE id = p_session_id
  FOR UPDATE;

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

  v_transition := public.video_date_transition(p_session_id, 'end', 'date_timeout');
  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_transition->'success') = 'boolean' THEN (v_transition->>'success')::boolean ELSE NULL END,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_state_changed := v_success AND (
    v_before.state::text IS DISTINCT FROM v_after.state::text
    OR v_before.phase IS DISTINCT FROM v_after.phase
    OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
    OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
  );

  IF v_state_changed AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended') THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'date_timeout_ended',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'date_timeout',
        'state', v_after.state::text,
        'phase', v_after.phase,
        'reason', COALESCE(v_after.ended_reason, 'date_timeout')
      ),
      jsonb_build_object(
        'state', v_after.state::text,
        'phase', v_after.phase,
        'reason', COALESCE(v_after.ended_reason, 'date_timeout')
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_before.daily_room_name, ''));
  IF v_success
     AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended')
     AND v_delete_room_name IS NOT NULL THEN
    PERFORM public.video_date_outbox_enqueue_v2(
      p_session_id,
      'daily.delete_video_date_room',
      jsonb_build_object(
        'roomName', v_delete_room_name,
        'source', 'video_session_date_timeout_v2'
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
    'state', COALESCE(v_after.state::text, COALESCE(v_transition->>'state', 'unknown')),
    'phase', COALESCE(v_after.phase, COALESCE(v_transition->>'phase', 'unknown')),
    'reason', COALESCE(v_after.ended_reason, v_transition->>'reason', 'date_timeout'),
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

REVOKE ALL ON FUNCTION public.video_session_date_timeout_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_date_timeout_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_date_timeout_v2(uuid, text, text) IS
  'Phase 3.5 participant-safe date timeout transition. Does not write a command before the server-owned date deadline is due.';

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3(
  p_session_id uuid,
  p_liked boolean,
  p_idempotency_key text,
  p_safety_report jsonb DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_report_hash text := CASE
    WHEN p_safety_report IS NULL THEN NULL
    ELSE md5(p_safety_report::text)
  END;
  v_request jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_result jsonb;
  v_actor_result jsonb;
  v_success boolean := false;
  v_session public.video_sessions%ROWTYPE;
  v_visibility text := 'actor_only';
  v_kind text := 'post_date_verdict_recorded';
  v_event_payload jsonb;
  v_event jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'not_authenticated');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_request := jsonb_build_object(
    'action', 'submit_verdict',
    'liked', p_liked,
    'has_safety_report', p_safety_report IS NOT NULL,
    'safety_report_hash', v_report_hash
  );

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'submit_verdict',
    v_key,
    v_request,
    p_request_hash
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
      'success', false,
      'ok', false,
      'commandStatus', COALESCE(v_begin->>'status', 'rejected')
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'idempotent', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  v_result := public.submit_post_date_verdict_v2(
    p_session_id,
    p_liked,
    v_key,
    p_safety_report
  );
  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
    true
  );

  v_actor_result := COALESCE(v_result, '{}'::jsonb) - 'block' || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'backend_version', 'v3',
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash'
  );

  IF v_success AND COALESCE((v_result->>'idempotent')::boolean, false) IS FALSE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF COALESCE((v_result->>'awaiting_partner_verdict')::boolean, false) IS FALSE THEN
      v_visibility := 'participants';
      v_kind := 'post_date_verdict_resolved';
    END IF;

    v_event_payload := jsonb_build_object(
      'action', 'submit_verdict',
      'verdict_recorded', COALESCE((v_result->>'verdict_recorded')::boolean, true),
      'awaiting_partner_verdict', COALESCE((v_result->>'awaiting_partner_verdict')::boolean, false),
      'partner_verdict_recorded', COALESCE((v_result->>'partner_verdict_recorded')::boolean, false),
      'mutual', COALESCE((v_result->>'mutual')::boolean, false),
      'persistent_match_created', CASE
        WHEN v_result ? 'persistent_match_created' THEN v_result->'persistent_match_created'
        ELSE 'null'::jsonb
      END,
      'match_id', v_result->>'match_id'
    );

    v_event := public.append_video_session_event_v2(
      p_session_id,
      v_kind,
      v_visibility,
      v_actor,
      v_event_payload,
      v_event_payload,
      v_visibility = 'participants',
      gen_random_uuid()
    );

    IF p_safety_report IS NOT NULL AND COALESCE((v_result->>'safety_report_recorded')::boolean, false) THEN
      PERFORM public.append_video_session_event_v2(
        p_session_id,
        'post_date_safety_report_recorded',
        'safety_review',
        v_actor,
        jsonb_build_object(
          'action', 'submit_safety_report',
          'report_id', v_result->>'report_id',
          'reported_participant_role', CASE
            WHEN v_actor = v_session.participant_1_id THEN 'participant_2'
            WHEN v_actor = v_session.participant_2_id THEN 'participant_1'
            ELSE NULL
          END
        ),
        jsonb_build_object(
          'action', 'submit_safety_report',
          'report_id', v_result->>'report_id'
        ),
        false,
        gen_random_uuid()
      );
    END IF;

    v_actor_result := v_actor_result || jsonb_build_object(
      'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_session.session_seq)
    );
  END IF;

  PERFORM public.video_session_command_finish_v2(
    v_command_id,
    v_actor,
    CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    v_actor_result
  );
  RETURN v_actor_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text) IS
  'Phase 3.6 post-date verdict wrapper. Adds v4 command idempotency conflict detection without storing safety report details in video_session_commands or participant-visible events.';

CREATE OR REPLACE FUNCTION public.video_session_extend_date_v2(
  p_session_id uuid,
  p_credit_type text,
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
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
  v_add_seconds integer;
  v_key text;
  v_request jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_spend jsonb;
  v_success boolean := false;
  v_required_until timestamptz;
  v_event jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_add_seconds := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_credit_type');
  END IF;

  v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_idempotency_key');
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_actor IS DISTINCT FROM v_before.participant_1_id
     AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_ended');
  END IF;

  IF v_before.date_started_at IS NULL
     OR (v_before.state::text IS DISTINCT FROM 'date' AND v_before.phase IS DISTINCT FROM 'date') THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_in_date_phase');
  END IF;

  v_required_until :=
    v_before.date_started_at
    + ((300 + COALESCE(v_before.date_extra_seconds, 0) + v_add_seconds + 120 + 600) * interval '1 second');

  IF v_before.daily_room_expires_at IS NULL OR v_before.daily_room_expires_at <= v_required_until THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_room_expiring_before_extension',
      'room_refresh_required', true,
      'required_until', v_required_until,
      'daily_room_expires_at', v_before.daily_room_expires_at
    );
  END IF;

  v_request := jsonb_build_object(
    'action', 'extension',
    'credit_type', v_credit_type
  );

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'extension',
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
      'date_extra_seconds', COALESCE(v_after.date_extra_seconds, (COALESCE(v_begin->'result', '{}'::jsonb)->>'date_extra_seconds')::integer),
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

  v_spend := public.spend_video_date_credit_extension(
    p_session_id,
    v_credit_type,
    v_key
  );
  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_spend->'success') = 'boolean' THEN (v_spend->>'success')::boolean ELSE NULL END,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_success AND COALESCE((v_spend->>'idempotent')::boolean, false) IS FALSE THEN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      'date_extension_applied',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'extension',
        'credit_type', v_credit_type,
        'added_seconds', COALESCE(NULLIF(v_spend->>'added_seconds', '')::integer, v_add_seconds),
        'date_extra_seconds', COALESCE(v_after.date_extra_seconds, NULLIF(v_spend->>'date_extra_seconds', '')::integer)
      ),
      jsonb_build_object(
        'credit_type', v_credit_type,
        'added_seconds', COALESCE(NULLIF(v_spend->>'added_seconds', '')::integer, v_add_seconds),
        'date_extra_seconds', COALESCE(v_after.date_extra_seconds, NULLIF(v_spend->>'date_extra_seconds', '')::integer)
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  v_result := COALESCE(v_spend, '{}'::jsonb) || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'backend_version', 'v2',
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash',
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

REVOKE ALL ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text) IS
  'Phase 3.7 credit extension wrapper. Refuses to charge unless the known Daily room expiry covers base date, existing extensions, requested extension, reconnect grace, and cleanup buffer.';
