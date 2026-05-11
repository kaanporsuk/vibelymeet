-- Add end-reason metadata so the chat call lifecycle banner can tell the user *why* the call ended.
-- Forward-only: extends the ended_reason CHECK with two new values, adds ended_by_user_id, and replaces
-- the match_call_transition RPC body to (a) accept an optional p_reason override and (b) capture
-- ended_by_user_id whenever a user-initiated terminal transition happens.

ALTER TABLE public.match_calls
  ADD COLUMN IF NOT EXISTS ended_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.match_calls
  DROP CONSTRAINT IF EXISTS match_calls_ended_reason_check;

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
      'blocked_pair',
      'unmatched_pair',
      'busy',
      'connection_lost',
      'media_failure'
    )
  );

-- Drop the previous RPC signature (uuid, text) so the new (uuid, text, text) signature can take its
-- place cleanly. Old callers that omit p_reason still hit the new function via DEFAULT NULL.
DROP FUNCTION IF EXISTS public.match_call_transition(uuid, text);

CREATE OR REPLACE FUNCTION public.match_call_transition(
  p_call_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_call      public.match_calls%ROWTYPE;
  v_now       timestamptz := now();
  v_duration  integer;
  v_actor     text;
  v_reason    text;
  v_allowed   text[] := ARRAY[
    'declined',
    'hangup',
    'caller_cancelled',
    'missed',
    'timeout',
    'join_failed',
    'stale_active',
    'provider_error',
    'blocked_pair',
    'unmatched_pair',
    'busy',
    'connection_lost',
    'media_failure'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;

  IF p_action NOT IN ('answer', 'decline', 'end', 'mark_missed', 'heartbeat', 'joined', 'join_failed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;

  IF p_reason IS NOT NULL AND NOT (p_reason = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reason');
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
      UPDATE public.match_calls SET caller_last_seen_at = v_now WHERE id = p_call_id;
    ELSE
      UPDATE public.match_calls SET callee_last_seen_at = v_now WHERE id = p_call_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'last_seen_at', v_now, 'actor', v_actor);
  END IF;

  IF p_action = 'joined' THEN
    IF v_actor = 'caller' THEN
      UPDATE public.match_calls
      SET caller_joined_at = COALESCE(caller_joined_at, v_now), caller_last_seen_at = v_now
      WHERE id = p_call_id;
    ELSE
      UPDATE public.match_calls
      SET callee_joined_at = COALESCE(callee_joined_at, v_now), callee_last_seen_at = v_now
      WHERE id = p_call_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', v_call.status, 'joined_at', v_now, 'actor', v_actor);
  END IF;

  IF p_action = 'answer' THEN
    IF v_call.callee_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'code', 'forbidden_caller_cannot_answer');
    END IF;
    IF v_call.status = 'active' THEN
      RETURN jsonb_build_object('ok', true, 'status', 'active', 'started_at', v_call.started_at, 'idempotent', true);
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
    v_reason := COALESCE(p_reason, 'declined');
    UPDATE public.match_calls
    SET status = 'declined',
        ended_at = v_now,
        ended_reason = COALESCE(ended_reason, v_reason),
        ended_by_user_id = COALESCE(ended_by_user_id, v_uid),
        callee_last_seen_at = v_now
    WHERE id = p_call_id;
    RETURN jsonb_build_object('ok', true, 'status', 'declined', 'ended_at', v_now, 'ended_reason', v_reason);
  END IF;

  IF p_action = 'end' THEN
    IF v_call.status <> 'active' THEN
      IF v_call.status = 'ringing' AND v_call.caller_id = v_uid THEN
        v_reason := COALESCE(p_reason, 'caller_cancelled');
        UPDATE public.match_calls
        SET status = 'missed',
            ended_at = v_now,
            ended_reason = COALESCE(ended_reason, v_reason),
            ended_by_user_id = COALESCE(ended_by_user_id, v_uid),
            caller_last_seen_at = v_now
        WHERE id = p_call_id;
        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now, 'ended_reason', v_reason);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'ended');
    END IF;

    v_duration := CASE
      WHEN v_call.started_at IS NOT NULL
      THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_call.started_at)))::integer)
      ELSE NULL
    END;
    v_reason := COALESCE(p_reason, 'hangup');

    UPDATE public.match_calls
    SET status = 'ended',
        ended_at = v_now,
        duration_seconds = v_duration,
        ended_reason = COALESCE(ended_reason, v_reason),
        -- Only attribute to a user when the reason is user-initiated. Network/provider failures
        -- leave ended_by_user_id NULL so the banner can render "connection lost" without naming
        -- a person.
        ended_by_user_id = COALESCE(
          ended_by_user_id,
          CASE WHEN v_reason IN ('connection_lost', 'provider_error', 'media_failure', 'timeout', 'stale_active')
               THEN NULL
               ELSE v_uid END
        ),
        caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
        callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
    WHERE id = p_call_id;
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'ended',
      'ended_at', v_now,
      'duration_seconds', v_duration,
      'ended_reason', v_reason
    );
  END IF;

  IF p_action = 'mark_missed' THEN
    IF v_call.status <> 'ringing' THEN
      IF v_call.status = 'missed' THEN
        RETURN jsonb_build_object('ok', true, 'status', 'missed', 'idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'missed');
    END IF;
    v_reason := COALESCE(p_reason, 'missed');
    -- mark_missed is system-initiated (ringing timeout); leave ended_by_user_id NULL.
    UPDATE public.match_calls
    SET status = 'missed',
        ended_at = v_now,
        ended_reason = COALESCE(ended_reason, v_reason),
        caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
        callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
    WHERE id = p_call_id;
    RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now, 'ended_reason', v_reason);
  END IF;

  IF p_action = 'join_failed' THEN
    v_reason := COALESCE(p_reason, 'join_failed');
    IF v_call.status = 'ringing' THEN
      UPDATE public.match_calls
      SET status = 'missed',
          ended_at = v_now,
          ended_reason = COALESCE(ended_reason, v_reason),
          ended_by_user_id = COALESCE(
            ended_by_user_id,
            CASE WHEN v_reason IN ('connection_lost', 'provider_error', 'media_failure', 'timeout', 'stale_active')
                 THEN NULL
                 ELSE v_uid END
          ),
          caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
          callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
      WHERE id = p_call_id;
      RETURN jsonb_build_object('ok', true, 'status', 'missed', 'ended_at', v_now, 'ended_reason', v_reason);
    END IF;

    IF v_call.status = 'active' THEN
      v_duration := CASE
        WHEN v_call.started_at IS NOT NULL
        THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_call.started_at)))::integer)
        ELSE NULL
      END;
      UPDATE public.match_calls
      SET status = 'ended',
          ended_at = v_now,
          duration_seconds = v_duration,
          ended_reason = COALESCE(ended_reason, v_reason),
          ended_by_user_id = COALESCE(
            ended_by_user_id,
            CASE WHEN v_reason IN ('connection_lost', 'provider_error', 'media_failure', 'timeout', 'stale_active')
                 THEN NULL
                 ELSE v_uid END
          ),
          caller_last_seen_at = CASE WHEN v_actor = 'caller' THEN v_now ELSE caller_last_seen_at END,
          callee_last_seen_at = CASE WHEN v_actor = 'callee' THEN v_now ELSE callee_last_seen_at END
      WHERE id = p_call_id;
      RETURN jsonb_build_object('ok', true, 'status', 'ended', 'ended_at', v_now, 'duration_seconds', v_duration, 'ended_reason', v_reason);
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_call.status, 'to', 'join_failed');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'unknown_action');

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rpc_exception', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.match_call_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_call_transition(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.match_call_transition IS
  'Backend-owned lifecycle transitions for match_calls with optional reason override. Captures ended_by_user_id for user-initiated terminal transitions; leaves it NULL for system/network failures.';
