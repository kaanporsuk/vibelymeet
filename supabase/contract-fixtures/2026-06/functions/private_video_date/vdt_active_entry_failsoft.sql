CREATE OR REPLACE FUNCTION private_video_date.vdt_active_entry_failsoft(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := private_video_date.vdt_both_ready_owner(
    p_session_id,
    p_action,
    p_reason
  );

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'both_ready_route_owner_checked', lower(COALESCE(NULLIF(btrim(p_action), ''), '')) = 'prepare_entry'
    ),
    'video_date_transition.both_ready_owner'
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_exception_payload_v2(
      p_session_id,
      v_actor,
      'video_date_transition.both_ready_owner',
      'video_date_transition_failed',
      'VIDEO_DATE_TRANSITION_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$
