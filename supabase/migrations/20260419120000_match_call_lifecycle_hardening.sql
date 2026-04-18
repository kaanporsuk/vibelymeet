-- Harden match_calls lifecycle ownership:
-- - preserve backend-owned state transitions
-- - add participant heartbeat/join metadata
-- - expire stale active calls server-side
-- - mark provider room cleanup so workers do not retry forever

ALTER TABLE public.match_calls
  ADD COLUMN IF NOT EXISTS ended_reason text,
  ADD COLUMN IF NOT EXISTS caller_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS callee_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS caller_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS callee_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_calls_ended_reason_check'
      AND conrelid = 'public.match_calls'::regclass
  ) THEN
    ALTER TABLE public.match_calls
      ADD CONSTRAINT match_calls_ended_reason_check
      CHECK (
        ended_reason IS NULL
        OR ended_reason IN (
          'declined',
          'hangup',
          'caller_cancelled',
          'missed',
          'timeout',
          'join_failed',
          'stale_active',
          'provider_error',
          'busy'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_match_calls_open_last_seen
  ON public.match_calls (
    status,
    caller_last_seen_at,
    callee_last_seen_at,
    started_at,
    created_at
  )
  WHERE status IN ('ringing', 'active');

CREATE INDEX IF NOT EXISTS idx_match_calls_provider_cleanup
  ON public.match_calls (ended_at, provider_deleted_at)
  WHERE status IN ('missed', 'declined', 'ended') AND daily_room_name IS NOT NULL;

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
    IF p_action IN ('end', 'mark_missed', 'join_failed') THEN
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
  'Backend-owned lifecycle transitions for match_calls. Supports answer, decline, end, mark_missed, heartbeat, joined, and join_failed with actor/state guards.';

CREATE OR REPLACE FUNCTION public.expire_stale_match_calls()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now  timestamptz := now();
  v_ringing_cutoff timestamptz := v_now - interval '90 seconds';
  v_active_cutoff timestamptz := v_now - interval '5 minutes';
  r      record;
  n      int := 0;
  v_duration_seconds integer;
BEGIN
  FOR r IN
    SELECT id
    FROM public.match_calls
    WHERE status = 'ringing'
      AND created_at <= v_ringing_cutoff
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.match_calls
    SET status = 'missed',
        ended_at = v_now,
        ended_reason = COALESCE(ended_reason, 'timeout')
    WHERE id = r.id
      AND status = 'ringing';

    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT id, started_at, created_at
    FROM public.match_calls
    WHERE status = 'active'
      AND COALESCE(caller_last_seen_at, started_at, created_at) <= v_active_cutoff
      AND COALESCE(callee_last_seen_at, started_at, created_at) <= v_active_cutoff
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_duration_seconds := CASE
      WHEN r.started_at IS NOT NULL
      THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::integer)
      ELSE NULL
    END;

    UPDATE public.match_calls
    SET status = 'ended',
        ended_at = v_now,
        duration_seconds = v_duration_seconds,
        ended_reason = COALESCE(ended_reason, 'stale_active')
    WHERE id = r.id
      AND status = 'active';

    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;

  IF n > 0 THEN
    RAISE LOG 'expire_stale_match_calls expired % stale rows', n;
  END IF;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM anon;

COMMENT ON FUNCTION public.expire_stale_match_calls IS
  'Marks long-stuck ringing match_calls as missed and stale active match_calls as ended. Called by pg_cron every minute.';
