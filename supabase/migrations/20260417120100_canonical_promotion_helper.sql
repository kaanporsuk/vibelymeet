-- 20260413_canonical_promotion_helper.sql
-- Canonical promotion helper for mark_lobby_foreground and drain_match_queue

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
  v_partner_status text;
  v_partner_foregrounded_at timestamptz;
  v_self_status text;
  v_self_foregrounded_at timestamptz;
  v_self_present boolean := false;
  v_partner_present boolean := false;
BEGIN
  -- Check self registration and foreground
  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_self_status, v_self_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_uid
    AND er.admission_status = 'confirmed';

  v_self_present :=
    v_self_status IN ('browsing', 'idle')
    AND v_self_foregrounded_at IS NOT NULL
    AND v_self_foregrounded_at >= now() - interval '60 seconds';

  IF NOT v_self_present THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'self_not_present');
  END IF;

  -- Find queued session
  SELECT * INTO v_match
  FROM public.video_sessions
  WHERE event_id = p_event_id
    AND ready_gate_status = 'queued'
    AND ended_at IS NULL
    AND COALESCE(queued_expires_at, COALESCE(started_at, now()) + interval '10 minutes') > now()
    AND ((participant_1_id = p_uid) OR (participant_2_id = p_uid))
  ORDER BY started_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'no_queued_session');
  END IF;

  -- Find partner
  v_partner_id := CASE
    WHEN v_match.participant_1_id = p_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_partner_status, v_partner_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_partner_id
    AND er.admission_status = 'confirmed';

  v_partner_present :=
    v_partner_status IN ('browsing', 'idle')
    AND v_partner_foregrounded_at IS NOT NULL
    AND v_partner_foregrounded_at >= now() - interval '60 seconds';

  IF NOT v_partner_present THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'partner_not_present');
  END IF;

  -- Idempotent: only promote if not already ready
  IF v_match.ready_gate_status = 'ready' THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'already_ready');
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
