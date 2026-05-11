-- Ensure call rows closed by unmatching preserve the acting participant so
-- clients can render accurate terminal call copy for unmatched_pair.

CREATE OR REPLACE FUNCTION public.unmatch_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_user_a uuid;
  v_user_b uuid;
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_archives_deleted int := 0;
  v_matches_deleted int := 0;
  v_match_calls_closed int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'code', 'already_unmatched', 'match_id', p_match_id);
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  v_user_a := v_match.profile_id_1;
  v_user_b := v_match.profile_id_2;

  UPDATE public.match_calls
  SET
    status = CASE WHEN status = 'ringing' THEN 'declined' ELSE 'ended' END,
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'unmatched_pair'),
    ended_by_user_id = COALESCE(ended_by_user_id, v_uid)
  WHERE match_id = p_match_id
    AND status IN ('ringing', 'active');
  GET DIAGNOSTICS v_match_calls_closed = ROW_COUNT;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE match_id = p_match_id
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND ds.match_id = p_match_id
    AND dp.status = 'active';
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE match_id = p_match_id
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  DELETE FROM public.match_archives
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_archives_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = p_match_id;
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'unmatched',
    'match_id', p_match_id,
    'unmatched_by', v_uid,
    'profile_id_1', v_user_a,
    'profile_id_2', v_user_b,
    'cleanup', jsonb_build_object(
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'archives_deleted', v_archives_deleted,
      'matches_deleted', v_matches_deleted,
      'match_calls_closed', v_match_calls_closed,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unmatch_match(uuid) TO authenticated;

COMMENT ON FUNCTION public.unmatch_match(uuid) IS
  'Atomically removes a match for both participants and cleans match-scoped messages, mutes, archive state, open calls, and date coordination rows. Open calls record unmatched_pair with ended_by_user_id set to the unmatching participant.';
