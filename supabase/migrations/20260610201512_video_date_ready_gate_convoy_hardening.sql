-- Video Date Ready Gate convoy hardening (incident 2026-06-10, session 927942c2-0704-4e42-a95c-c3fc56accc02).
--
-- Forensics (postgres_logs, pg_stat_statements, lock-wait logs):
-- At both-ready time a lock convoy formed on the single video_sessions row:
-- video_session_mark_ready_v2 / ready_gate_transition held the row for seconds
-- (CPU-starved Micro compute), while record_video_date_ready_gate_entered_v1
-- (entry-proof telemetry + TTL stamp, fired on every Ready Gate mount) queued
-- behind them with an eager SELECT ... FOR UPDATE. Queued statements blew the
-- authenticated role's 8s statement_timeout -> SQLSTATE 57014 -> raw HTTP 500s
-- (PL/pgSQL `WHEN OTHERS` cannot catch query_canceled), clients retried, the
-- convoy deepened, readiness never landed, and the gate expired
-- (ended_reason = ready_gate_expired).
--
-- Two mitigations, both behavior-preserving for the golden flow:
--
-- 1) record_video_date_ready_gate_entered_v1 now locks the session row with
--    FOR UPDATE NOWAIT and converts lock_not_available (55P03) into a
--    structured retryable JSON failure (code READY_GATE_BUSY) instead of
--    queueing behind critical ready-path transactions. All current callers
--    (web ReadyGateOverlay, native ready/[id] + ReadyGateOverlay) are
--    fire-and-forget (`void recordReadyGateEntered(...)`), so a busy-skip is
--    strictly better than today's behavior (8s queue wait then raw 500, with
--    the TTL extension lost either way).
--
-- 2) authenticated statement_timeout 8s -> 15s. The Ready Gate window is
--    45-60s; a mark_ready that waits 10s in a transient convoy and SUCCEEDS
--    is strictly better than one cancelled at 8s whose retry re-queues at the
--    back of the lock queue. On a healthy instance these calls take
--    milliseconds, so the higher ceiling is inert outside contention storms.
--    Revert path: ALTER ROLE authenticated SET statement_timeout = '8s';
--    NOTIFY pgrst, 'reload config';
--
-- The compute-tier upgrade (root capacity fix) was deliberately deferred by
-- product decision on 2026-06-10; this migration is the convoy resilience
-- layer that must hold until that decision changes.

CREATE OR REPLACE FUNCTION public.record_video_date_ready_gate_entered_v1(
  p_session_id uuid,
  p_surface text DEFAULT 'ready_gate_overlay'::text,
  p_platform text DEFAULT 'unknown'::text,
  p_source text DEFAULT 'mounted_active_ready_gate'::text,
  p_client_instance_id text DEFAULT NULL::text,
  p_route_path text DEFAULT NULL::text,
  p_client_ready_gate_status text DEFAULT NULL::text
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

  -- Entry proof is a telemetry/TTL stamp, not a critical transition. It must
  -- never queue behind mark_ready/ready_gate_transition on the session row:
  -- under contention it fails fast as retryable READY_GATE_BUSY instead.
  BEGIN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'code', 'READY_GATE_BUSY',
        'retryable', true,
        'error', 'Ready gate row is busy; entry proof skipped'
      );
  END;

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

-- Convoy survival ceiling for authenticated PostgREST statements (was 8s).
ALTER ROLE authenticated SET statement_timeout = '15s';

-- PostgREST must reload role settings for the new timeout to apply to
-- pooled connections.
NOTIFY pgrst, 'reload config';
