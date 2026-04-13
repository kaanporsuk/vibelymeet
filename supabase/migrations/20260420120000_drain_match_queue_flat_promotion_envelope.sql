-- Stream 1C: align drain_match_queue JSON with the Phase 3 client contract while
-- keeping a single promotion implementation (promote_ready_gate_if_eligible).
--
-- 20260417120300_drain_match_queue_promotion.sql delegated correctly but wrapped
-- the helper payload under a nested "promotion" key, so web/native callers that
-- read top-level match_id / video_session_id / partner_id never saw a promotion.

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
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized');
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
    RETURN jsonb_build_object('found', false, 'queued', true);
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$function$;
