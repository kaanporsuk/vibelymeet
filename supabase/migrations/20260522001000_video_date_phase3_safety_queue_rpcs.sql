-- Vibely Video Date v4 Phase 3.8-3.10 safety + queue transition RPCs.
--
-- PR 3.8: submit_video_date_safety_report_v2
-- PR 3.9: drain_match_queue_v2
-- PR 3.10: web/mobile adapters are wired in client code behind default-off flags.
--
-- Principles:
-- - Daily tokens are never created or stored here.
-- - Report details live only in user_reports for safety review.
-- - video_session_commands request_payload stores hashes/booleans only.
-- - Participant-visible events are generic and sanitized.
-- - Queue promotion revalidates both participants in the same transaction.

CREATE OR REPLACE FUNCTION public.submit_video_date_safety_report_v2(
  p_session_id uuid,
  p_reason text,
  p_details text DEFAULT NULL,
  p_also_block boolean DEFAULT false,
  p_end_session boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_target uuid;
  v_reason text := lower(btrim(COALESCE(p_reason, '')));
  v_details text := NULLIF(left(btrim(COALESCE(p_details, '')), 4000), '');
  v_details_hash text;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
  v_transition jsonb := '{}'::jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_request jsonb;
  v_result jsonb;
  v_success boolean := true;
  v_delete_room_name text;
  v_was_ended boolean := false;
  v_ended boolean := false;
  v_survey_required boolean := false;
  v_transition_error text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
  END IF;

  IF v_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reason');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_actor IS DISTINCT FROM v_session.participant_1_id
     AND v_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  v_target := CASE
    WHEN v_session.participant_1_id = v_actor THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;
  v_was_ended := COALESCE(
    v_session.ended_at IS NOT NULL
      OR v_session.state::text = 'ended'
      OR v_session.phase = 'ended',
    false
  );
  v_details_hash := CASE WHEN v_details IS NULL THEN NULL ELSE md5(v_details) END;

  v_request := jsonb_build_object(
    'reason', v_reason,
    'has_details', v_details IS NOT NULL,
    'details_hash', v_details_hash,
    'also_block', COALESCE(p_also_block, false),
    'end_session', COALESCE(p_end_session, false),
    'reported_id', v_target
  );

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'safety_report',
    v_key,
    v_request,
    NULL
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
      'commandStatus', v_begin->>'status',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb)
      || jsonb_build_object(
        'idempotent', true,
        'requestHash', v_begin->>'requestHash',
        'commandStatus', v_begin->>'status'
      );
  END IF;

  IF v_begin->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  SELECT count(*)::int
  INTO v_recent
  FROM public.user_reports
  WHERE reporter_id = v_actor
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  INSERT INTO public.user_reports (
    reporter_id,
    reported_id,
    reason,
    details,
    also_blocked
  )
  VALUES (
    v_actor,
    v_target,
    v_reason,
    v_details,
    COALESCE(p_also_block, false)
  )
  RETURNING id INTO v_report_id;

  PERFORM public.record_event_profile_impression_v2(
    v_session.event_id,
    v_actor,
    v_target,
    'reported',
    'video_date_safety_v2',
    p_session_id,
    jsonb_build_object('report_id', v_report_id)
  );

  PERFORM public.append_video_session_event_v2(
    p_session_id,
    'video_date_safety_report_recorded',
    'safety_review',
    v_actor,
    jsonb_build_object(
      'report_id', v_report_id,
      'reporter_id', v_actor,
      'reported_id', v_target,
      'reason', v_reason,
      'has_details', v_details IS NOT NULL,
      'details_hash', v_details_hash,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false)
    ),
    jsonb_build_object(
      'report_recorded', true,
      'report_id', v_report_id,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false)
    ),
    false,
    gen_random_uuid()
  );

  PERFORM public.append_video_session_event_v2(
    p_session_id,
    'video_date_safety_report_submitted',
    'actor_only',
    v_actor,
    jsonb_build_object(
      'report_id', v_report_id,
      'reported_id', v_target,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false)
    ),
    jsonb_build_object(
      'report_recorded', true,
      'report_id', v_report_id,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false)
    ),
    false,
    gen_random_uuid()
  );

  IF COALESCE(p_also_block, false) THEN
    PERFORM public.record_event_profile_impression_v2(
      v_session.event_id,
      v_actor,
      v_target,
      'blocked',
      'video_date_safety_v2',
      p_session_id,
      jsonb_build_object('report_id', v_report_id)
    );

    v_block_result := public.block_user_with_cleanup(
      v_target,
      'Reported during video date',
      NULL
    );
  ELSIF COALESCE(p_end_session, false) AND v_session.ended_at IS NULL THEN
    v_transition := public.video_date_transition(p_session_id, 'end', 'ended_from_client');
    IF COALESCE((v_transition->>'success')::boolean, false) IS FALSE THEN
      v_success := false;
      v_transition_error := COALESCE(
        NULLIF(v_transition->>'error', ''),
        NULLIF(v_transition->>'reason', ''),
        'safety_end_transition_rejected'
      );
    END IF;
  END IF;

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_ended := COALESCE(v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended', false);
  v_survey_required := COALESCE((v_transition->>'survey_required')::boolean, false);
  IF NOT v_survey_required
     AND COALESCE(p_end_session, false)
     AND NOT COALESCE(p_also_block, false)
     AND v_ended THEN
    v_survey_required := public.video_date_session_is_post_date_survey_eligible(
      v_after.ended_at,
      v_after.ended_reason,
      v_after.date_started_at,
      v_after.state::text,
      v_after.phase,
      v_after.participant_1_joined_at,
      v_after.participant_2_joined_at
    );

    IF v_survey_required THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_after.participant_1_id THEN v_after.participant_2_id
          ELSE v_after.participant_1_id
        END,
        last_active_at = now()
      WHERE event_id = v_after.event_id
        AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id);
    END IF;
  END IF;
  v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_session.daily_room_name, ''));

  IF (COALESCE(p_end_session, false) OR COALESCE(p_also_block, false))
     AND v_ended
     AND NOT v_was_ended THEN
    PERFORM public.append_video_session_event_v2(
      p_session_id,
      'video_date_ended',
      'participants',
      v_actor,
      jsonb_build_object(
        'source', 'participant_end',
        'state', v_after.state::text,
        'phase', v_after.phase
      ),
      jsonb_build_object(
        'source', 'participant_end',
        'state', v_after.state::text,
        'phase', v_after.phase
      ),
      true,
      gen_random_uuid()
    );

    IF v_delete_room_name IS NOT NULL THEN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'daily.delete_video_date_room',
        jsonb_build_object(
          'roomName', v_delete_room_name,
          'sessionId', p_session_id::text,
          'source', 'submit_video_date_safety_report_v2'
        ),
        'phase3:safety_delete_room:' || p_session_id::text,
        now()
      );
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'success', v_success,
    'safety_report_recorded', true,
    'report_id', v_report_id,
    'reported_id', v_target,
    'also_blocked', COALESCE(p_also_block, false),
    'ended', v_ended,
    'survey_required', v_survey_required,
    'state', v_after.state::text,
    'phase', v_after.phase,
    'ended_at', v_after.ended_at,
    'block', v_block_result
  ) || CASE
    WHEN v_success THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'error', COALESCE(v_transition_error, 'safety_report_command_rejected')
    )
  END;

  PERFORM public.video_session_command_finish_v2(
    v_command_id,
    v_actor,
    CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    v_result
  );

  RETURN v_result || jsonb_build_object(
    'idempotent', false,
    'requestHash', v_begin->>'requestHash',
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text) IS
  'Phase 3.8 in-call video-date safety transition. Stores report details only in user_reports, records command idempotency with hashed details, emits safety_review/actor-only events, and can end the session without leaking report reasons to participants.';

CREATE OR REPLACE FUNCTION public.drain_match_queue_v2(
  p_event_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_active record;
  v_inactive_reason text;
  v_match public.video_sessions%ROWTYPE;
  v_existing_command public.video_session_commands%ROWTYPE;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low public.event_registrations%ROWTYPE;
  v_er_high public.event_registrations%ROWTYPE;
  v_self public.event_registrations%ROWTYPE;
  v_partner public.event_registrations%ROWTYPE;
  v_self_runtime public.event_participant_runtime_state%ROWTYPE;
  v_partner_runtime public.event_participant_runtime_state%ROWTYPE;
  v_self_runtime_ok boolean := false;
  v_partner_runtime_ok boolean := false;
  v_begin jsonb;
  v_command_id bigint;
  v_request jsonb;
  v_result jsonb;
  v_event jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      NULL,
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('found', false, 'success', false, 'error', 'invalid_idempotency_key', 'reason', 'invalid_idempotency_key');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_session_command:' || v_actor::text || ':' || v_key, 0)
  );

  SELECT *
  INTO v_existing_command
  FROM public.video_session_commands
  WHERE actor = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_command.command_kind IS DISTINCT FROM 'drain_match_queue'
       OR v_existing_command.request_payload->>'event_id' IS DISTINCT FROM p_event_id::text THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', 'idempotency_conflict',
        'commandStatus', 'idempotency_conflict',
        'existingSessionId', v_existing_command.session_id,
        'existingCommandKind', v_existing_command.command_kind,
        'existingRequestHash', v_existing_command.request_hash
      );
    END IF;

    v_begin := public.video_session_command_begin_v2(
      v_existing_command.session_id,
      v_actor,
      'drain_match_queue',
      v_key,
      COALESCE(v_existing_command.request_payload, '{}'::jsonb),
      v_existing_command.request_hash
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
        'commandStatus', v_begin->>'status',
        'requestHash', v_begin->>'requestHash'
      );
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      RETURN COALESCE(v_begin->'result', '{}'::jsonb)
        || jsonb_build_object(
          'idempotent', true,
          'requestHash', v_begin->>'requestHash',
          'commandStatus', v_begin->>'status'
        );
    END IF;

    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object('inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  SELECT vs.*
  INTO v_match
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = v_actor OR vs.participant_2_id = v_actor)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1
  FOR UPDATE OF vs SKIP LOCKED;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'no_queued_session',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object('step', 'pick_queued_session')
    );
    RETURN jsonb_build_object('found', false, 'reason', 'no_queued_session');
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = v_actor THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(v_actor, v_partner_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(v_actor, v_partner_id)::text,
      0
    )
  );

  v_request := jsonb_build_object(
    'event_id', p_event_id,
    'queued_session_id', v_match.id,
    'partner_id', v_partner_id
  );

  v_begin := public.video_session_command_begin_v2(
    v_match.id,
    v_actor,
    'drain_match_queue',
    v_key,
    v_request,
    NULL
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
      'commandStatus', v_begin->>'status',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb)
      || jsonb_build_object(
        'idempotent', true,
        'requestHash', v_begin->>'requestHash',
        'commandStatus', v_begin->>'status'
      );
  END IF;

  IF v_begin->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, v_actor, v_partner_id, v_match.id) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'pair_already_met_this_event',
      'session_id', v_match.id,
      'video_session_id', v_match.id
    );

    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'pair_already_met_this_event',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id, 'terminal_encounter_pair', true)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_er_low.profile_id = v_actor THEN
    v_self := v_er_low;
    v_partner := v_er_high;
  ELSE
    v_self := v_er_high;
    v_partner := v_er_low;
  END IF;

  IF v_self.admission_status IS DISTINCT FROM 'confirmed'
     OR v_partner.admission_status IS DISTINCT FROM 'confirmed' THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'admission_not_confirmed'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'admission_not_confirmed');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_self_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_actor
  FOR UPDATE;

  v_self_runtime_ok := FOUND
    AND v_self_runtime.foreground IS TRUE
    AND v_self_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_self_runtime.readiness_status IN ('ready', 'warning');

  SELECT *
  INTO v_partner_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_partner_id
  FOR UPDATE;

  v_partner_runtime_ok := FOUND
    AND v_partner_runtime.foreground IS TRUE
    AND v_partner_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_partner_runtime.readiness_status IN ('ready', 'warning');

  IF NOT v_self_runtime_ok THEN
    UPDATE public.event_registrations
    SET
      last_lobby_foregrounded_at = now(),
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id = v_actor;

    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'self_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'self_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_self_runtime.foreground, false),
        'readiness_status', v_self_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_self_runtime.last_heartbeat_at))::int
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF NOT v_partner_runtime_ok THEN
    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'partner_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'partner_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_partner_runtime.foreground, false),
        'readiness_status', v_partner_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_partner_runtime.last_heartbeat_at))::int
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF public.is_blocked(v_actor, v_partner_id)
     OR EXISTS (
       SELECT 1
       FROM public.user_reports ur
       WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
          OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
     ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'blocked_or_reported_pair'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'browsing',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'blocked_or_reported_pair');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'blocked_or_reported_pair',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, v_inactive_reason),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'queued_session_not_promotable'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'session_not_promotable');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.id <> v_match.id
      AND (
        z.participant_1_id IN (v_actor, v_partner_id)
        OR z.participant_2_id IN (v_actor, v_partner_id)
      )
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'participant_has_active_session_conflict'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'participant_has_active_session_conflict');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  UPDATE public.video_sessions
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = now() + interval '30 seconds',
    queued_expires_at = NULL,
    state_updated_at = now()
  WHERE id = v_match.id;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_match.id,
    current_partner_id = CASE
      WHEN profile_id = v_actor THEN v_partner_id
      ELSE v_actor
    END,
    last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (v_actor, v_partner_id);

  PERFORM public.record_event_profile_impression_v2(
    p_event_id,
    v_actor,
    v_partner_id,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  INSERT INTO public.event_profile_impressions (
    event_id,
    viewer_id,
    target_id,
    last_action,
    strongest_exclusion_reason,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  )
  ON CONFLICT (event_id, viewer_id, target_id) DO UPDATE
  SET
    last_action = EXCLUDED.last_action,
    last_action_at = now(),
    strongest_exclusion_reason = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN EXCLUDED.strongest_exclusion_reason
      ELSE event_profile_impressions.strongest_exclusion_reason
    END,
    source = EXCLUDED.source,
    session_id = COALESCE(EXCLUDED.session_id, event_profile_impressions.session_id),
    metadata = event_profile_impressions.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.event_profile_impression_events (
    event_id,
    viewer_id,
    target_id,
    action,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  v_event := public.append_video_session_event_v2(
    v_match.id,
    'queue_promoted_to_ready_gate',
    'participants',
    v_actor,
    jsonb_build_object(
      'event_id', p_event_id,
      'partner_id', v_partner_id,
      'ready_gate_status', 'ready'
    ),
    jsonb_build_object(
      'event_id', p_event_id,
      'ready_gate_status', 'ready'
    ),
    true,
    gen_random_uuid()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_actor,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_actor::text,
    now()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_partner_id,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_partner_id::text,
    now()
  );

  v_result := jsonb_build_object(
    'found', true,
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id,
    'ready_gate_status', 'ready',
    'event', v_event
  );

  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'drain_match_queue_v2',
    'success',
    NULL,
    v_ms,
    p_event_id,
    v_actor,
    v_match.id,
    jsonb_build_object(
      'promoted', true,
      'partner_id', v_partner_id,
      'runtime_revalidated', true,
      'queued_sessions_browseable', true
    )
  );

  RETURN v_result || jsonb_build_object(
    'idempotent', false,
    'requestHash', v_begin->>'requestHash',
    'commandStatus', 'committed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue_v2(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_v2(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue_v2(uuid, text) IS
  'Phase 3.9 queue-drain promotion. Selects the oldest queued session, then atomically revalidates runtime heartbeat/readiness, block/report exclusions, active-session absence, and registration state before promoting to Ready Gate with v4 command idempotency.';
