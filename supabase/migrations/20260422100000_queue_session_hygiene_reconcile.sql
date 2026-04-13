-- Stream 1.12: queue/session hygiene — reconcile orphan ready-gate registration pointers
-- when video_sessions is already ended (edge paths that skipped paired registration cleanup).

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  n int := 0;
  v_new_status text;
  v_orphans int := 0;
BEGIN
  -- Snooze wake-up: return to ready state family with a fresh ready-gate window.
  FOR r IN
    SELECT id, ready_participant_1_at, ready_participant_2_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'snoozed'
      AND snooze_expires_at IS NOT NULL
      AND snooze_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_status :=
      CASE
        WHEN r.ready_participant_1_at IS NOT NULL AND r.ready_participant_2_at IS NOT NULL THEN 'both_ready'
        WHEN r.ready_participant_1_at IS NOT NULL THEN 'ready_a'
        WHEN r.ready_participant_2_at IS NOT NULL THEN 'ready_b'
        ELSE 'ready'
      END;

    UPDATE public.video_sessions
    SET
      ready_gate_status = v_new_status,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      ready_gate_expires_at = v_now + interval '30 seconds',
      state_updated_at = v_now
    WHERE id = r.id;

    n := n + 1;
  END LOOP;

  -- Canonical queued TTL expiry (10 minutes).
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'queued'
      AND COALESCE(queued_expires_at, COALESCE(started_at, v_now) + interval '10 minutes') <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      queued_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'queued_ttl_expired',
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
  END LOOP;

  -- Ready gate expiry path (non-snoozed active gates whose timer has elapsed).
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status IN ('ready', 'ready_a', 'ready_b')
      AND ready_gate_expires_at IS NOT NULL
      AND ready_gate_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'ready_gate_expired',
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
  END LOOP;

  -- Orphan pointers: registration still claims in_ready_gate for a room that is already ended.
  UPDATE public.event_registrations er
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  FROM public.video_sessions vs
  WHERE er.current_room_id = vs.id
    AND vs.ended_at IS NOT NULL
    AND er.queue_status = 'in_ready_gate';

  GET DIAGNOSTICS v_orphans = ROW_COUNT;
  n := n + v_orphans;

  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Canonical cleanup for queued TTL expiry, ready-gate expiry, snooze wake-up, and orphan in_ready_gate pointers. Safe for pg_cron and concurrent callers.';
