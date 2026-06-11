CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared(p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_success boolean := false;
BEGIN
  v_result := public.confirm_vde_prepared_202605031300_base(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );

  v_success := COALESCE((v_result ->> 'success')::boolean, false);

  IF v_success THEN
    UPDATE public.video_sessions
    SET
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL
    WHERE id = p_session_id
      AND (
        prepare_entry_started_at IS NOT NULL
        OR prepare_entry_expires_at IS NOT NULL
        OR prepare_entry_attempt_id IS NOT NULL
        OR prepare_entry_actor_id IS NOT NULL
      );
  END IF;

  RETURN v_result;
END;
$function$
