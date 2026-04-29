-- Ready Gate registration overwrite guard.
--
-- The previous hardening removed client authority to create server-owned
-- statuses, but a refresh/unmount path could still write a non-session status
-- such as `offline` over an active `in_ready_gate` registration. Keep presence
-- updates client-writable only while the row is not attached to server-owned
-- Ready Gate / video-date lifecycle state.

CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid,
  p_status text
) RETURNS void
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
  v_has_recent_joined_end boolean := false;
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

  IF v_status = 'offline' AND v_current_status = 'in_survey' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND v_uid IN (vs.participant_1_id, vs.participant_2_id)
        AND vs.ended_at IS NOT NULL
        AND vs.ended_at > now() - interval '30 seconds'
        AND (
          vs.handshake_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state, 'ended'::public.video_date_state)
        )
    )
    INTO v_has_recent_joined_end;

    IF v_has_recent_joined_end THEN
      RETURN;
    END IF;
  END IF;

  UPDATE public.event_registrations
  SET queue_status = v_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_participant_status(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_participant_status(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.update_participant_status(uuid, text) IS
  'Client-writable event presence/status with Ready Gate and video-date route statuses excluded and protected from lifecycle overwrite while a server-owned room is active.';

CREATE OR REPLACE FUNCTION public.prevent_client_session_registration_state_overwrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.current_room_id IS DISTINCT FROM OLD.current_room_id
       OR NEW.current_partner_id IS DISTINCT FROM OLD.current_partner_id THEN
      RETURN NULL;
    END IF;

    IF NEW.queue_status IS DISTINCT FROM OLD.queue_status
       AND (
         OLD.queue_status IN ('in_ready_gate', 'in_handshake', 'in_date')
         OR NEW.queue_status IN ('in_ready_gate', 'in_handshake', 'in_date')
       ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS event_registrations_prevent_client_session_state_overwrite
  ON public.event_registrations;

CREATE TRIGGER event_registrations_prevent_client_session_state_overwrite
BEFORE UPDATE OF queue_status, current_room_id, current_partner_id
ON public.event_registrations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_session_registration_state_overwrite();

COMMENT ON TRIGGER event_registrations_prevent_client_session_state_overwrite
  ON public.event_registrations IS
  'Blocks direct anon/authenticated updates from creating, clearing, or rehoming Ready Gate / video-date registration state; server-owned RPCs and service-role flows continue to own those columns.';
