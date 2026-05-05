-- Repair Ready Gate queue promotion lock ordering.
--
-- The queued-browse repair selected the FIFO queued video_sessions row with
-- FOR UPDATE SKIP LOCKED before taking participant advisory locks. handle_swipe
-- takes participant advisory locks before touching video_sessions, so promotion
-- needs the same effective lock order to avoid deadlocks under concurrent swipe
-- and queue-drain activity.

DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid, uuid);
ALTER FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  RENAME TO promote_ready_gate_if_eligible_20260505223000_lock_order_base;
REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible(
  p_event_id uuid,
  p_uid uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_service_role boolean := auth.role() = 'service_role';
  v_candidate record;
  v_partner_id uuid;
  v_locked_candidate_id uuid;
BEGIN
  IF NOT v_is_service_role
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM p_uid) THEN
    RETURN public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(p_event_id, p_uid);
  END IF;

  SELECT vs.id, vs.participant_1_id, vs.participant_2_id
  INTO v_candidate
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(p_event_id, p_uid);
  END IF;

  v_partner_id := CASE
    WHEN v_candidate.participant_1_id = p_uid THEN v_candidate.participant_2_id
    ELSE v_candidate.participant_1_id
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_uid, v_partner_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_uid, v_partner_id)::text,
      0
    )
  );

  SELECT vs.id
  INTO v_locked_candidate_id
  FROM public.video_sessions vs
  WHERE vs.id = v_candidate.id
    AND vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (
      (vs.participant_1_id = p_uid AND vs.participant_2_id = v_partner_id)
      OR (vs.participant_1_id = v_partner_id AND vs.participant_2_id = p_uid)
    )
  FOR UPDATE OF vs;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'session_not_promotable'
    );
  END IF;

  RETURN public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(p_event_id, p_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) IS
  'Promotes queued Ready Gate matches with participant advisory locks acquired before video_sessions row locks; delegates to the queued-browse promotion body after lock-order revalidation.';
