-- Polish the 20260503090000 pair guard wrappers after cloud deployment.
--
-- The first cloud application exposed two renamed base functions with their
-- previous EXECUTE grants. Keep those bases callable only through the wrapped
-- SECURITY DEFINER entrypoints, and give the Ready Gate base a short name so
-- future schema diffs avoid PostgreSQL identifier truncation notices.

DO $$
BEGIN
  IF to_regprocedure('public.handle_swipe_20260503090000_encounter_guard_base(uuid,uuid,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.handle_swipe_20260503090000_encounter_guard_base(uuid, uuid, uuid, text)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.handle_swipe_20260503090000_encounter_guard_base(uuid, uuid, uuid, text)
      TO service_role;
  END IF;

  IF to_regprocedure('public.promote_ready_gate_202605030900_base(uuid,uuid)') IS NULL
     AND to_regprocedure('public.promote_ready_gate_if_eligible_20260503090000_encounter_guard_b(uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.promote_ready_gate_if_eligible_20260503090000_encounter_guard_b(uuid, uuid)
      RENAME TO promote_ready_gate_202605030900_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_202605030900_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_202605030900_base(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible(
  p_event_id uuid,
  p_uid uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_service_role boolean := auth.role() = 'service_role';
  v_active record;
  v_queued record;
  v_partner uuid;
BEGIN
  IF NOT v_is_service_role
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM p_uid) THEN
    RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
  END IF;

  SELECT
    vs.id,
    vs.participant_1_id,
    vs.participant_2_id,
    CASE WHEN vs.participant_1_id = p_uid THEN vs.participant_2_id ELSE vs.participant_1_id END AS partner_id
  INTO v_queued
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ended_at IS NULL
    AND vs.ready_gate_status = 'queued'
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_partner := v_queued.partner_id;

    IF public.video_date_pair_has_terminal_encounter(p_event_id, p_uid, v_partner, v_queued.id) THEN
      UPDATE public.video_sessions
      SET
        ended_at = COALESCE(ended_at, now()),
        ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
        state = 'ended'::public.video_date_state,
        phase = 'ended',
        state_updated_at = now()
      WHERE id = v_queued.id
        AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = now()
      WHERE event_id = p_event_id
        AND profile_id IN (p_uid, v_partner)
        AND (
          current_room_id = v_queued.id
          OR queue_status IN ('in_ready_gate', 'in_handshake', 'in_date')
        );

      PERFORM public.record_event_loop_observability(
        'promote_ready_gate_if_eligible',
        'blocked',
        'pair_already_met_this_event',
        NULL,
        p_event_id,
        p_uid,
        v_queued.id,
        jsonb_build_object(
          'partner_id', v_partner,
          'terminal_encounter_pair', true
        )
      );

      RETURN jsonb_build_object(
        'promoted', false,
        'reason', 'pair_already_met_this_event',
        'session_id', v_queued.id
      );
    END IF;
  END IF;

  RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_ready_gate_202605030900_base(uuid, uuid) IS
  'Prior Ready Gate promotion implementation wrapped by the 20260503090000 terminal encounter pair guard.';
