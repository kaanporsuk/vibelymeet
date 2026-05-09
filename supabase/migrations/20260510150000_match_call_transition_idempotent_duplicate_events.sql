-- Amendment (forward migration): duplicate client events should not fail noisy transitions.
-- Safe to apply after 20260419120000_match_call_lifecycle_hardening (replaces RPC only).

CREATE OR REPLACE FUNCTION public.match_call_transition(
  p_call_id    uuid,
  p_action     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_call  public.match_calls%ROWTYPE;
  v_now   timestamptz := now();
  v_duration_seconds integer;
  v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;

  IF p_action NOT IN ('answer', 'decline', 'end', 'mark_missed', 'heartbeat', 'joined', 'join_failed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;

  SELECT * INTO v_call
  FROM public.match_calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF v_call.caller_id = v_uid THEN
    v_actor := 'caller';
  ELSIF v_call.callee_id = v_uid THEN
    v_actor := 'callee';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF v_call.status IN ('ended', 'missed', 'declined') THEN
    IF p_action IN ('end', 'mark_missed', 'join_failed')
      OR (p_action = 'decline' AND v_call.status = 'declined') THEN
      RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'idempotent', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'already_terminal', 'status', v_call.status);
  END IF;

  IF p_action = 'heartbeat' THEN
    IF v_actor = 'caller' THEN
      UPDATE public.match_calls
      SET caller_last_seen_at = v_now
      WHERE id = p_call_id;
    ELSE
      UPDATE public.match_calls
      SET callee_last_seen_at = v_now
      WHERE id = p_call_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'last_seen_at', v_now, 'actor', v_actor);
  END IF;

  IF p_action = 'joined' THEN
    IF v_actor = 'caller' THEN
      UPDATE public.match_calls
      SET caller_joined_at = COALESCE(caller_joined_at, v_now),
          caller_last_seen_at = v_now
      WHERE id = p_call_id;
    ELSE
      UPDATE public.match_calls
      SET callee_joined_at = COALESCE(callee_joined_at, v_now),
          callee_last_seen_at = v_now
      WHERE id = p_call_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'joined_at', v_now, 'actor', v_actor);
  END IF;

  IF p_action = 'answer' THEN
    IF v_call.callee_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'code', 'forbidden_caller_cannot_answer');
    END IF;

    IF v_call.status = 'active' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'active',
        'started_at', v_call.started_at,
        'idempotent', true
      );
    END IF;

    IF v_call.status <> 'ringing' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'active');
    END IF;

    UPDATE public.match_calls
    SET status = 'active',
        started_at = COALESCE(started_at, v_now),
        callee_last_seen_at = v_now
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'active', 'started_at', v_now);
  END IF;

  IF p_action = 'decline' THEN
    IF v_call.callee_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'code', 'forbidden_caller_cannot_decline');
    END IF;

    IF v_call.status <> 'ringing' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'declined');
    END IF;

    UPDATE public.match_calls
    SET status = 'declined',
        ended_at = v_now,
        ended_reason = COALESCE(ended_reason, 'declined'),
        callee_last_seen_at = v_now
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'declined', 'ended_at', v_now);
  END IF;

  IF p_action = 'end' THEN
    IF v_call.status <> 'active' THEN
      IF v_call.status = 'ringing' AND v_call.caller_id = v_uid THEN
        UPDATE public.match_calls
        SET status = 'missed',
            ended_at = v_now,
            ended_reason = COALESCE(ended_reason, 'caller_cancelled'),
            caller_last_seen_at = v_now
        WHERE id = p_call_id;

        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'ended');
    END IF;

    v_duration_seconds := CASE
      WHEN v_call.started_at IS NOT NULL
      THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_call.started_at)))::integer)
      ELSE NULL
    END;

    UPDATE public.match_calls
    SET status = 'ended',
        ended_at = v_now,
        duration_seconds = v_duration_seconds,
        ended_reason = COALESCE(ended_reason, 'hangup'),
        caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
        callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'ended', 'ended_at', v_now, 'duration_seconds', v_duration_seconds);
  END IF;

  IF p_action = 'mark_missed' THEN
    IF v_call.status <> 'ringing' THEN
      IF v_call.status = 'missed' THEN
        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'missed');
    END IF;

    UPDATE public.match_calls
    SET status = 'missed',
        ended_at = v_now,
        ended_reason = COALESCE(ended_reason, 'missed'),
        caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
        callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now);
  END IF;

  IF p_action = 'join_failed' THEN
    IF v_call.status = 'ringing' THEN
      UPDATE public.match_calls
      SET status = 'missed',
          ended_at = v_now,
          ended_reason = COALESCE(ended_reason, 'join_failed'),
          caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
          callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
      WHERE id = p_call_id;

      RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now);
    END IF;

    IF v_call.status = 'active' THEN
      v_duration_seconds := CASE
        WHEN v_call.started_at IS NOT NULL
        THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_call.started_at)))::integer)
        ELSE NULL
      END;

      UPDATE public.match_calls
      SET status = 'ended',
          ended_at = v_now,
          duration_seconds = v_duration_seconds,
          ended_reason = COALESCE(ended_reason, 'join_failed'),
          caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
          callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
      WHERE id = p_call_id;

      RETURN jsonb_build_object('ok', true, 'status', 'ended', 'ended_at', v_now, 'duration_seconds', v_duration_seconds);
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'join_failed');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'unknown_action');

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rpc_exception', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.match_call_transition(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_call_transition(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.match_call_transition IS
  'Backend-owned lifecycle transitions for match_calls. Supports answer (idempotent when active), decline, end, mark_missed, heartbeat, joined, and join_failed with actor/state guards.';
