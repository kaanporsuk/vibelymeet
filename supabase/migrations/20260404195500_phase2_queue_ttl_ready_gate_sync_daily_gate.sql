-- Phase 2 events hardening: queued TTL + deterministic cleanup + ready-gate sync semantics.
-- Product keeps swipe-first matching and queued matches, with explicit queued TTL.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS queued_expires_at timestamptz;

COMMENT ON COLUMN public.video_sessions.queued_expires_at IS
  'Canonical queued-match TTL deadline. When passed, queued session is expired/ended by backend cleanup.';

-- Backfill queued TTL for existing queued rows that predate this column.
UPDATE public.video_sessions
SET queued_expires_at = COALESCE(queued_expires_at, created_at + interval '10 minutes')
WHERE ready_gate_status = 'queued'
  AND ended_at IS NULL;

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
      'message', 'Your account is currently on a break'
    );
  END IF;

  IF public.is_profile_hidden(p_target_id) THEN
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

      RETURN jsonb_build_object(
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    END IF;

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

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  n int := 0;
  v_new_status text;
BEGIN
  -- Snooze wake-up: return to ready state family with a fresh ready-gate window.
  FOR r IN
    SELECT id, ready_participant_1_at, ready_participant_2_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'snoozed'
      AND snooze_expires_at IS NOT NULL
      AND snooze_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_status :=
      CASE
        WHEN r.ready_participant_1_at IS NOT NULL AND r.ready_participant_2_at IS NOT NULL THEN 'both_ready'
        WHEN r.ready_participant_1_at IS NOT NULL THEN 'ready_a'
        WHEN r.ready_participant_2_at IS NOT NULL THEN 'ready_b'
        ELSE 'ready'
      END;

    UPDATE public.video_sessions
    SET
      ready_gate_status = v_new_status,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      ready_gate_expires_at = v_now + interval '30 seconds',
      state_updated_at = v_now
    WHERE id = r.id;

    n := n + 1;
  END LOOP;

  -- Canonical queued TTL expiry (10 minutes).
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'queued'
      AND COALESCE(queued_expires_at, created_at + interval '10 minutes') <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      queued_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'queued_ttl_expired',
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
  END LOOP;

  -- Ready gate expiry path (non-snoozed active gates whose timer has elapsed).
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status IN ('ready', 'ready_a', 'ready_b')
      AND ready_gate_expires_at IS NOT NULL
      AND ready_gate_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'ready_gate_expired',
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_video_sessions() FROM authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_video_sessions() FROM anon;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Canonical cleanup for queued TTL expiry, ready-gate expiry, and snooze wake-up. Safe for pg_cron and concurrent callers.';

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-stale-video-sessions' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'expire-stale-video-sessions',
      '* * * * *',
      'SELECT public.expire_stale_video_sessions()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'expire-stale-video-sessions cron not scheduled: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_partner_id uuid;
  v_partner_status text;
  v_partner_foregrounded_at timestamptz;
  v_self_status text;
  v_self_foregrounded_at timestamptz;
  v_self_present boolean := false;
  v_partner_present boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized');
  END IF;

  PERFORM public.expire_stale_video_sessions();

  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_self_status, v_self_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid
    AND er.admission_status = 'confirmed';

  v_self_present :=
    v_self_status IN ('browsing', 'idle')
    AND v_self_foregrounded_at IS NOT NULL
    AND v_self_foregrounded_at >= now() - interval '60 seconds';

  IF NOT v_self_present THEN
    RETURN jsonb_build_object('found', false, 'queued', true);
  END IF;

  SELECT * INTO v_match
  FROM public.video_sessions
  WHERE event_id = p_event_id
    AND ready_gate_status = 'queued'
    AND ended_at IS NULL
    AND COALESCE(queued_expires_at, created_at + interval '10 minutes') > now()
    AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid))
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = v_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_partner_status, v_partner_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_partner_id
    AND er.admission_status = 'confirmed';

  v_partner_present :=
    v_partner_status IN ('browsing', 'idle')
    AND v_partner_foregrounded_at IS NOT NULL
    AND v_partner_foregrounded_at >= now() - interval '60 seconds';

  IF v_partner_present THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'ready',
      ready_gate_expires_at = now() + interval '30 seconds',
      queued_expires_at = NULL
    WHERE id = v_match.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_ready_gate',
      current_room_id = v_match.id,
      current_partner_id = CASE
        WHEN profile_id = v_uid THEN v_partner_id
        ELSE v_uid
      END,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_uid, v_partner_id);

    RETURN jsonb_build_object(
      'found', true,
      'match_id', v_match.id,
      'video_session_id', v_match.id,
      'event_id', p_event_id,
      'partner_id', v_partner_id
    );
  END IF;

  RETURN jsonb_build_object('found', false, 'queued', true);
END;
$function$;

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

  -- Poll fallback and lifecycle sync path.
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
    RETURN jsonb_build_object('success', true, 'status', v_session.ready_gate_status);
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
    ELSIF v_is_p1 THEN
      v_new_status := 'ready_a';
    ELSE
      v_new_status := 'ready_b';
    END IF;

    UPDATE public.video_sessions
    SET
      ready_participant_1_at = v_session.ready_participant_1_at,
      ready_participant_2_at = v_session.ready_participant_2_at,
      ready_gate_status = v_new_status,
      ready_gate_expires_at = CASE
        WHEN v_new_status = 'both_ready' THEN ready_gate_expires_at
        ELSE COALESCE(ready_gate_expires_at, v_now + interval '30 seconds')
      END
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', v_new_status);
  END IF;

  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes',
      ready_gate_expires_at = v_now + interval '2 minutes'
    WHERE id = p_session_id;

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
