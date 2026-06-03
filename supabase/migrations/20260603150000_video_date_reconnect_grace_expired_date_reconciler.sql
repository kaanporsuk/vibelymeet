-- Video Date: server-side early end for date sessions whose reconnect grace
-- has expired with no client to drive the transition.
--
-- Problem (F3): the in-call "Video Date" stage relies on a client calling
-- video_date_transition to end a session when reconnect grace expires
-- (ended_reason = 'reconnect_grace_expired', see 20260409100000). If BOTH
-- participants are gone -- or one partner left and the waiting participant's
-- tab/app is suspended -- no client makes that call. The bounded stale-phase
-- reconciler (expire_stale_video_date_phases_bounded) only ends date sessions
-- at the FULL budget (date_started_at + 300 + date_extra_seconds + 60s) and
-- merely SKIPS while reconnect grace is still open. So a confirmed date that
-- collapsed at minute 1 stays state='date' with event_registrations.current_room_id
-- pinned -- blocking re-queue/browse -- until the full budget elapses (~5+ min).
--
-- Fix: additively wrap expire_stale_video_date_phases_bounded so that, AFTER the
-- existing base cleanup, it also ends date-phase sessions whose reconnect grace
-- expired (with a small extra safety buffer beyond the 30s server grace). The
-- terminal state mirrors the existing date_timeout end exactly (queue_status
-- 'in_survey', current_room_id cleared) so the confirmed encounter still earns a
-- Vibe/Pass survey -- only the trigger (grace expiry vs full budget) and the
-- ended_reason ('reconnect_grace_expired', already survey-eligible) differ.
--
-- Purely additive + idempotent. No existing object is dropped; the current
-- bounded reconciler is renamed to a private base and called first, preserving
-- all prior behavior and the caller-visible return shape.

BEGIN;

-- 1) Rename the current bounded reconciler to a private base (idempotent).
DO $$
BEGIN
  IF to_regprocedure('public.expire_stale_video_date_phases_bounded(integer)') IS NOT NULL
     AND to_regprocedure('public.expire_vd_phases_pre_grace_base_20260603(integer)') IS NULL THEN
    ALTER FUNCTION public.expire_stale_video_date_phases_bounded(integer)
      RENAME TO expire_vd_phases_pre_grace_base_20260603;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_vd_phases_pre_grace_base_20260603(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_vd_phases_pre_grace_base_20260603(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_vd_phases_pre_grace_base_20260603(integer) IS
  'Private base bounded video-date phase reconciler (pre reconnect-grace-expired overlay from 20260603150000). Called first by expire_stale_video_date_phases_bounded.';

-- 2) New wrapper: base cleanup, then end grace-expired date sessions early.
CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_now timestamptz := now();
  v_base jsonb;
  v_base_total integer := 0;
  v_rge integer := 0;
  r record;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  -- Preserve every prior behavior (no-evidence/partial-join/handshake/date-budget
  -- cleanup) and the caller-visible return shape.
  v_base := public.expire_vd_phases_pre_grace_base_20260603(v_limit);
  v_base_total := COALESCE((v_base->>'total')::int, 0);

  -- Overlay: end confirmed date sessions whose reconnect grace expired and that
  -- no client ended. The 10s buffer sits beyond the 30s server grace
  -- (mark_reconnect_partner_away) so a genuinely-reconnecting client always wins.
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= v_now - interval '10 seconds'
    ORDER BY reconnect_grace_ends_at, id
    LIMIT v_limit
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
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.date_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL;

    -- A confirmed date (date_started_at IS NOT NULL) is always a confirmed
    -- encounter, so it stays survey-eligible. Mirror the date_timeout end-state
    -- so the Vibe/Pass survey still opens; only the reason differs.
    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = r.id;

    v_rge := v_rge + 1;
  END LOOP;

  RETURN v_base || jsonb_build_object(
    'date_reconnect_grace_expired', v_rge,
    'total', v_base_total + v_rge
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) IS
  'Bounded stale video-date phase cleanup. Runs the prior base reconciler, then ends confirmed date sessions whose reconnect grace expired (ended_reason reconnect_grace_expired) so an abandoned/both-disconnected date releases current_room_id and opens the survey instead of waiting out the full date budget.';

COMMIT;
