-- Stream 1.11: expose stable `reason` on all `drain_match_queue` no-promotion outcomes
-- (mirrors `promote_ready_gate_if_eligible` `reason` values) for client transparency without prose.

CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_promotion jsonb;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  PERFORM public.expire_stale_video_sessions();

  v_promotion := public.promote_ready_gate_if_eligible(p_event_id, v_uid);

  IF (v_promotion->>'promoted') = 'true' THEN
    RETURN jsonb_build_object(
      'found', true,
      'match_id', v_promotion->>'match_id',
      'video_session_id', v_promotion->>'video_session_id',
      'event_id', v_promotion->>'event_id',
      'partner_id', v_promotion->>'partner_id'
    );
  END IF;

  v_reason := v_promotion->>'reason';

  IF v_reason IN ('self_not_present', 'partner_not_present') THEN
    RETURN jsonb_build_object('found', false, 'queued', true, 'reason', v_reason);
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'reason', COALESCE(v_reason, 'unknown')
  );
END;
$function$;
