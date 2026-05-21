-- Phase 1 client wiring: persist local Ready Gate suppression so refresh,
-- reconnect, and mobile background recovery cannot immediately reopen the
-- same manually dismissed gate.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS ready_gate_suppressed_session_id uuid;

COMMENT ON COLUMN public.event_registrations.ready_gate_suppressed_session_id IS
  'Session-scopes ready_gate_suppressed_until so dismissing one Ready Gate never hides a later Ready Gate.';

CREATE OR REPLACE FUNCTION public.persist_ready_gate_suppression_v2(
  p_session_id uuid,
  p_suppressed_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT
    id,
    event_id,
    participant_1_id,
    participant_2_id,
    ended_at,
    state,
    phase,
    handshake_started_at,
    date_started_at
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  IF v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.state::text IN ('handshake', 'date')
     OR v_session.phase IN ('handshake', 'date') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready_gate');
  END IF;

  v_until := COALESCE(p_suppressed_until, now() + interval '45 seconds');
  IF v_until <= now() THEN
    v_until := now() + interval '45 seconds';
  END IF;
  v_until := LEAST(v_until, now() + interval '5 minutes');

  UPDATE public.event_registrations
  SET
    ready_gate_suppressed_until = CASE
      WHEN ready_gate_suppressed_session_id = p_session_id THEN GREATEST(
        COALESCE(ready_gate_suppressed_until, '-infinity'::timestamptz),
        v_until
      )
      ELSE v_until
    END,
    ready_gate_suppressed_session_id = p_session_id,
    current_room_id = CASE
      WHEN current_room_id = p_session_id AND queue_status = 'in_ready_gate' THEN NULL
      ELSE current_room_id
    END,
    queue_status = CASE
      WHEN current_room_id = p_session_id AND queue_status = 'in_ready_gate' THEN 'browsing'
      ELSE queue_status
    END,
    updated_at = now()
  WHERE event_id = v_session.event_id
    AND profile_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'suppressed_until', v_until
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_ready_gate_suppression_v2(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_ready_gate_suppression_v2(uuid, timestamptz)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.persist_ready_gate_suppression_v2(uuid, timestamptz) IS
  'Participant-only Ready Gate manual-exit suppression. Keeps local dismissals stable across refresh/reconnect without exposing partner/safety data.';
