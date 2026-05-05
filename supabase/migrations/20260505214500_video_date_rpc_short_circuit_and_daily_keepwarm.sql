-- Video Date launch-latency polish:
--   1) Make ready_gate_transition responses explicitly carry result_status.
--   2) Persist the RPC short-circuit both_ready checkpoint.
--   3) Keep daily-room warm through pg_cron when Vault/app secrets are present.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260505214500_result_status_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260505214500_result_status_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505214500_result_status_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

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
  v_result jsonb;
  v_status text;
BEGIN
  v_result := public.ready_gate_transition_20260505214500_result_status_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF jsonb_typeof(v_result) IS DISTINCT FROM 'object' THEN
    RETURN v_result;
  END IF;

  v_status := COALESCE(
    v_result->>'ready_gate_status',
    v_result->>'status',
    v_result->>'result_ready_gate_status',
    v_result->>'result_status'
  );

  IF NULLIF(v_status, '') IS NULL THEN
    RETURN v_result;
  END IF;

  RETURN v_result || jsonb_build_object(
    'result_status', v_status,
    'result_ready_gate_status', v_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Adds result_status/result_ready_gate_status to the existing transition truth so second-tapper clients can act on both_ready from the RPC response without waiting for realtime.';

DROP FUNCTION IF EXISTS public.record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base(uuid, text, jsonb, integer);

ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  RENAME TO record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_own_ready_at timestamptz;
  v_peer_ready_at timestamptz;
  v_ready_actor_order text;
  v_detail jsonb;
BEGIN
  IF v_checkpoint <> 'both_ready_observed_via_rpc_short_circuit' THEN
    RETURN public.record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base(
      p_session_id,
      p_checkpoint,
      p_payload,
      p_latency_ms
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  IF v_session.participant_1_id = v_actor THEN
    v_own_ready_at := v_session.ready_participant_1_at;
    v_peer_ready_at := v_session.ready_participant_2_at;
  ELSE
    v_own_ready_at := v_session.ready_participant_2_at;
    v_peer_ready_at := v_session.ready_participant_1_at;
  END IF;

  v_ready_actor_order := CASE
    WHEN v_own_ready_at IS NULL OR v_peer_ready_at IS NULL THEN NULL
    WHEN v_own_ready_at <= v_peer_ready_at THEN 'first_ready'
    ELSE 'second_ready'
  END;

  v_latency_ms := CASE
    WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
    ELSE COALESCE(
      public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_both_ready_ms', 0, 86400000),
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
    )
  END;

  v_outcome := CASE
    WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
      THEN v_payload->>'outcome'
    ELSE 'success'
  END;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'client_event_name', 'ready_gate_to_date_latency_checkpoint',
    'checkpoint', v_checkpoint,
    'platform', CASE
      WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
      ELSE NULL
    END,
    'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
    'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
    'outcome', v_outcome,
    'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
    'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
    'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
    'ready_actor_order', COALESCE(v_ready_actor_order, public.video_date_launch_latency_safe_text(v_payload->>'ready_actor_order')),
    'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
    'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
    'ready_gate_open_to_ready_tap_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_gate_open_to_ready_tap_ms', 0, 86400000),
    'ready_tap_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_both_ready_ms', 0, 86400000),
    'both_ready_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_date_route_ms', 0, 86400000),
    'both_ready_to_daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_token_ms', 0, 86400000),
    'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
    'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
    'edge_cold_start_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_cold_start_ms', 0, 86400000),
    'edge_process_uptime_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_process_uptime_ms', 0, 86400000),
    'observed_at', now()
  ));

  INSERT INTO public.event_loop_observability_events (
    operation,
    outcome,
    reason_code,
    latency_ms,
    event_id,
    actor_id,
    session_id,
    detail
  ) VALUES (
    'video_date_launch_latency_checkpoint',
    v_outcome,
    v_checkpoint,
    v_latency_ms,
    v_session.event_id,
    v_actor,
    p_session_id,
    v_detail
  );

  RETURN jsonb_build_object('ok', true, 'inserted', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. Adds the RPC short-circuit both_ready checkpoint while delegating existing checkpoints to the prior ingestion function.';

DO $$
DECLARE
  v_job_id integer;
  v_project_url text;
  v_cron_secret text;
  v_function_jwt text;
  v_has_vault boolean := false;
  v_use_vault boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    v_has_vault := EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
    );

    IF v_has_vault THEN
      SELECT trim(decrypted_secret) INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT trim(decrypted_secret) INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_secret'
      LIMIT 1;

      SELECT trim(decrypted_secret) INTO v_function_jwt
      FROM vault.decrypted_secrets
      WHERE name IN ('anon_key', 'supabase_anon_key', 'service_role_key')
      ORDER BY CASE name
        WHEN 'anon_key' THEN 1
        WHEN 'supabase_anon_key' THEN 2
        ELSE 3
      END
      LIMIT 1;

      v_use_vault := NULLIF(v_project_url, '') IS NOT NULL
        AND NULLIF(v_cron_secret, '') IS NOT NULL
        AND NULLIF(v_function_jwt, '') IS NOT NULL;
    END IF;

    v_project_url := COALESCE(NULLIF(v_project_url, ''), NULLIF(trim(current_setting('app.supabase_url', true)), ''));
    v_cron_secret := COALESCE(NULLIF(v_cron_secret, ''), NULLIF(trim(current_setting('app.cron_secret', true)), ''));
    v_function_jwt := COALESCE(
      NULLIF(v_function_jwt, ''),
      NULLIF(trim(current_setting('app.supabase_anon_key', true)), ''),
      NULLIF(trim(current_setting('app.anon_key', true)), ''),
      NULLIF(trim(current_setting('app.service_role_key', true)), '')
    );

    IF v_project_url IS NOT NULL AND v_cron_secret IS NOT NULL AND v_function_jwt IS NOT NULL THEN
      SELECT jobid INTO v_job_id
      FROM cron.job
      WHERE jobname = 'daily-room-keepwarm'
      LIMIT 1;

      IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
      END IF;

      IF v_use_vault THEN
        PERFORM cron.schedule(
          'daily-room-keepwarm',
          '*/5 * * * *',
          $cmd$
          SELECT net.http_post(
            url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
              || '/functions/v1/daily-room',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || trim((
                SELECT decrypted_secret
                FROM vault.decrypted_secrets
                WHERE name IN ('anon_key', 'supabase_anon_key', 'service_role_key')
                ORDER BY CASE name
                  WHEN 'anon_key' THEN 1
                  WHEN 'supabase_anon_key' THEN 2
                  ELSE 3
                END
                LIMIT 1
              )),
              'x-cron-secret', trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
            ),
            body := jsonb_build_object('action', 'health_ping', 'source', 'pg_cron_keepwarm')
          );
          $cmd$
        );
      ELSE
        PERFORM cron.schedule(
          'daily-room-keepwarm',
          '*/5 * * * *',
          $cmd$
          SELECT net.http_post(
            url := nullif(trim(current_setting('app.supabase_url', true)), '')
              || '/functions/v1/daily-room',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || coalesce(
                nullif(trim(current_setting('app.supabase_anon_key', true)), ''),
                nullif(trim(current_setting('app.anon_key', true)), ''),
                nullif(trim(current_setting('app.service_role_key', true)), '')
              ),
              'x-cron-secret', coalesce(nullif(trim(current_setting('app.cron_secret', true)), ''), '')
            ),
            body := jsonb_build_object('action', 'health_ping', 'source', 'pg_cron_keepwarm')
          );
          $cmd$
        );
      END IF;
    ELSE
      RAISE NOTICE 'daily-room-keepwarm cron not scheduled: missing project_url, cron_secret, or function JWT secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'daily-room-keepwarm cron not scheduled: %', SQLERRM;
END $$;
