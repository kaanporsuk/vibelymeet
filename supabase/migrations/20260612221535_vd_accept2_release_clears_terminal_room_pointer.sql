-- VD acceptance follow-up round 2 (item 2a): releasing a registration whose
-- current_room_id points at a terminal session also clears the room/partner
-- pointers. Previously update_participant_status changed only queue_status,
-- leaving released rows as e.g. 'browsing' + current_room_id=<dead session>
-- (observed live in both 2026-06-12 production runs). Benign today because all
-- consumers key on queue_status AND current_room_id together, but a dangling
-- pointer is a trap for any future reader keying on current_room_id alone.
-- Survey continuity is unaffected: in_survey writes never clear, and the
-- pending-survey guard above still refuses premature releases. Full live-body
-- recreate; base dumped from live 2026-06-12, patched at two sites.

CREATE OR REPLACE FUNCTION public.update_participant_status(p_event_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clear_room boolean := false;
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
          vs.entry_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
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

  -- A release status reaching this point with a room pointer at a terminal
  -- session means the pointer is stale bookkeeping: clear it so nothing can
  -- later key on current_room_id alone (2026-06-12 acceptance follow-up 2a).
  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND (
          vs.ended_at IS NOT NULL
          OR vs.state::text = 'ended'
          OR COALESCE(vs.phase, '') = 'ended'
        )
    )
    INTO v_clear_room;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    last_active_at = now(),
    current_room_id = CASE WHEN v_clear_room THEN NULL ELSE current_room_id END,
    current_partner_id = CASE WHEN v_clear_room THEN NULL ELSE current_partner_id END
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$
;
