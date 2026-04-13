-- Tighten promote_ready_gate_if_eligible: event validity, conflict guards,
-- deterministic locking (events share-lock → video_sessions row lock →
-- event_registrations FOR UPDATE in profile_id order), remove dead branch.

CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible(
  p_event_id uuid,
  p_uid uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match record;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low record;
  v_er_high record;
  v_self record;
  v_partner record;
  v_self_status text;
  v_self_foregrounded_at timestamptz;
  v_partner_status text;
  v_partner_foregrounded_at timestamptz;
  v_self_present boolean := false;
  v_partner_present boolean := false;
BEGIN
  -- 1) Share-lock the event row first so concurrent terminal transitions (end/cancel)
  --    cannot commit until this transaction completes.
  PERFORM 1
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.status = 'live'
    AND e.ended_at IS NULL
    AND e.status <> 'cancelled'
  FOR SHARE OF e;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'event_not_valid');
  END IF;

  -- 2) Lock a single queued session row (FIFO). Predicate matches full eligibility
  --    at selection time; revalidated after registration locks.
  SELECT vs.*
  INTO v_match
  FROM public.video_sessions vs
  INNER JOIN public.events e ON e.id = vs.event_id
  WHERE vs.event_id = p_event_id
    AND e.id = p_event_id
    AND e.status = 'live'
    AND e.ended_at IS NULL
    AND e.status <> 'cancelled'
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC
  LIMIT 1
  FOR UPDATE OF vs SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'no_queued_session');
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = p_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  -- 3) Lock both registration rows in deterministic order (min profile_id first)
  --    before any mutation to avoid deadlocks with other promotion paths.
  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
  END IF;

  IF v_er_low.profile_id = p_uid THEN
    v_self := v_er_low;
    v_partner := v_er_high;
  ELSE
    v_self := v_er_high;
    v_partner := v_er_low;
  END IF;

  IF v_self.admission_status IS DISTINCT FROM 'confirmed'
     OR v_partner.admission_status IS DISTINCT FROM 'confirmed' THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'admission_not_confirmed');
  END IF;

  v_self_status := v_self.queue_status;
  v_self_foregrounded_at := v_self.last_lobby_foregrounded_at;
  v_partner_status := v_partner.queue_status;
  v_partner_foregrounded_at := v_partner.last_lobby_foregrounded_at;

  v_self_present :=
    v_self_status IN ('browsing', 'idle')
    AND v_self_foregrounded_at IS NOT NULL
    AND v_self_foregrounded_at >= now() - interval '60 seconds';

  v_partner_present :=
    v_partner_status IN ('browsing', 'idle')
    AND v_partner_foregrounded_at IS NOT NULL
    AND v_partner_foregrounded_at >= now() - interval '60 seconds';

  IF NOT v_self_present THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'self_not_present');
  END IF;

  IF NOT v_partner_present THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'partner_not_present');
  END IF;

  -- 4) Re-check event is still valid under held locks (READ COMMITTED re-read).
  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.status = 'live'
      AND e.ended_at IS NULL
      AND e.status <> 'cancelled'
  ) THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'event_not_valid');
  END IF;

  -- 5) Queued session row must still match promotable predicate.
  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'session_not_promotable');
  END IF;

  -- 6) Neither participant may already be in another non-ended session in this event.
  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.id <> v_match.id
      AND z.ended_at IS NULL
      AND (
        z.participant_1_id IN (p_uid, v_partner_id)
        OR z.participant_2_id IN (p_uid, v_partner_id)
      )
  ) THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'participant_has_active_session_conflict');
  END IF;

  -- Promote
  UPDATE public.video_sessions
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = now() + interval '30 seconds',
    queued_expires_at = NULL
  WHERE id = v_match.id;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_match.id,
    current_partner_id = CASE
      WHEN profile_id = p_uid THEN v_partner_id
      ELSE p_uid
    END,
    last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (p_uid, v_partner_id);

  RETURN jsonb_build_object(
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id
  );
END;
$function$;
