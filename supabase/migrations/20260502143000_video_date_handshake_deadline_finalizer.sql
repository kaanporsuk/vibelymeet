-- Video Date handshake deadline finalizer.
--
-- Removes the 10s Last Chance grace path from the active state machine. The
-- visible 60s handshake is now a hard product deadline:
--   * both explicit Vibe decisions -> date
--   * any explicit non-mutual pair -> ended handshake_not_mutual
--   * one/both undecided at deadline -> ended handshake_timeout

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_is_p1 boolean := false;
  v_is_p2 boolean := false;
  v_actor_decided_at timestamptz;
  v_partner_decided_at timestamptz;
  v_waiting_for_self boolean := false;
  v_waiting_for_partner boolean := false;
  v_p1_decided boolean := false;
  v_p2_decided boolean := false;
  v_p1_explicit_pass boolean := false;
  v_p2_explicit_pass boolean := false;
  v_due boolean := false;
  v_seconds_remaining integer;
  v_state_before text;
  v_reason_code text;
  v_terminal_reason text;
BEGIN
  SELECT *
  INTO v_session
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
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;
  v_state_before := v_session.state::text;
  v_is_p1 := p_actor IS NOT NULL AND v_p1 = p_actor;
  v_is_p2 := p_actor IS NOT NULL AND v_p2 = p_actor;

  IF p_actor IS NOT NULL AND NOT v_is_p1 AND NOT v_is_p2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'access_denied',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'state_before', v_state_before,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  v_p1_decided := v_session.participant_1_decided_at IS NOT NULL;
  v_p2_decided := v_session.participant_2_decided_at IS NOT NULL;
  v_p1_explicit_pass := v_p1_decided AND v_session.participant_1_liked IS FALSE;
  v_p2_explicit_pass := v_p2_decided AND v_session.participant_2_liked IS FALSE;
  v_actor_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_1_decided_at
    WHEN v_is_p2 THEN v_session.participant_2_decided_at
    ELSE NULL
  END;
  v_partner_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_2_decided_at
    WHEN v_is_p2 THEN v_session.participant_1_decided_at
    ELSE NULL
  END;
  v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
  v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;
  v_due := v_session.handshake_started_at IS NOT NULL
    AND v_session.handshake_started_at + interval '60 seconds' <= v_now;
  v_seconds_remaining := CASE
    WHEN v_session.handshake_started_at IS NULL THEN NULL
    ELSE GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM ((v_session.handshake_started_at + interval '60 seconds') - v_now)))::int
    )
  END;

  IF v_session.ended_at IS NOT NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'session_already_ended',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', v_waiting_for_self,
        'waiting_for_partner', v_waiting_for_partner,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', v_due,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'already_ended', true,
      'reason', v_session.ended_reason,
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner
    );
  END IF;

  IF v_session.state = 'date'::public.video_date_state
     OR v_session.phase = 'date'
     OR v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'state', 'date',
      'waiting_for_self', false,
      'waiting_for_partner', false,
      'local_decision_persisted', true,
      'partner_decision_persisted', true
    );
  END IF;

  IF v_p1_decided
     AND v_p2_decided
     AND v_session.participant_1_liked IS TRUE
     AND v_session.participant_2_liked IS TRUE THEN
    UPDATE public.video_sessions
    SET
      state = 'date'::public.video_date_state,
      phase = 'date',
      date_started_at = COALESCE(date_started_at, v_now),
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_date',
      current_room_id = p_session_id,
      current_partner_id = CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'handshake_deadline_completed_mutual',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', false,
        'waiting_for_partner', false,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', v_due,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'date',
      'waiting_for_self', false,
      'waiting_for_partner', false,
      'local_decision_persisted', true,
      'partner_decision_persisted', true
    );
  END IF;

  IF NOT v_due THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'handshake_deadline_not_due',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', v_waiting_for_self,
        'waiting_for_partner', v_waiting_for_partner,
        'seconds_remaining', v_seconds_remaining,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', false,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'handshake',
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner,
      'seconds_remaining', v_seconds_remaining
    );
  END IF;

  IF v_p1_explicit_pass OR v_p2_explicit_pass OR (v_p1_decided AND v_p2_decided) THEN
    v_terminal_reason := 'handshake_not_mutual';
    v_reason_code := 'handshake_deadline_not_mutual';
  ELSE
    v_terminal_reason := 'handshake_timeout';
    v_reason_code := 'handshake_deadline_timeout';
  END IF;

  UPDATE public.video_sessions
  SET
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = COALESCE(ended_at, v_now),
    ended_reason = v_terminal_reason,
    handshake_grace_expires_at = NULL,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.handshake_started_at, v_session.started_at))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;

  UPDATE public.event_registrations
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  WHERE event_id = v_ev
    AND profile_id IN (v_p1, v_p2);

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  v_actor_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_1_decided_at
    WHEN v_is_p2 THEN v_session.participant_2_decided_at
    ELSE NULL
  END;
  v_partner_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_2_decided_at
    WHEN v_is_p2 THEN v_session.participant_1_decided_at
    ELSE NULL
  END;
  v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
  v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    v_reason_code,
    NULL,
    v_ev,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'action', 'complete_handshake',
      'source', p_source,
      'participant_1_liked', v_session.participant_1_liked,
      'participant_2_liked', v_session.participant_2_liked,
      'participant_1_decided_at', v_session.participant_1_decided_at,
      'participant_2_decided_at', v_session.participant_2_decided_at,
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner,
      'state_before', v_state_before,
      'state_after', v_session.state::text,
      'deadline_due', true,
      'handshake_deadline_seconds', 60,
      'handshake_grace_removed', true,
      'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
      'p_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', v_terminal_reason,
    'waiting_for_self', v_waiting_for_self,
    'waiting_for_partner', v_waiting_for_partner,
    'local_decision_persisted', NOT v_waiting_for_self,
    'partner_decision_persisted', NOT v_waiting_for_partner
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text) IS
  'Backend-owned Video Date handshake finalizer. Enforces the 60s hard deadline without creating a Last Chance grace window.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260502143000_handshake_deadline_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260502143000_handshake_deadline_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260502143000_handshake_deadline_base(uuid, text, text)
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
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_due boolean := false;
BEGIN
  IF p_action = 'complete_handshake' THEN
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

    RETURN public.finalize_video_date_handshake_deadline(
      p_session_id,
      v_actor,
      'rpc_complete_handshake',
      p_reason
    );
  END IF;

  IF p_action IN ('vibe', 'pass') AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND v_session.ended_at IS NULL
       AND v_session.state = 'handshake'::public.video_date_state
       AND v_session.date_started_at IS NULL
       AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
       AND v_session.handshake_started_at IS NOT NULL THEN
      v_due := v_session.handshake_started_at + interval '60 seconds' <= now();

      IF v_due THEN
        RETURN public.finalize_video_date_handshake_deadline(
          p_session_id,
          v_actor,
          'late_' || p_action || '_after_handshake_deadline',
          p_reason
        );
      END IF;
    END IF;
  END IF;

  RETURN public.video_date_transition_20260502143000_handshake_deadline_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. Enforces the 60s hard handshake deadline without Last Chance grace, then delegates other behavior to the prior implementation.';

CREATE OR REPLACE FUNCTION public.expire_due_joined_video_date_handshakes_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_result jsonb;
  v_mutual integer := 0;
  v_non_mutual integer := 0;
  v_timeout integer := 0;
  v_noop integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NOT NULL
      AND participant_2_joined_at IS NOT NULL
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at + interval '60 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY handshake_started_at, id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_result := public.finalize_video_date_handshake_deadline(
      r.id,
      NULL,
      'server_cleanup_due_joined_handshake',
      NULL
    );

    IF v_result->>'state' = 'date' THEN
      v_mutual := v_mutual + 1;
    ELSIF v_result->>'reason' = 'handshake_not_mutual' THEN
      v_non_mutual := v_non_mutual + 1;
    ELSIF v_result->>'reason' = 'handshake_timeout' THEN
      v_timeout := v_timeout + 1;
    ELSE
      v_noop := v_noop + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'handshake_deadline_completed_mutual', v_mutual,
    'handshake_deadline_not_mutual', v_non_mutual,
    'handshake_deadline_timeout', v_timeout,
    'handshake_deadline_noop', v_noop,
    'limit', v_limit,
    'total', v_mutual + v_non_mutual + v_timeout + v_noop
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_due_joined_video_date_handshakes_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_joined_video_date_handshakes_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_due_joined_video_date_handshakes_bounded(integer) IS
  'Bounded cleanup for both-joined Video Date handshakes that passed the 60s hard deadline. Finalizes by the same decision matrix as complete_handshake.';

DROP FUNCTION IF EXISTS public.expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base(integer);

ALTER FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  RENAME TO expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base(integer)
  TO service_role;

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
  v_base jsonb;
  v_due jsonb;
  v_base_total integer := 0;
  v_due_total integer := 0;
BEGIN
  v_base := public.expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base(v_limit);
  v_due := public.expire_due_joined_video_date_handshakes_bounded(v_limit);
  v_base_total := COALESCE((v_base->>'total')::int, 0);
  v_due_total := COALESCE((v_due->>'total')::int, 0);

  RETURN v_base || jsonb_build_object(
    'handshake_deadline_completed_mutual', COALESCE((v_due->>'handshake_deadline_completed_mutual')::int, 0),
    'handshake_deadline_not_mutual', COALESCE((v_due->>'handshake_deadline_not_mutual')::int, 0),
    'handshake_deadline_timeout', COALESCE((v_due->>'handshake_deadline_timeout')::int, 0),
    'handshake_deadline_noop', COALESCE((v_due->>'handshake_deadline_noop')::int, 0),
    'total', v_base_total + v_due_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) IS
  'Bounded stale video-date phase cleanup. Keeps no-evidence and partial-join cleanup, and finalizes both-joined handshakes that pass the 60s hard deadline without Last Chance grace.';
