-- Sprint D: make half-verdict outcomes observable through the canonical verdict RPC.
-- The persistence semantics are unchanged: one verdict is saved immediately,
-- partner-later submission can complete the outcome idempotently, and matches
-- are only created by check_mutual_vibe_and_match when both users vibe.

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_target uuid;
  v_inner jsonb;
  v_persistent_created boolean;
  v_partner_verdict_recorded boolean := false;
  v_mutual boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    v_target := v_session.participant_2_id;
  ELSE
    v_target := v_session.participant_1_id;
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_uid, v_target) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'blocked', true
    );
  END IF;

  IF v_session.ended_at IS NULL
     OR v_session.date_started_at IS NULL
     OR COALESCE(v_session.ended_reason, '') IN (
       'ready_gate_forfeit',
       'ready_gate_expired',
       'queued_ttl_expired',
       'handshake_not_mutual',
       'handshake_grace_expired',
       'handshake_timeout',
       'blocked_pair'
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'verdict_recorded', false
    );
  END IF;

  INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
  VALUES (p_session_id, v_uid, v_target, p_liked)
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET
    liked = EXCLUDED.liked,
    target_id = EXCLUDED.target_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id = v_target
  ) INTO v_partner_verdict_recorded;

  v_inner := public.check_mutual_vibe_and_match(p_session_id);
  v_mutual := COALESCE((v_inner->>'mutual')::boolean, false);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object(
      'verdict_recorded', true,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
  END IF;

  v_persistent_created := NULL;
  IF v_mutual THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  IF NOT v_partner_verdict_recorded THEN
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_saved',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_pending',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
  ELSE
    PERFORM public.record_event_loop_observability(
      'post_date_pending_verdict_completed',
      'success',
      CASE WHEN v_mutual THEN 'mutual' ELSE 'not_mutual' END,
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'target_id', v_target,
        'mutual', v_mutual,
        'persistent_match_created', v_persistent_created
      )
    );
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records one verdict immediately, reports pending-partner state, emits pending/completed observability, and only creates persistent matches when both verdicts warrant it.';
