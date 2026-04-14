-- Server-durable budget for paid date extensions so phase expiry cannot end a credit-extended date early.
-- Product: base date phase = 300s; extra_time credit = +120s; extended_vibe = +300s (matches client KeepTheVibe).

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS date_extra_seconds integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.video_sessions.date_extra_seconds IS
  'Additional seconds granted during the date phase via spend_video_date_credit_extension (extra_time +120, extended_vibe +300 per use). Expiry uses 300 + date_extra_seconds + 60s buffer.';

-- Atomic: deduct one credit for auth user + bump session budget (date phase only).
CREATE OR REPLACE FUNCTION public.spend_video_date_credit_extension(
  p_session_id uuid,
  p_credit_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sess record;
  v_add int;
  v_rows int;
  v_new_total int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_add := CASE lower(btrim(COALESCE(p_credit_type, '')))
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credit_type');
  END IF;

  SELECT * INTO v_sess FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_sess.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_ended');
  END IF;

  IF v_sess.state IS DISTINCT FROM 'date'::public.video_date_state THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_in_date_phase');
  END IF;

  IF v_uid NOT IN (v_sess.participant_1_id, v_sess.participant_2_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF lower(btrim(COALESCE(p_credit_type, ''))) = 'extra_time' THEN
    UPDATE public.user_credits
    SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = v_uid AND extra_time_credits > 0;
  ELSE
    UPDATE public.user_credits
    SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = v_uid AND extended_vibe_credits > 0;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits');
  END IF;

  UPDATE public.video_sessions
  SET
    date_extra_seconds = COALESCE(date_extra_seconds, 0) + v_add,
    state_updated_at = now()
  WHERE id = p_session_id;

  SELECT date_extra_seconds INTO v_new_total FROM public.video_sessions WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'added_seconds', v_add,
    'date_extra_seconds', v_new_total
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.spend_video_date_credit_extension(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.spend_video_date_credit_extension(uuid, text) IS
  'Participant-only: deduct one extra_time or extended_vibe credit and add +120s or +300s to video_sessions.date_extra_seconds while in date phase. Single transaction.';

-- Replace date-phase expiry to honor 300s base + date_extra_seconds + 60s buffer.
CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  v_h int := 0;
  v_d int := 0;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'handshake_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.handshake_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_h := v_h + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL
      AND date_started_at
        + ((300 + COALESCE(date_extra_seconds, 0) + 60) * interval '1 second') <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'date_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.date_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'handshake_timeout', v_h,
    'date_timeout', v_d,
    'total', v_h + v_d
  );
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_date_phases() IS
  'Ends stale handshake (60s+30s buffer) and date (300s base + video_sessions.date_extra_seconds + 60s buffer). Skips active reconnect-grace windows.';
