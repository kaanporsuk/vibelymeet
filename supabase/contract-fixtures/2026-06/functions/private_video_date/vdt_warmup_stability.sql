CREATE OR REPLACE FUNCTION private_video_date.vdt_warmup_stability(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Transparent delegate: errors propagate to the caller (HTTP error) so the
  -- existing web/native retry paths trigger. Do NOT add EXCEPTION WHEN OTHERS here.
  RETURN private_video_date.vdt_failsoft_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$
