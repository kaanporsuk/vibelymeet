-- Cleanup hardening: expire handshake sessions whose grace window elapsed,
-- even when no client retries complete_handshake.
CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  v_h int := 0;
  v_hg int := 0;
  v_d int := 0;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  -- Handle handshake-grace expiry first so grace-window sessions use the dedicated
  -- terminal reason and do not fall through to generic handshake_timeout.
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND handshake_grace_expires_at IS NOT NULL
      AND handshake_grace_expires_at <= v_now
      -- Reconnect grace always wins: do not expire while reconnect grace is still active.
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'handshake_grace_expired',
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.handshake_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_hg := v_hg + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND handshake_grace_expires_at IS NULL
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'handshake_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.handshake_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_h := v_h + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL
      AND date_started_at
        + ((300 + COALESCE(date_extra_seconds, 0) + 60) * interval '1 second') <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'date_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.date_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'handshake_timeout', v_h,
    'handshake_grace_expired', v_hg,
    'date_timeout', v_d,
    'total', v_h + v_hg + v_d
  );
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_date_phases() IS
  'Ends stale handshake sessions (standard timeout or elapsed handshake grace), and stale date sessions. Skips active reconnect-grace windows.';
