CREATE OR REPLACE FUNCTION private_video_date.vdt_remote_seen(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_success boolean := false;
  v_session public.video_sessions%ROWTYPE;
BEGIN
  v_result := private_video_date.vdt_prepare_payload(
    p_session_id,
    p_action,
    p_reason
  );

  IF p_action IS DISTINCT FROM 'prepare_entry' THEN
    RETURN v_result;
  END IF;

  v_success := CASE
    WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean
    ELSE false
  END;

  IF NOT v_success OR v_actor IS NULL THEN
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

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'state', v_session.state::text,
    'phase', v_session.phase,
    'ended_at', v_session.ended_at,
    'ended_reason', v_session.ended_reason,
    'handshake_started_at', v_session.handshake_started_at,
    'date_started_at', v_session.date_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'daily_room_name', v_session.daily_room_name,
    'daily_room_url', v_session.daily_room_url,
    'daily_room_verified_at', v_session.daily_room_verified_at,
    'daily_room_expires_at', v_session.daily_room_expires_at,
    'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason
  );
END;
$function$
