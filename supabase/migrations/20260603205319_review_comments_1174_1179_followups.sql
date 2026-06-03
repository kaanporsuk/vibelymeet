-- Review followups for PRs 1174, 1177, and 1179 plus the closed reconnect-grace
-- PR 1173 thread. Keeps public signatures stable.

BEGIN;

-- PR 1179: the startup snapshot wrapper must not mask expired Ready Gates or
-- event-inactive cleanup. Preserve the new participant-safe snapshot for normal
-- active syncs, and delegate terminal/inactive syncs to the pre-snapshot stack.
CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_status text;
  v_server_now_ms bigint;
  v_message text;
BEGIN
  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
       AND (
         v_session.ready_gate_expires_at IS NULL
         OR v_session.ready_gate_expires_at > now()
         OR v_session.ready_gate_status = 'both_ready'
       )
       AND (
         v_session.ready_gate_status <> 'snoozed'
         OR v_session.snooze_expires_at IS NULL
         OR v_session.snooze_expires_at > now()
       ) THEN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

      IF NULLIF(COALESCE(v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'), '') IS NULL THEN
        v_status := COALESCE(
          v_snapshot->>'ready_gate_status',
          v_snapshot->>'status',
          'unknown'
        );

        RETURN COALESCE(v_snapshot, '{}'::jsonb) || jsonb_build_object(
          'success', COALESCE((v_snapshot->>'ok')::boolean, false),
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'startup_snapshot', v_snapshot
        );
      END IF;
    END IF;
  END IF;

  v_result := public.ready_gate_transition_20260603150106_start_snapshot_base(
    p_session_id,
    p_action,
    p_reason
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    BEGIN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_snapshot := NULL;
    END;
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_failed',
      'reason', 'ready_gate_transition_failed',
      'code', 'READY_GATE_TRANSITION_FAILED',
      'error_code', 'READY_GATE_TRANSITION_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Active sync uses get_video_date_start_snapshot_v1; expired, snooze-expired, inactive, and mutation paths delegate to the prior transition stack so terminal cleanup still runs.';

-- PR 1174: queued vibe matches should still be able to promote into Ready Gate
-- when the client reported warning readiness. Ready Gate owns permission recovery;
-- do not downgrade warning into unchecked before drain_match_queue_v2 sees it.
CREATE OR REPLACE FUNCTION public.normalize_event_runtime_readiness_for_pairing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.readiness_status = 'warning' THEN
    NEW.device_capabilities :=
      COALESCE(NEW.device_capabilities, '{}'::jsonb)
      || jsonb_build_object(
        'client_reported_readiness_status', 'warning',
        'server_preserved_readiness_status', 'warning',
        'ready_gate_recovery_authority', 'drain_match_queue_v2'
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  TO service_role;

UPDATE public.event_participant_runtime_state
SET
  readiness_status = 'warning',
  device_capabilities =
    COALESCE(device_capabilities, '{}'::jsonb)
    || jsonb_build_object(
      'client_reported_readiness_status', 'warning',
      'server_preserved_readiness_status', 'warning',
      'server_restored_readiness_status', 'warning',
      'ready_gate_recovery_authority', 'drain_match_queue_v2'
    ),
  updated_at = now()
WHERE readiness_status = 'unchecked'
  AND device_capabilities->>'client_reported_readiness_status' = 'warning';

COMMENT ON FUNCTION public.normalize_event_runtime_readiness_for_pairing() IS
  'Trigger helper for event_participant_runtime_state. Preserves warning readiness so queued vibe drains can enter Ready Gate, where permission recovery is enforced.';

-- PR 1173 thread: pg_cron reconnect-grace expiry must use the same post-date
-- survey eligibility helper as client-driven video_date_transition paths.
CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  r public.video_sessions%ROWTYPE;
  n int := 0;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_should_open_survey boolean := false;
BEGIN
  FOR r IN
    SELECT *
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
      v_now,
      'reconnect_grace_expired',
      r.date_started_at,
      r.state::text,
      r.phase,
      r.participant_1_joined_at,
      r.participant_2_joined_at,
      r.participant_1_remote_seen_at,
      r.participant_2_remote_seen_at
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.events ev
      WHERE ev.id = r.event_id
        AND ev.status = 'live'
        AND ev.archived_at IS NULL
    ) INTO v_event_live;

    v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

    UPDATE public.video_sessions
    SET
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        r.duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
      current_room_id = CASE WHEN v_should_open_survey THEN r.id ELSE NULL END,
      current_partner_id = CASE
        WHEN v_should_open_survey AND profile_id = r.participant_1_id THEN r.participant_2_id
        WHEN v_should_open_survey AND profile_id = r.participant_2_id THEN r.participant_1_id
        ELSE NULL
      END,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id);

    PERFORM public.record_event_loop_observability(
      'expire_video_date_reconnect_graces',
      'success',
      CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'ended_reason', 'reconnect_grace_expired',
        'survey_required', v_should_open_survey,
        'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
        'participant_1_joined_at', r.participant_1_joined_at,
        'participant_2_joined_at', r.participant_2_joined_at,
        'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', r.participant_2_remote_seen_at
      )
    );

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.expire_video_date_reconnect_graces() IS
  'Ends video sessions whose reconnect_grace_ends_at has passed. Confirmed encounters enter post-date survey; unconfirmed encounters resume/idle without showing Vibe/Pass.';

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-video-date-reconnect-graces' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'expire-video-date-reconnect-graces',
      '* * * * *',
      'SELECT public.expire_video_date_reconnect_graces()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'expire-video-date-reconnect-graces cron not rescheduled: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
