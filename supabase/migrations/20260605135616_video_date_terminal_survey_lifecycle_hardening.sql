-- Harden terminal video-date survey continuity and terminal room forensics.
--
-- Findings from session 782f5eb6-497f-4fd8-9898-2f47cf939751:
-- - A confirmed encounter reached `date`, but a later client lifecycle write
--   changed one participant from `in_survey` to `offline` after the old
--   30-second protection window elapsed.
-- - The final terminal row lost canonical Daily room metadata even though the
--   deterministic room had existed during promotion and provider webhooks.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
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
     AND v_current_status IN ('in_ready_gate', 'in_handshake', 'in_date')
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
          vs.handshake_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
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

  UPDATE public.event_registrations
  SET queue_status = v_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_participant_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_participant_status(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.update_participant_status(uuid, text) IS
  'Client-writable participant presence. Server-owned video date states are protected; survey-required terminal encounters remain in_survey until feedback exists.';

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
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      'video_session_date_timeout_v2:already_ended_room_repair'
    );

    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'daily_room_name', v_before.daily_room_name,
      'daily_room_url', v_before.daily_room_url,
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
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      'video_session_date_timeout_v2:locked_already_ended_room_repair'
    );

    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'ended',
      'phase', 'ended',
      'already_ended', true,
      'reason', v_before.ended_reason,
      'daily_room_name', v_before.daily_room_name,
      'daily_room_url', v_before.daily_room_url,
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
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      'video_session_date_timeout_v2:replay_room_repair'
    );

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
      'daily_room_name', v_after.daily_room_name,
      'daily_room_url', v_after.daily_room_url,
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

  IF v_success THEN
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      'video_session_date_timeout_v2:post_transition_room_repair'
    );
  END IF;

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
        'reason', COALESCE(v_after.ended_reason, 'date_timeout'),
        'daily_room_name', v_after.daily_room_name
      ),
      jsonb_build_object(
        'state', v_after.state::text,
        'phase', v_after.phase,
        'reason', COALESCE(v_after.ended_reason, 'date_timeout'),
        'daily_room_name', v_after.daily_room_name
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
    'daily_room_name', v_after.daily_room_name,
    'daily_room_url', v_after.daily_room_url,
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_date_timeout_v2(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.video_session_date_timeout_v2(uuid, text, text) IS
  'Idempotent date-timeout transition with post-transition canonical Daily room repair for terminal forensics.';

COMMIT;
