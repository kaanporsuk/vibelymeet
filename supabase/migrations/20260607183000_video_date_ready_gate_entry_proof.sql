-- Ready Gate entry proof and late-entry grace.
--
-- This is intentionally not a lifecycle owner. It records that an authenticated
-- participant actually mounted an actionable Ready Gate surface, and gives a
-- first-entering participant a small server-side grace window so late Realtime /
-- push / cold-start recovery does not leave only a few seconds to act.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS ready_gate_participant_1_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_gate_participant_2_entered_at timestamptz;

COMMENT ON COLUMN public.video_sessions.ready_gate_participant_1_entered_at IS
  'First server-accepted proof that participant_1 mounted an actionable Ready Gate surface for this session. Observability/proof only; not Ready/date lifecycle authority.';
COMMENT ON COLUMN public.video_sessions.ready_gate_participant_2_entered_at IS
  'First server-accepted proof that participant_2 mounted an actionable Ready Gate surface for this session. Observability/proof only; not Ready/date lifecycle authority.';

CREATE TABLE IF NOT EXISTS public.video_date_ready_gate_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  participant_slot integer NOT NULL CHECK (participant_slot IN (1, 2)),
  ready_gate_status text NOT NULL,
  client_ready_gate_status text,
  platform text NOT NULL,
  surface text NOT NULL,
  source text,
  route_path text,
  client_instance_id text,
  ready_gate_expires_at_before timestamptz,
  ready_gate_expires_at_after timestamptz,
  ttl_extended boolean NOT NULL DEFAULT false,
  first_entry_for_participant boolean NOT NULL DEFAULT false,
  both_participants_entered boolean NOT NULL DEFAULT false,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_date_ready_gate_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_date_ready_gate_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_ready_gate_entries TO service_role;

CREATE INDEX IF NOT EXISTS idx_video_date_ready_gate_entries_session_inserted
  ON public.video_date_ready_gate_entries(video_session_id, inserted_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_date_ready_gate_entries_profile_inserted
  ON public.video_date_ready_gate_entries(profile_id, inserted_at DESC);

COMMENT ON TABLE public.video_date_ready_gate_entries IS
  'Append-only proof ledger for authenticated participants mounting actionable Ready Gate surfaces. Written through record_video_date_ready_gate_entered_v1; service-readable for support/debugging.';

CREATE OR REPLACE FUNCTION public.record_video_date_ready_gate_entered_v1(
  p_session_id uuid,
  p_surface text DEFAULT 'ready_gate_overlay',
  p_platform text DEFAULT 'unknown',
  p_source text DEFAULT 'mounted_active_ready_gate',
  p_client_instance_id text DEFAULT NULL,
  p_route_path text DEFAULT NULL,
  p_client_ready_gate_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_slot integer;
  v_previous_expires_at timestamptz;
  v_first_entry_for_participant boolean := false;
  v_ttl_extended boolean := false;
  v_min_expires_at timestamptz := v_now + interval '45 seconds';
  v_surface text := left(COALESCE(NULLIF(btrim(p_surface), ''), 'ready_gate_overlay'), 80);
  v_platform text := left(COALESCE(NULLIF(btrim(p_platform), ''), 'unknown'), 40);
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'mounted_active_ready_gate'), 120);
  v_client_instance_id text := left(NULLIF(btrim(COALESCE(p_client_instance_id, '')), ''), 160);
  v_route_path text := left(NULLIF(btrim(COALESCE(p_route_path, '')), ''), 240);
  v_client_ready_gate_status text := left(NULLIF(btrim(COALESCE(p_client_ready_gate_status, '')), ''), 40);
  v_both_participants_entered boolean := false;
  v_inactive_reason text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'AUTH_REQUIRED',
      'error', 'Sign in again to keep going.'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  IF v_session.participant_1_id = v_actor THEN
    v_slot := 1;
    v_first_entry_for_participant := v_session.ready_gate_participant_1_entered_at IS NULL;
  ELSIF v_session.participant_2_id = v_actor THEN
    v_slot := 2;
    v_first_entry_for_participant := v_session.ready_gate_participant_2_entered_at IS NULL;
  ELSE
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'ACCESS_DENIED',
      'error', 'Access denied',
      'event_id', v_session.event_id,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'ACCESS_DENIED',
      'error', 'Access denied',
      'event_id', v_session.event_id,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'EVENT_INACTIVE',
      'error', 'Event is no longer active',
      'inactive_reason', v_inactive_reason,
      'event_id', v_session.event_id,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text IS DISTINCT FROM 'ready_gate'
     OR COALESCE(v_session.phase, 'ready_gate') IS DISTINCT FROM 'ready_gate'
     OR v_session.ready_gate_status NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'NOT_ACTIONABLE_READY_GATE',
      'retryable', v_session.ready_gate_status IN ('queued'),
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'ended_at', v_session.ended_at
    );
  END IF;

  IF v_session.ready_gate_expires_at IS NOT NULL
     AND v_session.ready_gate_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'READY_GATE_EXPIRED',
      'retryable', false,
      'event_id', v_session.event_id,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'server_now', v_now
    );
  END IF;

  v_previous_expires_at := v_session.ready_gate_expires_at;
  v_ttl_extended := v_first_entry_for_participant
    AND COALESCE(v_session.ready_gate_expires_at, v_now) < v_min_expires_at;

  UPDATE public.video_sessions
  SET
    ready_gate_participant_1_entered_at = CASE
      WHEN v_slot = 1 THEN COALESCE(ready_gate_participant_1_entered_at, v_now)
      ELSE ready_gate_participant_1_entered_at
    END,
    ready_gate_participant_2_entered_at = CASE
      WHEN v_slot = 2 THEN COALESCE(ready_gate_participant_2_entered_at, v_now)
      ELSE ready_gate_participant_2_entered_at
    END,
    ready_gate_expires_at = CASE
      WHEN v_ttl_extended THEN GREATEST(COALESCE(ready_gate_expires_at, v_now), v_min_expires_at)
      ELSE ready_gate_expires_at
    END,
    state_updated_at = CASE
      WHEN v_ttl_extended THEN v_now
      ELSE state_updated_at
    END
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state::text = 'ready_gate'
    AND COALESCE(phase, 'ready_gate') = 'ready_gate'
    AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      ready_gate_expires_at IS NULL
      OR ready_gate_expires_at > v_now
    )
  RETURNING *
  INTO v_after;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'READY_GATE_CHANGED',
      'retryable', true,
      'event_id', v_session.event_id,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  v_both_participants_entered :=
    v_after.ready_gate_participant_1_entered_at IS NOT NULL
    AND v_after.ready_gate_participant_2_entered_at IS NOT NULL;

  INSERT INTO public.video_date_ready_gate_entries (
    video_session_id,
    event_id,
    profile_id,
    participant_slot,
    ready_gate_status,
    client_ready_gate_status,
    platform,
    surface,
    source,
    route_path,
    client_instance_id,
    ready_gate_expires_at_before,
    ready_gate_expires_at_after,
    ttl_extended,
    first_entry_for_participant,
    both_participants_entered
  ) VALUES (
    v_after.id,
    v_after.event_id,
    v_actor,
    v_slot,
    v_after.ready_gate_status,
    v_client_ready_gate_status,
    v_platform,
    v_surface,
    v_source,
    v_route_path,
    v_client_instance_id,
    v_previous_expires_at,
    v_after.ready_gate_expires_at,
    v_ttl_extended,
    v_first_entry_for_participant,
    v_both_participants_entered
  );

  BEGIN
    PERFORM public.record_event_loop_observability(
      'ready_gate_entry',
      'success',
      CASE
        WHEN v_first_entry_for_participant THEN 'participant_entered_ready_gate'
        ELSE 'participant_reentered_ready_gate'
      END,
      NULL,
      v_after.event_id,
      v_actor,
      v_after.id,
      jsonb_build_object(
        'participant_slot', v_slot,
        'platform', v_platform,
        'surface', v_surface,
        'source', v_source,
        'client_instance_id', v_client_instance_id,
        'route_path', v_route_path,
        'ready_gate_status', v_after.ready_gate_status,
        'client_ready_gate_status', v_client_ready_gate_status,
        'ready_gate_expires_at_before', v_previous_expires_at,
        'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
        'ttl_extended', v_ttl_extended,
        'first_entry_for_participant', v_first_entry_for_participant,
        'both_participants_entered', v_both_participants_entered
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'event_id', v_after.event_id,
    'session_id', v_after.id,
    'participant_slot', v_slot,
    'ready_gate_status', v_after.ready_gate_status,
    'ready_gate_participant_1_entered_at', v_after.ready_gate_participant_1_entered_at,
    'ready_gate_participant_2_entered_at', v_after.ready_gate_participant_2_entered_at,
    'both_participants_entered', v_both_participants_entered,
    'first_entry_for_participant', v_first_entry_for_participant,
    'ttl_extended', v_ttl_extended,
    'ready_gate_expires_at_before', v_previous_expires_at,
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'server_now', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_ready_gate_entered_v1(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_video_date_ready_gate_entered_v1(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_video_date_ready_gate_entered_v1(uuid, text, text, text, text, text, text) IS
  'Authenticated participant proof that the actual Ready Gate surface mounted for an actionable ready/ready_a/ready_b/snoozed session. Writes first-entry columns plus append-only ledger and may extend active Ready Gate expiry to at least 45 seconds from first entry; does not mark Ready or date-owned lifecycle truth.';

