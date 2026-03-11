-- Stream 2A: Server-owned video-date state machine
-- Goal: replace client-orchestrated phase/timer writes with a canonical, backend-authoritative state + transitions.

-- 1) Canonical state enum (additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'video_date_state'
  ) THEN
    CREATE TYPE public.video_date_state AS ENUM (
      'ready_gate',
      'handshake',
      'date',
      'post_date',
      'ended'
    );
  END IF;
END$$;

-- 2) Add state columns to video_sessions (keep legacy columns for compatibility)
ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS state public.video_date_state NOT NULL DEFAULT 'ready_gate',
  ADD COLUMN IF NOT EXISTS state_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_reason text;

-- Backfill state from legacy phase/ended_at for existing rows
UPDATE public.video_sessions
SET state = CASE
  WHEN ended_at IS NOT NULL THEN 'ended'::public.video_date_state
  WHEN phase = 'date' THEN 'date'::public.video_date_state
  WHEN phase = 'handshake' THEN 'handshake'::public.video_date_state
  ELSE 'ready_gate'::public.video_date_state
END
WHERE state IS NULL;

-- 3) Transition RPC (SECURITY DEFINER; enforces actor is a participant; idempotent)
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
  v_handshake_seconds integer := 60;
  v_date_seconds integer := 300;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Action: enter_handshake (idempotent)
  IF p_action = 'enter_handshake' THEN
    UPDATE public.video_sessions
    SET
      state = 'handshake',
      phase = 'handshake',
      handshake_started_at = COALESCE(handshake_started_at, now()),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  -- Action: vibe (record participant liked during handshake)
  IF p_action = 'vibe' THEN
    IF v_is_p1 THEN
      UPDATE public.video_sessions
      SET participant_1_liked = TRUE, state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
    ELSE
      UPDATE public.video_sessions
      SET participant_2_liked = TRUE, state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
    END IF;

    -- If mutual, start date immediately (server-owned)
    UPDATE public.video_sessions
    SET
      state = 'date',
      phase = 'date',
      date_started_at = COALESCE(date_started_at, now()),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND participant_1_liked IS TRUE
      AND participant_2_liked IS TRUE;

    RETURN jsonb_build_object('success', true);
  END IF;

  -- Action: complete_handshake (called when handshake timer ends)
  IF p_action = 'complete_handshake' THEN
    -- If mutual vibe, ensure date started. If not mutual, end.
    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, now()),
        state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
      duration_seconds = COALESCE(duration_seconds, GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(handshake_started_at, started_at))))::int)),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  -- Action: end (idempotent)
  IF p_action = 'end' THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(p_reason, ended_reason, 'ended_by_participant'),
      duration_seconds = COALESCE(duration_seconds, GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - started_at)))::int)),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action');
END;
$function$;

