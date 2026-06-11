CREATE OR REPLACE FUNCTION private_video_date.vdt_terminal_lifecycle(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_attempt_id text := NULLIF(substring(COALESCE(p_reason, '') FROM '^entry_attempt:(.+)$'), '');
  v_result jsonb;
  v_protection jsonb;
BEGIN
  IF p_action = 'prepare_entry' THEN
    v_protection := public.video_date_protect_both_ready_entry_v1(
      p_session_id,
      v_actor,
      v_attempt_id,
      'video_date_transition_prepare_entry'
    );

    IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) IS FALSE
       AND COALESCE(v_protection ->> 'code', '') IN ('SESSION_NOT_FOUND', 'SESSION_ENDED', 'ACCESS_DENIED', 'EVENT_INACTIVE') THEN
      RETURN v_protection;
    END IF;
  END IF;

  v_result := private_video_date.vdt_routeable_entry(
    p_session_id,
    p_action,
    p_reason
  );

  IF p_action = 'prepare_entry'
     AND COALESCE(NULLIF(v_result ->> 'success', '')::boolean, false)
     AND COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
    v_result := v_result || jsonb_build_object(
      'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
      'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
      'prepare_entry_attempt_id', v_protection ->> 'prepare_entry_attempt_id',
      'daily_room_name', COALESCE(v_result ->> 'daily_room_name', v_protection ->> 'daily_room_name'),
      'daily_room_url', COALESCE(v_result ->> 'daily_room_url', v_protection ->> 'daily_room_url'),
      'ready_gate_expires_at', COALESCE(v_result ->> 'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at')
    );
  END IF;

  RETURN v_result;
END;
$function$
