-- Backend-owned lifecycle transitions for match_calls (1:1 voice/video calls between matches).
-- Replaces direct client UPDATE writes with a single authenticated RPC that enforces
-- valid state transitions with row-level locking.
--
-- Supported actions:
--   answer     — callee only, from ringing → active (sets started_at = now())
--   decline    — callee only, from ringing → declined (sets ended_at = now())
--   end        — caller or callee, from active → ended (sets ended_at = now(), duration_seconds derived server-side)
--   mark_missed — caller or callee, from ringing → missed (sets ended_at = now()); idempotent
--
-- Terminal states (ended, missed, declined) never transition back.
-- Duration is derived from started_at → now() server-side; client-supplied duration is ignored.

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
BEGIN
  -- Auth guard
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;

  -- Validate action
  IF p_action NOT IN ('answer', 'decline', 'end', 'mark_missed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;

  -- Lock the row for this call
  SELECT * INTO v_call
  FROM public.match_calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Participant guard: caller or callee only
  IF v_call.caller_id <> v_uid AND v_call.callee_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  -- Terminal states: idempotent no-op for end/mark_missed, hard-stop for answer/decline
  IF v_call.status IN ('ended', 'missed', 'declined') THEN
    IF p_action IN ('end', 'mark_missed') THEN
      -- Already terminal — treat as success to keep clients happy
      RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'idempotent', true);
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'already_terminal', 'status', v_call.status);
    END IF;
  END IF;

  -- ── ANSWER ──
  IF p_action = 'answer' THEN
    -- Only callee can answer
    IF v_call.callee_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'code', 'forbidden_caller_cannot_answer');
    END IF;
    -- Only from ringing
    IF v_call.status <> 'ringing' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'active');
    END IF;

    UPDATE public.match_calls
    SET status = 'active', started_at = v_now
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'active', 'started_at', v_now);
  END IF;

  -- ── DECLINE ──
  IF p_action = 'decline' THEN
    -- Only callee can decline
    IF v_call.callee_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'code', 'forbidden_caller_cannot_decline');
    END IF;
    -- Only from ringing
    IF v_call.status <> 'ringing' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'declined');
    END IF;

    UPDATE public.match_calls
    SET status = 'declined', ended_at = v_now
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'declined', 'ended_at', v_now);
  END IF;

  -- ── END ──
  IF p_action = 'end' THEN
    -- Either participant can end; must be active
    IF v_call.status <> 'active' THEN
      -- From ringing: caller hung up before answer — treat as missed
      IF v_call.status = 'ringing' AND v_call.caller_id = v_uid THEN
        UPDATE public.match_calls
        SET status = 'missed', ended_at = v_now
        WHERE id = p_call_id;
        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'ended');
    END IF;

    -- Derive duration server-side from started_at
    v_duration_seconds := CASE
      WHEN v_call.started_at IS NOT NULL
      THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_call.started_at)))::integer)
      ELSE NULL
    END;

    UPDATE public.match_calls
    SET status = 'ended', ended_at = v_now, duration_seconds = v_duration_seconds
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'ended', 'ended_at', v_now, 'duration_seconds', v_duration_seconds);
  END IF;

  -- ── MARK_MISSED ──
  IF p_action = 'mark_missed' THEN
    -- Only valid from ringing
    IF v_call.status <> 'ringing' THEN
      -- Idempotent: if already missed it's fine
      IF v_call.status = 'missed' THEN
        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'missed');
    END IF;

    UPDATE public.match_calls
    SET status = 'missed', ended_at = v_now
    WHERE id = p_call_id;

    RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now);
  END IF;

  -- Should never reach here
  RETURN jsonb_build_object('ok', false, 'code', 'unknown_action');

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rpc_exception', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.match_call_transition(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_call_transition(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.match_call_transition IS
  'Backend-owned lifecycle transitions for match_calls. Enforces valid actor/state rules with row locking. Replaces direct client UPDATE writes.';
