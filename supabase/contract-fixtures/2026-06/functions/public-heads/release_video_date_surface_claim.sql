CREATE OR REPLACE FUNCTION public.release_video_date_surface_claim(p_session_id uuid, p_client_instance_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  UPDATE public.video_date_surface_claims
  SET released_at = COALESCE(released_at, v_now), updated_at = v_now
  WHERE profile_id = v_uid
    AND session_id = p_session_id
    AND client_instance_id = v_client_instance_id
    AND released_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'released', v_count);
END;
$function$
