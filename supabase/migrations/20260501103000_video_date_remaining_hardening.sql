-- Remaining Video Date hardening after the P0 sprint.
-- Keep video_sessions server-owned: clients may read their sessions, but writes
-- must flow through SECURITY DEFINER RPCs/Edge Functions so state-machine
-- invariants cannot be bypassed.

DROP POLICY IF EXISTS "Participants can create video sessions" ON public.video_sessions;
DROP POLICY IF EXISTS "Participants can update own feedback" ON public.video_sessions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.video_sessions FROM anon, authenticated;

COMMENT ON TABLE public.video_sessions IS
  'Server-owned Video Date session state. Authenticated clients may SELECT through RLS, but direct INSERT/UPDATE/DELETE are blocked; canonical writes use SECURITY DEFINER RPCs and service-role Edge Functions.';

CREATE OR REPLACE FUNCTION public.enforce_one_active_video_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_left text;
  v_right text;
  v_lock_left bigint;
  v_lock_right bigint;
BEGIN
  IF NEW.participant_1_id IS NULL OR NEW.participant_2_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_at IS NOT NULL
     OR NEW.state = 'ended'::public.video_date_state
     OR NEW.phase = 'ended' THEN
    RETURN NEW;
  END IF;

  v_left := LEAST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_right := GREATEST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_lock_left := hashtextextended(v_left, 0);
  v_lock_right := hashtextextended(v_right, 0);

  PERFORM pg_advisory_xact_lock(v_lock_left);
  IF v_lock_right IS DISTINCT FROM v_lock_left THEN
    PERFORM pg_advisory_xact_lock(v_lock_right);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.id IS DISTINCT FROM NEW.id
      AND vs.ended_at IS NULL
      AND vs.state IS DISTINCT FROM 'ended'::public.video_date_state
      AND (
        vs.participant_1_id IN (NEW.participant_1_id, NEW.participant_2_id)
        OR vs.participant_2_id IN (NEW.participant_1_id, NEW.participant_2_id)
      )
  ) THEN
    RAISE EXCEPTION 'participant_has_active_session_conflict'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_one_active_video_session_before_write ON public.video_sessions;
CREATE TRIGGER enforce_one_active_video_session_before_write
BEFORE INSERT OR UPDATE OF participant_1_id, participant_2_id, ended_at, state, phase
ON public.video_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_one_active_video_session();

COMMENT ON FUNCTION public.enforce_one_active_video_session() IS
  'Serializes participant-level writes and rejects simultaneous non-ended video_sessions for the same user across either participant column.';

CREATE OR REPLACE FUNCTION public.get_or_seed_video_session_vibe_questions(
  p_session_id uuid,
  p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_questions jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'questions', '[]'::jsonb);
  END IF;

  SELECT id, participant_1_id, participant_2_id, vibe_questions
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'questions', '[]'::jsonb);
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id
     AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'questions', '[]'::jsonb);
  END IF;

  IF jsonb_typeof(v_row.vibe_questions) = 'array'
     AND jsonb_array_length(v_row.vibe_questions) > 0 THEN
    RETURN jsonb_build_object('success', true, 'seeded', false, 'questions', v_row.vibe_questions);
  END IF;

  IF jsonb_typeof(p_questions) = 'array' THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_questions
    FROM (
      SELECT value
      FROM jsonb_array_elements(p_questions) AS q(value)
      WHERE jsonb_typeof(value) = 'string'
        AND length(btrim(value #>> '{}')) BETWEEN 1 AND 240
      LIMIT 8
    ) limited;
  END IF;

  IF jsonb_array_length(v_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_QUESTIONS', 'questions', '[]'::jsonb);
  END IF;

  UPDATE public.video_sessions
  SET vibe_questions = v_questions
  WHERE id = p_session_id
    AND vibe_questions IS NULL;

  SELECT vibe_questions
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'seeded', true,
    'questions', COALESCE(v_row.vibe_questions, v_questions)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) IS
  'Participant-only server-owned replacement for direct client UPDATE of video_sessions.vibe_questions.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260501103000_prepare_entry_queue_guard(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260501103000_prepare_entry_queue_guard;

REVOKE ALL ON FUNCTION public.video_date_transition_20260501103000_prepare_entry_queue_guard(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_actor uuid;
  v_is_p1 boolean;
  v_now timestamptz := now();
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner uuid;
  v_state_before text;
  v_already_entry boolean := false;
  v_gate_live boolean := false;
  v_blocked boolean := false;
  v_actor_away_at timestamptz;
  v_partner_away_at timestamptz;
BEGIN
  IF p_action NOT IN ('prepare_entry', 'mark_reconnect_self_away') THEN
    RETURN public.video_date_transition_20260501103000_prepare_entry_queue_guard(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'unauthorized',
      NULL,
      NULL,
      NULL,
      p_session_id,
      jsonb_build_object('action', p_action, 'p_reason', p_reason)
    );
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'session_not_found',
      NULL,
      NULL,
      v_actor,
      p_session_id,
      jsonb_build_object('action', p_action, 'p_reason', p_reason)
    );
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;
  v_state_before := v_session.state::text;
  v_is_p1 := (v_p1 = v_actor);

  IF NOT v_is_p1 AND v_p2 != v_actor THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access denied',
      'code', 'ACCESS_DENIED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;
  v_actor_away_at := CASE WHEN v_is_p1 THEN v_session.participant_1_away_at ELSE v_session.participant_2_away_at END;
  v_partner_away_at := CASE WHEN v_is_p1 THEN v_session.participant_2_away_at ELSE v_session.participant_1_away_at END;

  IF v_session.ended_at IS NULL
     AND v_session.reconnect_grace_ends_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at <= v_now THEN
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
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = p_session_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', 'ended',
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', COALESCE(v_session.phase, 'ended'),
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
       OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This call is no longer available.',
      'code', 'BLOCKED_PAIR',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  IF p_action = 'mark_reconnect_self_away' THEN
    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN COALESCE(participant_1_away_at, v_now) ELSE participant_1_away_at END,
      participant_2_away_at = CASE WHEN NOT v_is_p1 THEN COALESCE(participant_2_away_at, v_now) ELSE participant_2_away_at END,
      reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR phase IN ('handshake', 'date'));

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'mark_reconnect_self_away',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'phase_after', v_session.phase,
        'reason', p_reason,
        'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'code', 'OK',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'partner_marked_away', v_partner_away_at IS NOT NULL
    );
  END IF;

  IF v_actor_away_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reconnect sync required before prepare entry',
      'code', 'RECONNECT_SYNC_REQUIRED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_already_entry := (
    v_session.handshake_started_at IS NOT NULL
    OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    OR v_session.date_started_at IS NOT NULL
  );

  v_gate_live := (
    COALESCE(v_session.ready_gate_status, '') = 'both_ready'
    AND v_session.ready_gate_expires_at IS NOT NULL
    AND v_session.ready_gate_expires_at > v_now
  );

  IF NOT v_already_entry AND NOT v_gate_live THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'prepare_entry_ready_gate_not_ready',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Both participants must be ready before starting the video date',
      'code', 'READY_GATE_NOT_READY',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  UPDATE public.video_sessions
  SET
    state = CASE
      WHEN date_started_at IS NOT NULL OR state = 'date'::public.video_date_state THEN state
      ELSE 'handshake'::public.video_date_state
    END,
    phase = CASE
      WHEN date_started_at IS NOT NULL OR phase = 'date' THEN phase
      ELSE 'handshake'
    END,
    handshake_started_at = COALESCE(handshake_started_at, v_now),
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE WHEN v_already_entry THEN 'prepare_entry_already_active' ELSE 'prepare_entry_entered' END,
    NULL,
    v_ev,
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'state_before', v_state_before,
      'state_after', v_session.state::text,
      'phase_after', v_session.phase,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'registration_status', 'deferred_until_daily_token',
      'p_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'state', v_session.state::text,
    'phase', v_session.phase,
    'event_id', v_ev,
    'participant_1_id', v_p1,
    'participant_2_id', v_p2,
    'handshake_started_at', v_session.handshake_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. prepare_entry no longer flips event_registrations into in_handshake before a Daily token exists; mark_reconnect_self_away records server-observable unload/background away state.';

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_ended');
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_uid = v_row.participant_1_id THEN
    UPDATE public.video_sessions
    SET participant_1_joined_at = COALESCE(participant_1_joined_at, now())
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET participant_2_joined_at = COALESCE(participant_2_joined_at, now())
    WHERE id = p_session_id;
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
  v_status := CASE
    WHEN v_row.date_started_at IS NOT NULL
      OR v_row.state = 'date'::public.video_date_state
      OR v_row.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
      ELSE v_row.participant_1_id
    END,
    last_active_at = now()
  WHERE event_id = v_row.event_id
    AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id);

  RETURN jsonb_build_object('ok', true, 'queue_status', v_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid) IS
  'Idempotent first Daily join stamp for the caller. Also flips queue_status after Daily room/token preparation has reached an actual join path.';

CREATE OR REPLACE FUNCTION public.repair_stale_video_date_prepare_entries(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  n integer := 0;
  v_registration_rows integer := 0;
BEGIN
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at < v_now - interval '5 minutes'
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY handshake_started_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'prepare_entry_provider_failed_repair',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    IF v_registration_rows = 0 THEN
      PERFORM public.record_event_loop_observability(
        'repair_stale_video_date_prepare_entries',
        'deferred',
        'stale_prepare_entry_registration_unlinked',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('reason', 'no_registration_current_room_link')
      );
    END IF;

    PERFORM public.record_event_loop_observability(
      'repair_stale_video_date_prepare_entries',
      'success',
      'stale_prepare_entry_no_daily_room',
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object('ended_reason', 'prepare_entry_provider_failed_repair')
    );
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_stale_video_date_prepare_entries(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_stale_video_date_prepare_entries(integer) TO service_role;

DROP FUNCTION IF EXISTS public.expire_stale_video_sessions_20260501103000_unbounded();

ALTER FUNCTION public.expire_stale_video_sessions()
  RENAME TO expire_stale_video_sessions_20260501103000_unbounded;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_20260501103000_unbounded() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_base integer := 0;
  v_repaired integer := 0;
BEGIN
  -- Historical expire_stale_video_sessions body remains delegated/unbounded.
  -- Bounding that legacy cleanup is deferred until a DB-executed migration rehearsal;
  -- this migration bounds only the new prepare-entry repair path below.
  v_base := public.expire_stale_video_sessions_20260501103000_unbounded();
  v_repaired := public.repair_stale_video_date_prepare_entries(100);
  RETURN COALESCE(v_base, 0) + COALESCE(v_repaired, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions() TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Runs delegated historical stale-session cleanup, then bounded prepare-entry repair. Historical expire_stale_video_sessions body remains delegated/unbounded; full loop bounding is deferred pending DB-executed migration rehearsal.';

CREATE OR REPLACE FUNCTION public.detect_post_date_half_verdict_timeouts(
  p_older_than interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT
      vs.id,
      vs.event_id,
      min(df.created_at) AS first_verdict_at,
      count(*) AS verdict_count
    FROM public.video_sessions vs
    JOIN public.date_feedback df ON df.session_id = vs.id
    WHERE vs.ended_at IS NOT NULL
      AND vs.date_started_at IS NOT NULL
    GROUP BY vs.id, vs.event_id
    HAVING count(*) = 1
      AND min(df.created_at) < now() - COALESCE(p_older_than, interval '24 hours')
    ORDER BY min(df.created_at)
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  LOOP
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_timeout',
      'success',
      'partner_verdict_missing',
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'first_verdict_at', r.first_verdict_at,
        'verdict_count', r.verdict_count
      )
    );
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_target uuid;
  v_inner jsonb;
  v_persistent_created boolean;
  v_partner_verdict_recorded boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    v_target := v_session.participant_2_id;
  ELSE
    v_target := v_session.participant_1_id;
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_uid, v_target) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'blocked', true
    );
  END IF;

  IF v_session.ended_at IS NULL
     OR v_session.date_started_at IS NULL
     OR COALESCE(v_session.ended_reason, '') IN (
       'ready_gate_forfeit',
       'ready_gate_expired',
       'queued_ttl_expired',
       'handshake_not_mutual',
       'handshake_grace_expired',
       'handshake_timeout',
       'blocked_pair'
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'verdict_recorded', false
    );
  END IF;

  INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
  VALUES (p_session_id, v_uid, v_target, p_liked)
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET
    liked = EXCLUDED.liked,
    target_id = EXCLUDED.target_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id = v_target
  ) INTO v_partner_verdict_recorded;

  v_inner := public.check_mutual_vibe_and_match(p_session_id);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object(
      'verdict_recorded', true,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
  END IF;

  v_persistent_created := NULL;
  IF COALESCE((v_inner->>'mutual')::boolean, false) THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  IF NOT v_partner_verdict_recorded THEN
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_pending',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records one verdict immediately, reports pending-partner state, and only creates persistent matches when both verdicts warrant it.';
