-- Follow-up for Codex review comments on PRs #1262 through #1280.
-- Keep applied migration history intact; repair the active wrappers and the
-- live data shapes that can still be corrected safely.

WITH candidate AS (
  SELECT
    er.event_id,
    er.profile_id,
    er.current_room_id,
    CASE
      WHEN vs.participant_1_id = er.profile_id THEN vs.participant_2_id
      ELSE vs.participant_1_id
    END AS expected_partner_id,
    CASE
      WHEN vs.phase = 'date' OR vs.state = 'date' THEN 'in_date'
      WHEN vs.phase = 'handshake' OR vs.state = 'handshake' OR vs.ready_gate_status = 'both_ready' THEN 'in_handshake'
      ELSE 'in_ready_gate'
    END AS expected_queue_status
  FROM public.event_registrations er
  JOIN public.video_sessions vs
    ON vs.id = er.current_room_id
   AND vs.event_id = er.event_id
   AND er.profile_id IN (vs.participant_1_id, vs.participant_2_id)
  WHERE vs.ended_at IS NULL
    AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
    AND (
      er.current_partner_id IS DISTINCT FROM CASE
        WHEN vs.participant_1_id = er.profile_id THEN vs.participant_2_id
        ELSE vs.participant_1_id
      END
      OR COALESCE(er.queue_status, 'idle') IN ('idle', 'browsing', 'queued')
    )
)
UPDATE public.event_registrations er
SET
  current_partner_id = candidate.expected_partner_id,
  queue_status = candidate.expected_queue_status,
  last_active_at = now(),
  updated_at = now()
FROM candidate
WHERE er.event_id = candidate.event_id
  AND er.profile_id = candidate.profile_id
  AND er.current_room_id = candidate.current_room_id;

CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_outcome text;
  v_session_id_text text;
  v_session_id uuid;
  v_status text;
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
BEGIN
  v_result := public.handle_swipe_20260610000100_auto_next_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );

  v_outcome := COALESCE(v_result->>'result', v_result->>'outcome', v_result->>'error');

  IF v_outcome IS DISTINCT FROM 'match_queued' THEN
    RETURN v_result;
  END IF;

  v_session_id_text := COALESCE(v_result->>'video_session_id', v_result->>'match_id');

  IF v_session_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_result || jsonb_build_object(
      'queue_removed_conversion', 'skipped_invalid_session_id'
    );
  END IF;

  v_session_id := v_session_id_text::uuid;

  UPDATE public.video_sessions vs
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = COALESCE(vs.ready_gate_expires_at, now() + interval '30 seconds'),
    queued_expires_at = NULL,
    state_updated_at = now()
  WHERE vs.id = v_session_id
    AND vs.event_id = p_event_id
    AND vs.participant_1_id = LEAST(p_actor_id, p_target_id)
    AND vs.participant_2_id = GREATEST(p_actor_id, p_target_id)
    AND vs.ended_at IS NULL
    AND vs.ready_gate_status = 'queued'
  RETURNING vs.ready_gate_status INTO v_status;

  IF v_status IS NULL THEN
    SELECT vs.ready_gate_status
    INTO v_status
    FROM public.video_sessions vs
    WHERE vs.id = v_session_id
      AND vs.event_id = p_event_id
      AND vs.participant_1_id = LEAST(p_actor_id, p_target_id)
      AND vs.participant_2_id = GREATEST(p_actor_id, p_target_id)
      AND vs.ended_at IS NULL;
  END IF;

  IF v_status IS DISTINCT FROM 'ready' THEN
    RETURN v_result || jsonb_build_object(
      'queue_removed_conversion', 'skipped_unpromoted_session',
      'ready_gate_status', v_status
    );
  END IF;

  UPDATE public.event_registrations er
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_session_id,
    current_partner_id = CASE
      WHEN er.profile_id = p_actor_id THEN p_target_id
      ELSE p_actor_id
    END,
    last_active_at = now(),
    updated_at = now()
  WHERE er.event_id = p_event_id
    AND er.profile_id IN (p_actor_id, p_target_id)
    AND COALESCE(er.queue_status, 'idle') NOT IN ('in_handshake', 'in_date', 'in_survey');

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'handle_swipe',
    'success',
    'match_queued_promoted_after_auto_next_removal',
    v_ms,
    p_event_id,
    p_actor_id,
    v_session_id,
    jsonb_build_object(
      'swipe_type', p_swipe_type,
      'mutual', true,
      'immediate', true,
      'previous_result', 'match_queued',
      'auto_next_removed', true
    )
  );

  RETURN v_result || jsonb_build_object(
    'success', true,
    'result', 'match',
    'outcome', 'match',
    'match_id', v_session_id,
    'video_session_id', v_session_id,
    'event_id', p_event_id,
    'immediate', true,
    'ready_gate_status', 'ready',
    'queue_removed_conversion', 'match_queued_promoted_to_ready_gate'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text) IS
  'Swipe mutation base wrapper. Direct mutual match opens Ready Gate; legacy match_queued fallback is promoted to a Ready Gate session after auto-next removal.';
