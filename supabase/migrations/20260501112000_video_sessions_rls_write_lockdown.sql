-- Sprint B: Video Date backend integrity hardening.
-- Keep video_sessions server-owned and keep route/status truth out of
-- client-writable presence updates.

ALTER TABLE public.video_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can create video sessions" ON public.video_sessions;
DROP POLICY IF EXISTS "Participants can update own feedback" ON public.video_sessions;
DROP POLICY IF EXISTS "Participants can update own video sessions" ON public.video_sessions;
DROP POLICY IF EXISTS "Participants can delete own video sessions" ON public.video_sessions;
DROP POLICY IF EXISTS "Users can update video sessions" ON public.video_sessions;
DROP POLICY IF EXISTS "Users can delete video sessions" ON public.video_sessions;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.video_sessions
  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.video_sessions
  FROM authenticated;

COMMENT ON TABLE public.video_sessions IS
  'Server-owned Video Date session state. Authenticated clients may SELECT through participant/admin RLS policies, but direct writes are blocked; canonical writes use SECURITY DEFINER RPCs and service-role Edge Functions.';

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
    'in_ready_gate',
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

  IF v_status IN ('browsing', 'idle', 'in_ready_gate', 'offline')
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
  'Client-writable event presence/status with server-owned video-date route statuses excluded; in_handshake and in_date are set only by video-date state-machine RPCs.';
