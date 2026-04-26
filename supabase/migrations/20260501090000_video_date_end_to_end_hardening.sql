-- Video Date end-to-end hardening:
-- - Idempotent credit extension spends with canonical server seconds.
-- - Post-date verdict only for terminal sessions that actually reached date phase.
-- - Super-vibe cap serialized per actor/event to close count-before-insert races.
-- - Ready Gate both_ready gets a short authoritative date-entry join window.

CREATE TABLE IF NOT EXISTS public.video_date_credit_extension_spends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credit_type text NOT NULL CHECK (credit_type IN ('extra_time', 'extended_vibe')),
  idempotency_key text NOT NULL,
  added_seconds integer NOT NULL CHECK (added_seconds > 0),
  date_extra_seconds_after integer NOT NULL CHECK (date_extra_seconds_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id, credit_type, idempotency_key)
);

ALTER TABLE public.video_date_credit_extension_spends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_date_credit_extension_spends FROM PUBLIC;
GRANT SELECT ON TABLE public.video_date_credit_extension_spends TO service_role;

COMMENT ON TABLE public.video_date_credit_extension_spends IS
  'Server-owned idempotency ledger for paid video-date time extensions. Clients never mutate this table directly.';

DROP FUNCTION IF EXISTS public.spend_video_date_credit_extension(uuid, text);

CREATE OR REPLACE FUNCTION public.spend_video_date_credit_extension(
  p_session_id uuid,
  p_credit_type text,
  p_idempotency_key text DEFAULT NULL
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing record;
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_add := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credit_type');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_uid
      AND credit_type = v_credit_type
      AND idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'added_seconds', v_existing.added_seconds,
        'date_extra_seconds', v_existing.date_extra_seconds_after,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT * INTO v_sess FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_uid
      AND credit_type = v_credit_type
      AND idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'added_seconds', v_existing.added_seconds,
        'date_extra_seconds', v_existing.date_extra_seconds_after,
        'idempotent', true
      );
    END IF;
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

  IF v_credit_type = 'extra_time' THEN
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
  WHERE id = p_session_id
  RETURNING date_extra_seconds INTO v_new_total;

  IF v_key IS NOT NULL THEN
    INSERT INTO public.video_date_credit_extension_spends (
      session_id,
      user_id,
      credit_type,
      idempotency_key,
      added_seconds,
      date_extra_seconds_after
    )
    VALUES (
      p_session_id,
      v_uid,
      v_credit_type,
      v_key,
      v_add,
      v_new_total
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'added_seconds', v_add,
    'date_extra_seconds', v_new_total,
    'idempotent', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) IS
  'Participant-only: idempotently deduct one extra_time or extended_vibe credit and add +120s or +300s to video_sessions.date_extra_seconds while in date phase.';

CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
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
      'mutual', false
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  SELECT liked INTO v_user1_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_1_id;

  SELECT liked INTO v_user2_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_2_id;

  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
    v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    SELECT id INTO v_existing_match
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2;

    IF v_existing_match IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_p1, v_p2, v_session.event_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      END IF;

      SELECT id INTO v_existing_match
      FROM public.matches
      WHERE profile_id_1 = v_p1
        AND profile_id_2 = v_p2;

      RETURN jsonb_build_object(
        'success', true,
        'mutual', true,
        'match_id', v_existing_match,
        'already_matched', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'mutual', true,
      'match_id', v_existing_match,
      'already_matched', true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;

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

  v_inner := public.check_mutual_vibe_and_match(p_session_id);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object('verdict_recorded', true);
  END IF;

  v_persistent_created := NULL;
  IF COALESCE((v_inner->>'mutual')::boolean, false) THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.check_mutual_vibe_and_match(uuid) IS
  'Post-date mutual-match primitive. Refuses blocked pairs and non-survey-eligible sessions before creating persistent matches.';

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records verdict and runs mutual matching only for terminal sessions that reached date phase.';

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
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
  v_new_status text;
  v_expires_at timestamptz;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  PERFORM public.expire_stale_video_sessions();

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  IF p_action = 'sync' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', v_session.ready_gate_status,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at
    );
  END IF;

  IF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  IF p_action = 'mark_ready' THEN
    IF v_is_p1 AND v_session.ready_participant_1_at IS NULL THEN
      v_session.ready_participant_1_at := v_now;
    ELSIF NOT v_is_p1 AND v_session.ready_participant_2_at IS NULL THEN
      v_session.ready_participant_2_at := v_now;
    END IF;

    IF v_session.ready_participant_1_at IS NOT NULL
       AND v_session.ready_participant_2_at IS NOT NULL THEN
      v_new_status := 'both_ready';
      v_expires_at := GREATEST(
        COALESCE(v_session.ready_gate_expires_at, v_now),
        v_now + interval '15 seconds'
      );
    ELSIF v_is_p1 THEN
      v_new_status := 'ready_a';
      v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
    ELSE
      v_new_status := 'ready_b';
      v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
    END IF;

    UPDATE public.video_sessions
    SET
      ready_participant_1_at = v_session.ready_participant_1_at,
      ready_participant_2_at = v_session.ready_participant_2_at,
      ready_gate_status = v_new_status,
      ready_gate_expires_at = v_expires_at,
      state = 'ready_gate',
      phase = 'ready_gate',
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_new_status,
      'ready_gate_expires_at', v_expires_at
    );
  END IF;

  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes',
      ready_gate_expires_at = v_now + interval '2 minutes',
      state = 'ready_gate',
      phase = 'ready_gate',
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL;

    RETURN jsonb_build_object('success', true, 'status', 'snoozed');
  END IF;

  IF p_action = 'forfeit' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'forfeited',
      ready_gate_expires_at = v_now,
      queued_expires_at = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

    RETURN jsonb_build_object('success', true, 'status', 'forfeited');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

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
      'message', 'Your profile is currently hidden from discovery'
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
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
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'handle_swipe_super_vibe_cap:' || p_event_id::text || ':' || p_actor_id::text,
        0
      )
    );

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

    UPDATE public.event_registrations
    SET
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

GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Super-vibe cap is serialized by actor/event advisory lock before count+insert.';
