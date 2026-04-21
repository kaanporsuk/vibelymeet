-- Backend-only hardening for video_date_transition handshake semantics.
-- Adds a lazy 15s complete_handshake grace window so NULL (no response yet)
-- is distinct from explicit PASS/FALSE.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS handshake_grace_expires_at timestamptz;

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
  v_allow_handshake boolean;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_rowcnt bigint;
  v_partner uuid;
  v_joined_or_started boolean;
  v_state_before text;
  v_grace_expires_at timestamptz;
  v_seconds_remaining integer;
BEGIN
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
      jsonb_build_object(
        'action', p_action,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'session_not_found',
      NULL,
      NULL,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  IF v_session.ended_at IS NULL
     AND v_session.reconnect_grace_ends_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at <= v_now THEN
    v_state_before := v_session.state::text;

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
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
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
      AND profile_id IN (v_p1, v_p2);

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'reconnect_grace_auto_ended',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'reason', 'reconnect_grace_expired'
    );
  END IF;

  v_is_p1 := (v_p1 = v_actor);
  IF NOT v_is_p1 AND v_p2 != v_actor THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'access_denied',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_session.state::text,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  IF p_action = 'sync_reconnect' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at,
      'ended', v_session.ended_at IS NOT NULL,
      'ended_reason', v_session.ended_reason,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'partner_marked_away',
        CASE
          WHEN v_is_p1 THEN v_session.participant_2_away_at IS NOT NULL
          ELSE v_session.participant_1_away_at IS NOT NULL
        END
    );
  END IF;

  IF p_action = 'mark_reconnect_partner_away' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;
    IF v_session.state NOT IN ('handshake'::public.video_date_state, 'date'::public.video_date_state) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not in reconnect-eligible phase', 'code', 'INVALID_PHASE');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN participant_1_away_at ELSE v_now END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN v_now ELSE participant_2_away_at END,
      reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'mark_reconnect_return' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN NULL ELSE participant_1_away_at END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN participant_2_away_at ELSE NULL END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = CASE
        WHEN participant_1_away_at IS NULL AND participant_2_away_at IS NULL THEN NULL
        ELSE reconnect_grace_ends_at
      END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'enter_handshake' THEN
    v_state_before := v_session.state::text;

    IF v_session.ended_at IS NOT NULL THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'session_already_ended',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'enter_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    IF v_session.handshake_started_at IS NULL THEN
      v_allow_handshake :=
        COALESCE(v_session.ready_gate_status, '') = 'both_ready'
        OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR v_session.phase IN ('handshake', 'date');

      IF NOT v_allow_handshake THEN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'blocked',
          'ready_gate_not_ready',
          NULL,
          v_ev,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'enter_handshake',
            'participant_1_liked', v_session.participant_1_liked,
            'participant_2_liked', v_session.participant_2_liked,
            'state_before', v_state_before,
            'state_after', v_session.state::text,
            'grace_expires_at', v_session.handshake_grace_expires_at,
            'p_reason', p_reason
          )
        );
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Both participants must be ready before starting the video date',
          'code', 'READY_GATE_NOT_READY'
        );
      END IF;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'handshake',
      phase = 'handshake',
      handshake_started_at = COALESCE(handshake_started_at, v_now),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_handshake',
      current_room_id = p_session_id,
      current_partner_id = CASE
        WHEN profile_id = v_p1 THEN v_p2
        ELSE v_p1
      END,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      CASE WHEN v_state_before = 'handshake' THEN 'handshake_already_active' ELSE 'handshake_entered' END,
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'enter_handshake',
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  IF p_action = 'vibe' THEN
    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
    v_ev := v_session.event_id;
    v_p1 := v_session.participant_1_id;
    v_p2 := v_session.participant_2_id;
    v_state_before := v_session.state::text;

    IF v_session.ended_at IS NOT NULL THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'session_already_ended',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'vibe',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    IF v_session.handshake_grace_expires_at IS NOT NULL
       AND v_now >= v_session.handshake_grace_expires_at THEN
      UPDATE public.video_sessions
      SET
        participant_1_liked = COALESCE(participant_1_liked, FALSE),
        participant_2_liked = COALESCE(participant_2_liked, FALSE),
        state = 'ended',
        phase = 'ended',
        ended_at = COALESCE(ended_at, v_now),
        ended_reason = 'handshake_grace_expired',
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
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'grace_expired_coerced_to_end',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'vibe',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object('success', false, 'code', 'GRACE_EXPIRED', 'state', 'ended');
    END IF;

    IF v_is_p1 THEN
      UPDATE public.video_sessions
      SET participant_1_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    ELSE
      UPDATE public.video_sessions
      SET participant_2_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    END IF;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, v_now),
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
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);

      SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'vibe_completed_mutual_advanced_to_date',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'vibe',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    IF v_session.participant_1_liked IS FALSE OR v_session.participant_2_liked IS FALSE THEN
      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = COALESCE(ended_at, v_now),
        ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
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
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'vibe_completed_partner_passed_session_ended',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'vibe',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object('success', true, 'state', 'ended');
    END IF;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'vibe_recorded_awaiting_partner',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'vibe',
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  IF p_action = 'complete_handshake' THEN
    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
    v_ev := v_session.event_id;
    v_p1 := v_session.participant_1_id;
    v_p2 := v_session.participant_2_id;
    v_state_before := v_session.state::text;

    IF v_session.ended_at IS NOT NULL THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'session_already_ended',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );
      RETURN jsonb_build_object(
        'success', true,
        'state', 'ended',
        'already_ended', true,
        'reason', v_session.ended_reason
      );
    END IF;

    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, v_now),
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);

      SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_completed_mutual',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    IF v_session.participant_1_liked IS NOT NULL AND v_session.participant_2_liked IS NOT NULL THEN
      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = COALESCE(ended_at, v_now),
        ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
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
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_completed_no_mutual',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object('success', true, 'state', 'ended');
    END IF;

    IF v_session.handshake_grace_expires_at IS NULL THEN
      v_grace_expires_at := v_now + interval '15 seconds';

      UPDATE public.video_sessions
      SET
        handshake_grace_expires_at = v_grace_expires_at,
        state_updated_at = v_now
      WHERE id = p_session_id;

      SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_grace_started',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object(
        'success', true,
        'state', 'handshake',
        'waiting_for_partner', true,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'seconds_remaining', 15
      );
    END IF;

    IF v_now < v_session.handshake_grace_expires_at THEN
      v_seconds_remaining := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_session.handshake_grace_expires_at - v_now)))::int);

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'handshake_grace_active',
        NULL,
        v_ev,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'participant_1_liked', v_session.participant_1_liked,
          'participant_2_liked', v_session.participant_2_liked,
          'state_before', v_state_before,
          'state_after', v_session.state::text,
          'grace_expires_at', v_session.handshake_grace_expires_at,
          'p_reason', p_reason
        )
      );

      RETURN jsonb_build_object(
        'success', true,
        'state', 'handshake',
        'waiting_for_partner', true,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'seconds_remaining', v_seconds_remaining
      );
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_liked = COALESCE(participant_1_liked, FALSE),
      participant_2_liked = COALESCE(participant_2_liked, FALSE),
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = 'handshake_grace_expired',
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
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'handshake_grace_expired_no_mutual',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object('success', true, 'state', 'ended', 'reason', 'handshake_grace_expired');
  END IF;

  IF p_action = 'end' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'state', 'ended',
        'already_ended', true,
        'reason', v_session.ended_reason
      );
    END IF;

    v_joined_or_started := (
      v_session.handshake_started_at IS NOT NULL
      OR v_session.participant_1_joined_at IS NOT NULL
      OR v_session.participant_2_joined_at IS NOT NULL
      OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
      OR v_session.phase IN ('handshake', 'date')
    );

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = COALESCE(p_reason, ended_reason, 'ended_by_participant'),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      RETURN jsonb_build_object('success', true, 'state', 'ended', 'already_ended', true);
    END IF;

    IF COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    ELSIF COALESCE(p_reason, '') = 'beforeunload' AND NOT v_joined_or_started THEN
      v_partner := CASE WHEN v_actor = v_p1 THEN v_p2 ELSE v_p1 END;
      UPDATE public.event_registrations
      SET
        queue_status = 'offline',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id = v_actor;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id = v_partner;
    ELSE
      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    END IF;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
END;
$function$;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. End is idempotent; beforeunload after handshake/Daily join sends both registrations to survey. Handshake completion distinguishes NULL from explicit PASS with a lazy 15s grace window.';
