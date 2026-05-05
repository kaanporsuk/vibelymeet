-- Ready Gate pre-ready room metadata repair.
--
-- Older Ready Gate overlays could call the Daily room warmup path before either
-- participant clicked ready. That persisted provider room metadata on otherwise
-- mutable ready_gate rows, causing the hardened ready_gate_transition guarded
-- update to reject mark_ready/snooze as no-longer-pre-date. Keep the public RPC
-- signature stable, repair only participant-owned stale pre-date metadata, then
-- delegate all transition semantics to the current hardened implementation.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260505140000_pre_ready_room_metadata_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260505140000_pre_ready_room_metadata_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505140000_pre_ready_room_metadata_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_terminal boolean;
  v_repair_count integer := 0;
BEGIN
  IF v_actor IS NOT NULL AND p_action IN ('mark_ready', 'snooze') THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
       AND v_session.ended_at IS NULL
       AND v_session.state = 'ready_gate'::public.video_date_state
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
       AND v_session.handshake_started_at IS NULL
       AND v_session.date_started_at IS NULL
       AND v_session.participant_1_joined_at IS NULL
       AND v_session.participant_2_joined_at IS NULL
       AND (
         v_session.daily_room_name IS NOT NULL
         OR v_session.daily_room_url IS NOT NULL
         OR v_session.daily_room_verified_at IS NOT NULL
         OR v_session.daily_room_expires_at IS NOT NULL
         OR v_session.daily_room_provider_verify_reason IS NOT NULL
       ) THEN
      UPDATE public.video_sessions
      SET
        daily_room_name = NULL,
        daily_room_url = NULL,
        daily_room_verified_at = NULL,
        daily_room_expires_at = NULL,
        daily_room_provider_verify_reason = NULL,
        state_updated_at = now()
      WHERE id = p_session_id
        AND ended_at IS NULL
        AND state = 'ready_gate'::public.video_date_state
        AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
        AND handshake_started_at IS NULL
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          daily_room_name IS NOT NULL
          OR daily_room_url IS NOT NULL
          OR daily_room_verified_at IS NOT NULL
          OR daily_room_expires_at IS NOT NULL
          OR daily_room_provider_verify_reason IS NOT NULL
        )
      RETURNING * INTO v_session;

      GET DIAGNOSTICS v_repair_count = ROW_COUNT;

      IF v_repair_count > 0 THEN
        PERFORM public.record_event_loop_observability(
          'ready_gate_transition',
          'success',
          'pre_ready_room_metadata_repaired',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', p_action,
            'p_reason', p_reason,
            'repaired_daily_room_metadata', true
          )
        );
      END IF;
    END IF;
  END IF;

  v_result := public.ready_gate_transition_20260505140000_pre_ready_room_metadata_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF v_actor IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN v_result;
  END IF;

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
  v_terminal := CASE
    WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
    ELSE v_session.ended_at IS NOT NULL
      OR v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'ready_participant_1_at', v_session.ready_participant_1_at,
    'ready_participant_2_at', v_session.ready_participant_2_at,
    'status', v_status,
    'ready_gate_status', v_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'snoozed_by', v_session.snoozed_by,
    'snooze_expires_at', v_session.snooze_expires_at,
    'terminal', v_terminal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Repairs stale pre-ready Daily room metadata before ready/snooze transitions, delegates unchanged transition semantics to the prior hardened implementation, and additively returns participant-safe Ready Gate truth.';
