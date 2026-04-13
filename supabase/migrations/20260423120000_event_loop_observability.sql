-- Phase 2: structured observability for live event loop (queue promotion, drain, expiry, swipe).
-- Append-only events for operator / SQL dashboard analysis. No client-facing API; inserts via
-- SECURITY DEFINER RPCs only. Logging failures are swallowed so hot paths never break.

-- ---------------------------------------------------------------------------
-- Outcome taxonomy (column `outcome`):
--   success     — promotion/match/cleanup applied as intended
--   no_op       — valid call, nothing to promote or zero cleanup rows (still "ok")
--   blocked     — eligibility / presence / admission / event validity guard
--   conflict    — participant already in another active session (pair conflict)
--   queued      — mutual match deferred to queue (handle_swipe)
--   expired     — reserved for future subtyping (expiry paths use success + detail.kind)
--   hygiene     — orphan registration pointer reconciled (see detail.hygiene_orphans)
--   error       — unauthorized / unexpected boundary
--
-- reason_code — mirrors existing JSON `reason` / `result` strings where applicable.
-- detail      — jsonb: counts, nested promotion excerpts, swipe flags (no PII beyond ids).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_loop_observability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  outcome text NOT NULL,
  reason_code text,
  latency_ms integer,
  event_id uuid,
  actor_id uuid,
  session_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS event_loop_observability_events_created_at_idx
  ON public.event_loop_observability_events (created_at DESC);

CREATE INDEX IF NOT EXISTS event_loop_observability_events_operation_created_idx
  ON public.event_loop_observability_events (operation, created_at DESC);

CREATE INDEX IF NOT EXISTS event_loop_observability_events_event_created_idx
  ON public.event_loop_observability_events (event_id, created_at DESC)
  WHERE event_id IS NOT NULL;

COMMENT ON TABLE public.event_loop_observability_events IS
  'Append-only observability for promote_ready_gate_if_eligible, drain_match_queue, expire_stale_video_sessions, mark_lobby_foreground, and handle_swipe (mutual paths). Read via service_role or SQL editor; not exposed to anon/authenticated.';

ALTER TABLE public.event_loop_observability_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_loop_observability_events FROM PUBLIC;
REVOKE ALL ON TABLE public.event_loop_observability_events FROM anon;
REVOKE ALL ON TABLE public.event_loop_observability_events FROM authenticated;
GRANT SELECT ON TABLE public.event_loop_observability_events TO service_role;

-- Fail-safe logger: never raises to callers.
CREATE OR REPLACE FUNCTION public.record_event_loop_observability(
  p_operation text,
  p_outcome text,
  p_reason_code text,
  p_latency_ms integer,
  p_event_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_detail jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.event_loop_observability_events (
    operation,
    outcome,
    reason_code,
    latency_ms,
    event_id,
    actor_id,
    session_id,
    detail
  ) VALUES (
    p_operation,
    p_outcome,
    p_reason_code,
    p_latency_ms,
    p_event_id,
    p_actor_id,
    p_session_id,
    COALESCE(p_detail, '{}'::jsonb)
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_event_loop_observability(text, text, text, integer, uuid, uuid, uuid, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- promote_ready_gate_if_eligible (instrumented)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible(
  p_event_id uuid,
  p_uid uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
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
  PERFORM 1
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.status = 'live'
    AND e.ended_at IS NULL
    AND e.status <> 'cancelled'
  FOR SHARE OF e;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'event_share_lock')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'event_not_valid');
  END IF;

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
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'no_op',
      'no_queued_session',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'pick_queued_session')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'no_queued_session');
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = p_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'lock_registration_low')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'lock_registration_high')
    );
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
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'admission_not_confirmed',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'admission_check')
    );
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
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'self_not_present',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'presence_self')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'self_not_present');
  END IF;

  IF NOT v_partner_present THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'partner_not_present',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'presence_partner')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'partner_not_present');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.status = 'live'
      AND e.ended_at IS NULL
      AND e.status <> 'cancelled'
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'revalidate_event')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'event_not_valid');
  END IF;

  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'no_op',
      'session_not_promotable',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'revalidate_session')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'session_not_promotable');
  END IF;

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
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'active_session_guard')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'participant_has_active_session_conflict');
  END IF;

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

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'promote_ready_gate_if_eligible',
    'success',
    NULL,
    v_ms,
    p_event_id,
    p_uid,
    v_match.id,
    jsonb_build_object(
      'promoted', true,
      'partner_id', v_partner_id
    )
  );

  RETURN jsonb_build_object(
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- drain_match_queue (instrumented wrapper — promote logs separately)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_uid uuid := auth.uid();
  v_promotion jsonb;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      NULL,
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  PERFORM public.expire_stale_video_sessions();

  v_promotion := public.promote_ready_gate_if_eligible(p_event_id, v_uid);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  IF (v_promotion->>'promoted') = 'true' THEN
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'success',
      NULL,
      v_ms,
      p_event_id,
      v_uid,
      NULLIF(v_promotion->>'video_session_id', '')::uuid,
      jsonb_build_object(
        'found', true,
        'partner_id', v_promotion->>'partner_id'
      )
    );
    RETURN jsonb_build_object(
      'found', true,
      'match_id', v_promotion->>'match_id',
      'video_session_id', v_promotion->>'video_session_id',
      'event_id', v_promotion->>'event_id',
      'partner_id', v_promotion->>'partner_id'
    );
  END IF;

  v_reason := v_promotion->>'reason';

  IF v_reason IN ('self_not_present', 'partner_not_present') THEN
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      v_reason,
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object('found', false, 'queued', true)
    );
    RETURN jsonb_build_object('found', false, 'queued', true, 'reason', v_reason);
  END IF;

  PERFORM public.record_event_loop_observability(
    'drain_match_queue',
    CASE
      WHEN v_reason IN ('no_queued_session', 'session_not_promotable') THEN 'no_op'
      WHEN v_reason = 'participant_has_active_session_conflict' THEN 'conflict'
      WHEN v_reason IN ('event_not_valid', 'registration_missing', 'admission_not_confirmed') THEN 'blocked'
      ELSE 'no_op'
    END,
    COALESCE(v_reason, 'unknown'),
    v_ms,
    p_event_id,
    v_uid,
    NULL,
    jsonb_build_object('found', false)
  );

  RETURN jsonb_build_object(
    'found', false,
    'reason', COALESCE(v_reason, 'unknown')
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- expire_stale_video_sessions (instrumented)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_now timestamptz := now();
  r record;
  n int := 0;
  v_new_status text;
  v_orphans int := 0;
  v_snooze int := 0;
  v_queued_ttl int := 0;
  v_ready_exp int := 0;
BEGIN
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
    v_snooze := v_snooze + 1;
  END LOOP;

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
    v_queued_ttl := v_queued_ttl + 1;
  END LOOP;

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
    v_ready_exp := v_ready_exp + 1;
  END LOOP;

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

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'expire_stale_video_sessions',
    CASE WHEN n > 0 THEN 'success' ELSE 'no_op' END,
    NULL,
    v_ms,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'total_mutations', n,
      'snooze_wake', v_snooze,
      'queued_ttl_expired', v_queued_ttl,
      'ready_gate_expired', v_ready_exp,
      'hygiene_orphans', v_orphans
    )
  );

  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Canonical cleanup for queued TTL expiry, ready-gate expiry, snooze wake-up, and orphan in_ready_gate pointers. Safe for pg_cron and concurrent callers. Emits one observability row per invocation.';

-- ---------------------------------------------------------------------------
-- mark_lobby_foreground (instrumented)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_lobby_foreground(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_promo jsonb;
BEGIN
  -- Unauthenticated: raise immediately (no observability row — same-transaction insert would roll back with RAISE).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.event_registrations
  SET
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = v_uid
    AND admission_status = 'confirmed';

  v_promo := public.promote_ready_gate_if_eligible(p_event_id, v_uid);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'mark_lobby_foreground',
    'success',
    v_promo->>'reason',
    v_ms,
    p_event_id,
    v_uid,
    NULLIF(v_promo->>'video_session_id', '')::uuid,
    jsonb_build_object('promotion', v_promo)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_lobby_foreground(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- handle_swipe — mutual / promotion-relevant paths only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_actor_foregrounded_at timestamptz;
  v_target_foregrounded_at timestamptz;
  v_actor_present boolean := false;
  v_target_present boolean := false;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = p_event_id
      AND (ev.status = 'cancelled' OR ev.archived_at IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('result', 'event_not_active', 'reason', 'cancelled_or_archived');
  END IF;

  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_reports
    WHERE reporter_id = p_actor_id AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'account_paused',
      'message', 'Your account is currently on a break'
    );
  END IF;

  IF public.is_profile_hidden(p_target_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_unavailable',
      'message', 'This profile is no longer available'
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_target_id
      AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    v_t0 := clock_timestamp();

    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_actor_status, v_actor_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_actor_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_target_status, v_target_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_target_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    v_actor_present :=
      v_actor_status IN ('browsing', 'idle')
      AND v_actor_foregrounded_at IS NOT NULL
      AND v_actor_foregrounded_at >= now() - interval '60 seconds';

    v_target_present :=
      v_target_status IN ('browsing', 'idle')
      AND v_target_foregrounded_at IS NOT NULL
      AND v_target_foregrounded_at >= now() - interval '60 seconds';

    IF EXISTS (
      SELECT 1
      FROM public.video_sessions z
      WHERE z.event_id = p_event_id
        AND z.ended_at IS NULL
        AND NOT (
          z.participant_1_id = LEAST(p_actor_id, p_target_id)
          AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
        )
        AND (
          z.participant_1_id IN (p_actor_id, p_target_id)
          OR z.participant_2_id IN (p_actor_id, p_target_id)
        )
    ) THEN
      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'conflict',
        'participant_has_active_session_conflict',
        v_ms,
        p_event_id,
        p_actor_id,
        NULL,
        jsonb_build_object('swipe_type', p_swipe_type, 'mutual', true)
      );
      RETURN jsonb_build_object('result', 'participant_has_active_session_conflict');
    END IF;

    INSERT INTO public.video_sessions (
      event_id,
      participant_1_id,
      participant_2_id,
      ready_gate_status,
      ready_gate_expires_at,
      queued_expires_at
    )
    VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE
        WHEN v_actor_present AND v_target_present THEN 'ready'
        ELSE 'queued'
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN now() + interval '30 seconds'
        ELSE NULL
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN NULL
        ELSE now() + interval '10 minutes'
      END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'no_op',
        'already_matched',
        v_ms,
        p_event_id,
        p_actor_id,
        NULL,
        jsonb_build_object('swipe_type', p_swipe_type, 'mutual', true)
      );
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_present AND v_target_present THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_ready_gate',
        current_room_id = v_session_id,
        current_partner_id = CASE
          WHEN profile_id = p_actor_id THEN p_target_id
          ELSE p_actor_id
        END,
        last_active_at = now()
      WHERE event_id = p_event_id
        AND profile_id IN (p_actor_id, p_target_id);

      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'success',
        'match_immediate',
        v_ms,
        p_event_id,
        p_actor_id,
        v_session_id,
        jsonb_build_object(
          'swipe_type', p_swipe_type,
          'mutual', true,
          'immediate', true
        )
      );

      RETURN jsonb_build_object(
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    END IF;

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'queued',
      'match_queued',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'immediate', false
      )
    );

    RETURN jsonb_build_object(
      'result', 'match_queued',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id
    );
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;

  RETURN jsonb_build_object('result', 'vibe_recorded');
END;
$function$;
