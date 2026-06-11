CREATE OR REPLACE FUNCTION public.finalize_video_date_entry_deadline(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.finalize_video_date_handshake_deadline(p_session_id, p_actor, p_source, p_reason);
END;
$function$
