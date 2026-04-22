-- Forward migration: keep deprecated leave_matching_queue terminal session write
-- consistent with canonical video_sessions terminal invariant.

CREATE OR REPLACE FUNCTION public.leave_matching_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT current_partner_id INTO v_partner_id
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = v_uid;

  UPDATE public.event_registrations
  SET queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      dates_completed = dates_completed + CASE WHEN v_partner_id IS NOT NULL THEN 1 ELSE 0 END
  WHERE event_id = p_event_id AND profile_id = v_uid;

  IF v_partner_id IS NOT NULL THEN
    UPDATE public.event_registrations
    SET queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        dates_completed = dates_completed + 1
    WHERE event_id = p_event_id AND profile_id = v_partner_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = now(),
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - started_at)))::int)
      )
    WHERE event_id = p_event_id
      AND ((participant_1_id = v_uid AND participant_2_id = v_partner_id)
        OR (participant_2_id = v_uid AND participant_1_id = v_partner_id))
      AND ended_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deprecated', true,
    'surface', 'leave_matching_queue'
  );
END;
$function$;

COMMENT ON FUNCTION public.leave_matching_queue(uuid) IS
  'Deprecated in Phase 3 for active event flow; retained for compatibility cleanup calls.';
