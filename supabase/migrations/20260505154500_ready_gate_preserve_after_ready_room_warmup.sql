-- Preserve safe after-ready room warmup proof through the second ready tap.
--
-- The 20260505140000 repair wrapper deliberately clears pre-date Daily room
-- metadata before mark_ready/snooze so stale pre-ready warmup rows cannot block
-- the guarded Ready Gate transition. New clients warm the room only after one
-- participant has successfully marked ready. When that fresh canonical proof is
-- present on ready_a/ready_b and the next mark_ready reaches both_ready, restore
-- it after the delegated transition so prepare_date_entry can skip the provider
-- GET without weakening the stale pre-ready repair.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260505154500_preserve_after_ready_room_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260505154500_preserve_after_ready_room_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505154500_preserve_after_ready_room_base(uuid, text, text)
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
  v_now timestamptz := now();
  v_before public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_can_restore boolean := false;
  v_restored public.video_sessions%ROWTYPE;
BEGIN
  IF v_actor IS NOT NULL AND p_action = 'mark_ready' THEN
    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_can_restore := FOUND
      AND (v_before.participant_1_id = v_actor OR v_before.participant_2_id = v_actor)
      AND v_before.ended_at IS NULL
      AND v_before.state = 'ready_gate'::public.video_date_state
      AND v_before.ready_gate_status IN ('ready_a', 'ready_b')
      AND (v_before.ready_participant_1_at IS NOT NULL OR v_before.ready_participant_2_at IS NOT NULL)
      AND v_before.handshake_started_at IS NULL
      AND v_before.date_started_at IS NULL
      AND v_before.participant_1_joined_at IS NULL
      AND v_before.participant_2_joined_at IS NULL
      AND v_before.daily_room_name = v_expected_room_name
      AND v_before.daily_room_url IS NOT NULL
      AND v_before.daily_room_url LIKE ('%/' || v_expected_room_name)
      AND v_before.daily_room_verified_at IS NOT NULL
      AND v_before.daily_room_verified_at >= v_now - interval '90 seconds'
      AND v_before.daily_room_expires_at IS NOT NULL
      AND v_before.daily_room_expires_at > v_now + interval '60 seconds';
  END IF;

  v_result := public.ready_gate_transition_20260505154500_preserve_after_ready_room_base(
    p_session_id,
    p_action,
    p_reason
  );

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

  IF v_can_restore
     AND COALESCE((v_result->>'success')::boolean, false)
     AND v_status = 'both_ready' THEN
    UPDATE public.video_sessions
    SET
      daily_room_name = v_before.daily_room_name,
      daily_room_url = v_before.daily_room_url,
      daily_room_verified_at = v_before.daily_room_verified_at,
      daily_room_expires_at = v_before.daily_room_expires_at,
      daily_room_provider_verify_reason = COALESCE(
        v_before.daily_room_provider_verify_reason,
        'ready_gate_after_ready_room_warmup'
      ),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
    RETURNING * INTO v_restored;

    IF FOUND THEN
      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        'success',
        'after_ready_room_metadata_preserved_for_both_ready',
        NULL,
        v_restored.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
          'daily_room_name', v_restored.daily_room_name,
          'daily_room_verified_at', v_restored.daily_room_verified_at,
          'daily_room_expires_at', v_restored.daily_room_expires_at,
          'provider_verify_skip_eligible', true
        )
      );

      RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'daily_room_name', v_restored.daily_room_name,
        'daily_room_url', v_restored.daily_room_url,
        'daily_room_verified_at', v_restored.daily_room_verified_at,
        'daily_room_expires_at', v_restored.daily_room_expires_at,
        'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Preserves fresh canonical after-ready room warmup proof through both_ready while delegating stale pre-ready metadata repair and transition semantics to the prior hardened implementation.';
