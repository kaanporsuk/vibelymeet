-- 20260413_drain_match_queue_promotion.sql
-- Update drain_match_queue to use canonical promotion helper

CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_promotion jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized');
  END IF;

  PERFORM public.expire_stale_video_sessions();

  v_promotion := public.promote_ready_gate_if_eligible(p_event_id, v_uid);

  IF (v_promotion->>'promoted') = 'true' THEN
    RETURN jsonb_build_object('found', true, 'promotion', v_promotion);
  END IF;

  RETURN jsonb_build_object('found', false, 'promotion', v_promotion);
END;
$function$;
