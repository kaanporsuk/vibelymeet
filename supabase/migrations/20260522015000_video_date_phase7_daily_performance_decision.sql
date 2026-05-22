-- Vibely Video Date v4 Phase 7.1-7.3:
-- Daily performance decision gate.
--
-- Product rule: do not build or enable a Daily room pool just because it is
-- available. First prove the provider path with durable P95/P99 measurements:
-- room create/verify, token mint, Daily join, first remote frame, reconnect,
-- and extension refresh. Daily tokens remain Edge-only and are never stored.

CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase7_daily_provider_recent
  ON public.event_loop_observability_events(operation, reason_code, created_at DESC)
  WHERE operation IN (
    'create_date_room_provider_verify_skipped',
    'create_date_room_reused_existing_db_room',
    'create_date_room_provider_already_exists',
    'create_date_room_provider_created',
    'create_date_room_provider_recovered_or_recreated',
    'create_date_room_token_issued',
    'create_date_room_provider_error',
    'video_date_launch_latency_checkpoint'
  );

CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase7_daily_provider_event_recent
  ON public.event_loop_observability_events(event_id, operation, reason_code, created_at DESC)
  WHERE event_id IS NOT NULL
    AND operation IN (
      'create_date_room_provider_verify_skipped',
      'create_date_room_reused_existing_db_room',
      'create_date_room_provider_already_exists',
      'create_date_room_provider_created',
      'create_date_room_provider_recovered_or_recreated',
      'create_date_room_token_issued',
      'create_date_room_provider_error',
      'video_date_launch_latency_checkpoint'
    );

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
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
  v_detail jsonb;
  v_result jsonb;
  v_extra jsonb;
BEGIN
  IF v_checkpoint IN (
    'daily_room_create_started',
    'daily_room_create_success',
    'daily_room_create_failure',
    'daily_token_mint_started',
    'daily_token_mint_success',
    'daily_token_mint_failure',
    'daily_reconnect_started',
    'daily_reconnect_success',
    'daily_reconnect_failure',
    'extension_refresh_started',
    'extension_refresh_success',
    'extension_refresh_failure'
  ) THEN
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

    v_latency_ms := CASE
      WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
      WHEN v_checkpoint IN ('daily_room_create_success', 'daily_room_create_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      WHEN v_checkpoint IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      WHEN v_checkpoint IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      WHEN v_checkpoint IN ('extension_refresh_success', 'extension_refresh_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      ELSE
        public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
    END;

    v_outcome := CASE
      WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
        THEN v_payload->>'outcome'
      WHEN v_checkpoint LIKE '%failure' THEN 'failure'
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
      'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
      'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
      'daily_performance_segment', public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment'),
      'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
      'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
      'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
      'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
      'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
      'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
      'extension_mode', public.video_date_launch_latency_safe_text(v_payload->>'extension_mode'),
      'credit_type', public.video_date_launch_latency_safe_text(v_payload->>'credit_type'),
      'extension_mutual', public.video_date_launch_latency_safe_bool(v_payload->>'extension_mutual'),
      'extension_awaiting_partner', public.video_date_launch_latency_safe_bool(v_payload->>'extension_awaiting_partner'),
      'extension_applied', public.video_date_launch_latency_safe_bool(v_payload->>'extension_applied'),
      'reconnect_source', public.video_date_launch_latency_safe_text(v_payload->>'reconnect_source'),
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
  END IF;

  BEGIN
    v_result := public.record_vd_launch_latency_202605061020_base(
      p_session_id,
      p_checkpoint,
      p_payload,
      p_latency_ms
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
  END;

  IF COALESCE((v_result->>'inserted')::boolean, false) AND v_actor IS NOT NULL THEN
    BEGIN
      v_extra := jsonb_strip_nulls(jsonb_build_object(
        'provider_verify_reason', public.video_date_launch_latency_safe_text(v_payload->>'provider_verify_reason'),
        'auth_ms', public.video_date_launch_latency_safe_int(v_payload->>'auth_ms', 0, 86400000),
        'prepare_rpc_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_rpc_ms', 0, 86400000),
        'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
        'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
        'confirm_prepare_ms', public.video_date_launch_latency_safe_int(v_payload->>'confirm_prepare_ms', 0, 86400000),
        'edge_total_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_total_ms', 0, 86400000),
        'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
        'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
        'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
        'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000)
      ));

      IF v_extra <> '{}'::jsonb THEN
        UPDATE public.event_loop_observability_events
        SET detail = detail || v_extra
        WHERE id = (
          SELECT id
          FROM public.event_loop_observability_events
          WHERE operation = 'video_date_launch_latency_checkpoint'
            AND actor_id = v_actor
            AND session_id = p_session_id
            AND reason_code = v_checkpoint
          ORDER BY created_at DESC
          LIMIT 1
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN v_result;
    END;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. '
  'Phase 7 adds Daily performance decision checkpoints for room create, token mint, reconnect, and extension refresh. '
  'Payload remains allowlisted and token-free.';

CREATE OR REPLACE VIEW public.vw_video_date_daily_performance_samples
WITH (security_invoker = true)
AS
WITH provider_samples AS (
  SELECT
    eo.created_at,
    eo.event_id,
    eo.session_id,
    eo.actor_id,
    'edge'::text AS platform,
    CASE
      WHEN eo.operation = 'create_date_room_provider_error'
        AND eo.detail->>'provider_operation' = 'create_token' THEN 'token_mint'
      WHEN eo.operation IN (
        'create_date_room_provider_verify_skipped',
        'create_date_room_reused_existing_db_room',
        'create_date_room_provider_already_exists',
        'create_date_room_provider_created',
        'create_date_room_provider_recovered_or_recreated',
        'create_date_room_provider_error'
      ) THEN 'room_create_or_verify'
      WHEN eo.operation = 'create_date_room_token_issued' THEN 'token_mint'
      ELSE NULL
    END AS segment_key,
    CASE
      WHEN eo.operation = 'create_date_room_provider_error'
        AND eo.detail->>'provider_operation' = 'create_token' THEN 'Daily token mint'
      WHEN eo.operation IN (
        'create_date_room_provider_verify_skipped',
        'create_date_room_reused_existing_db_room',
        'create_date_room_provider_already_exists',
        'create_date_room_provider_created',
        'create_date_room_provider_recovered_or_recreated',
        'create_date_room_provider_error'
      ) THEN 'Daily room create/verify'
      WHEN eo.operation = 'create_date_room_token_issued' THEN 'Daily token mint'
      ELSE NULL
    END AS segment_label,
    eo.outcome,
    eo.reason_code,
    eo.latency_ms,
    eo.operation AS source_operation,
    eo.detail
  FROM public.event_loop_observability_events eo
  WHERE eo.operation IN (
    'create_date_room_provider_verify_skipped',
    'create_date_room_reused_existing_db_room',
    'create_date_room_provider_already_exists',
    'create_date_room_provider_created',
    'create_date_room_provider_recovered_or_recreated',
    'create_date_room_token_issued',
    'create_date_room_provider_error'
  )
),
client_samples AS (
  SELECT
    eo.created_at,
    eo.event_id,
    eo.session_id,
    eo.actor_id,
    COALESCE(public.video_date_launch_latency_safe_text(eo.detail->>'platform'), 'unknown') AS platform,
    CASE
      WHEN eo.reason_code IN ('daily_room_create_success', 'daily_room_create_failure') THEN 'room_create_or_verify'
      WHEN eo.reason_code IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN 'token_mint'
      WHEN eo.reason_code IN ('daily_join_success', 'daily_join_failure') THEN 'daily_join'
      WHEN eo.reason_code = 'first_remote_frame' THEN 'first_remote_frame'
      WHEN eo.reason_code IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN 'daily_reconnect'
      WHEN eo.reason_code IN ('extension_refresh_success', 'extension_refresh_failure') THEN 'extension_refresh'
      ELSE NULL
    END AS segment_key,
    CASE
      WHEN eo.reason_code IN ('daily_room_create_success', 'daily_room_create_failure') THEN 'Daily room create/verify'
      WHEN eo.reason_code IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN 'Daily token mint'
      WHEN eo.reason_code IN ('daily_join_success', 'daily_join_failure') THEN 'Daily join'
      WHEN eo.reason_code = 'first_remote_frame' THEN 'First remote frame'
      WHEN eo.reason_code IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN 'Daily reconnect'
      WHEN eo.reason_code IN ('extension_refresh_success', 'extension_refresh_failure') THEN 'Extension refresh'
      ELSE NULL
    END AS segment_label,
    eo.outcome,
    eo.reason_code,
    CASE
      WHEN eo.reason_code IN ('daily_room_create_success', 'daily_room_create_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(eo.detail->>'daily_room_create_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(eo.detail->>'room_create_or_verify_ms', 0, 86400000),
          eo.latency_ms,
          public.video_date_launch_latency_safe_int(eo.detail->>'duration_ms', 0, 86400000)
        )
      WHEN eo.reason_code IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(eo.detail->>'daily_token_mint_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(eo.detail->>'token_ms', 0, 86400000),
          eo.latency_ms,
          public.video_date_launch_latency_safe_int(eo.detail->>'duration_ms', 0, 86400000)
        )
      WHEN eo.reason_code = 'first_remote_frame' THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(eo.detail->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
          eo.latency_ms,
          public.video_date_launch_latency_safe_int(eo.detail->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
        )
      WHEN eo.reason_code IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN
        COALESCE(
          eo.latency_ms,
          public.video_date_launch_latency_safe_int(eo.detail->>'daily_reconnect_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(eo.detail->>'duration_ms', 0, 86400000)
        )
      WHEN eo.reason_code IN ('extension_refresh_success', 'extension_refresh_failure') THEN
        COALESCE(
          eo.latency_ms,
          public.video_date_launch_latency_safe_int(eo.detail->>'extension_refresh_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(eo.detail->>'duration_ms', 0, 86400000)
        )
      ELSE
        COALESCE(eo.latency_ms, public.video_date_launch_latency_safe_int(eo.detail->>'duration_ms', 0, 86400000))
    END AS latency_ms,
    eo.operation AS source_operation,
    eo.detail
  FROM public.event_loop_observability_events eo
  WHERE eo.operation = 'video_date_launch_latency_checkpoint'
)
SELECT *
FROM provider_samples
WHERE segment_key IS NOT NULL
  AND latency_ms IS NOT NULL
  AND latency_ms >= 0
UNION ALL
SELECT *
FROM client_samples
WHERE segment_key IS NOT NULL
  AND latency_ms IS NOT NULL
  AND latency_ms >= 0;

REVOKE ALL ON TABLE public.vw_video_date_daily_performance_samples FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_daily_performance_samples TO service_role;

COMMENT ON VIEW public.vw_video_date_daily_performance_samples IS
  'Service-role Daily performance samples for Phase 7. Segments room create/verify, token mint, join, first remote frame, reconnect, and extension refresh. Contains no Daily tokens.';

CREATE OR REPLACE VIEW public.vw_video_date_daily_performance_segment_health
WITH (security_invoker = true)
AS
WITH windows(window_id, window_label, window_interval) AS (
  VALUES
    ('24h'::text, '24 hours'::text, interval '24 hours'),
    ('7d'::text, '7 days'::text, interval '7 days')
)
SELECT
  w.window_id,
  w.window_label,
  s.event_id,
  s.platform,
  s.segment_key,
  s.segment_label,
  count(*)::integer AS sample_count,
  count(*) FILTER (WHERE s.outcome = 'success')::integer AS success_count,
  count(*) FILTER (WHERE s.outcome = 'failure')::integer AS failure_count,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY s.latency_ms)::integer AS p50_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY s.latency_ms)::integer AS p95_ms,
  percentile_disc(0.99) WITHIN GROUP (ORDER BY s.latency_ms)::integer AS p99_ms,
  max(s.latency_ms)::integer AS max_ms,
  CASE s.segment_key
    WHEN 'first_remote_frame' THEN 5000
    WHEN 'daily_join' THEN 3000
    WHEN 'daily_reconnect' THEN 5000
    WHEN 'extension_refresh' THEN 1500
    WHEN 'room_create_or_verify' THEN 1500
    WHEN 'token_mint' THEN 1200
    ELSE 5000
  END AS p95_target_ms,
  CASE s.segment_key
    WHEN 'first_remote_frame' THEN 8000
    WHEN 'daily_join' THEN 6000
    WHEN 'daily_reconnect' THEN 10000
    WHEN 'extension_refresh' THEN 3000
    WHEN 'room_create_or_verify' THEN 3000
    WHEN 'token_mint' THEN 2500
    ELSE 10000
  END AS p99_target_ms,
  CASE
    WHEN count(*) < 5 THEN 'insufficient_data'
    WHEN percentile_disc(0.99) WITHIN GROUP (ORDER BY s.latency_ms) >
      CASE s.segment_key
        WHEN 'first_remote_frame' THEN 8000
        WHEN 'daily_join' THEN 6000
        WHEN 'daily_reconnect' THEN 10000
        WHEN 'extension_refresh' THEN 3000
        WHEN 'room_create_or_verify' THEN 3000
        WHEN 'token_mint' THEN 2500
        ELSE 10000
      END THEN 'critical'
    WHEN percentile_disc(0.95) WITHIN GROUP (ORDER BY s.latency_ms) >
      CASE s.segment_key
        WHEN 'first_remote_frame' THEN 5000
        WHEN 'daily_join' THEN 3000
        WHEN 'daily_reconnect' THEN 5000
        WHEN 'extension_refresh' THEN 1500
        WHEN 'room_create_or_verify' THEN 1500
        WHEN 'token_mint' THEN 1200
        ELSE 5000
      END THEN 'warning'
    ELSE 'healthy'
  END AS segment_status,
  max(s.created_at) AS last_sample_at
FROM windows w
JOIN public.vw_video_date_daily_performance_samples s
  ON s.created_at >= now() - w.window_interval
GROUP BY
  w.window_id,
  w.window_label,
  s.event_id,
  s.platform,
  s.segment_key,
  s.segment_label;

REVOKE ALL ON TABLE public.vw_video_date_daily_performance_segment_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_daily_performance_segment_health TO service_role;

COMMENT ON VIEW public.vw_video_date_daily_performance_segment_health IS
  'Service-role P50/P95/P99 Daily segment health for Phase 7 performance decisions. P95/P99 targets encode the no-pool-unless-measured threshold.';

CREATE OR REPLACE VIEW public.vw_video_date_daily_pool_decision
WITH (security_invoker = true)
AS
WITH event_windows AS (
  SELECT DISTINCT window_id, window_label, event_id
  FROM public.vw_video_date_daily_performance_segment_health
),
rolled AS (
  SELECT
    ew.window_id,
    ew.window_label,
    ew.event_id,
    frame.sample_count AS first_frame_sample_count,
    frame.p95_ms AS first_frame_p95_ms,
    frame.p99_ms AS first_frame_p99_ms,
    room.sample_count AS room_sample_count,
    room.p95_ms AS room_p95_ms,
    room.p99_ms AS room_p99_ms,
    token.sample_count AS token_sample_count,
    token.p95_ms AS token_p95_ms,
    token.p99_ms AS token_p99_ms,
    joinseg.sample_count AS join_sample_count,
    joinseg.p95_ms AS join_p95_ms,
    joinseg.p99_ms AS join_p99_ms,
    reconnect.sample_count AS reconnect_sample_count,
    reconnect.p95_ms AS reconnect_p95_ms,
    extension.sample_count AS extension_refresh_sample_count,
    extension.p95_ms AS extension_refresh_p95_ms
  FROM event_windows ew
  LEFT JOIN LATERAL (
    SELECT
      sum(sample_count)::integer AS sample_count,
      max(p95_ms)::integer AS p95_ms,
      max(p99_ms)::integer AS p99_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'first_remote_frame'
  ) frame ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(sample_count)::integer AS sample_count,
      max(p95_ms)::integer AS p95_ms,
      max(p99_ms)::integer AS p99_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'room_create_or_verify'
  ) room ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(sample_count)::integer AS sample_count,
      max(p95_ms)::integer AS p95_ms,
      max(p99_ms)::integer AS p99_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'token_mint'
  ) token ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(sample_count)::integer AS sample_count,
      max(p95_ms)::integer AS p95_ms,
      max(p99_ms)::integer AS p99_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'daily_join'
  ) joinseg ON true
  LEFT JOIN LATERAL (
    SELECT sum(sample_count)::integer AS sample_count, max(p95_ms)::integer AS p95_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'daily_reconnect'
  ) reconnect ON true
  LEFT JOIN LATERAL (
    SELECT sum(sample_count)::integer AS sample_count, max(p95_ms)::integer AS p95_ms
    FROM public.vw_video_date_daily_performance_segment_health h
    WHERE h.window_id = ew.window_id
      AND h.event_id IS NOT DISTINCT FROM ew.event_id
      AND h.segment_key = 'extension_refresh'
  ) extension ON true
)
SELECT
  r.*,
  CASE
    WHEN COALESCE(r.first_frame_sample_count, 0) < 20 THEN false
    WHEN COALESCE(r.first_frame_p95_ms, 0) <= 5000
      AND COALESCE(r.first_frame_p99_ms, 0) <= 8000 THEN false
    WHEN COALESCE(r.room_sample_count, 0) < 10 THEN false
    WHEN (
      COALESCE(r.room_p95_ms, 0) >= 1500
      OR COALESCE(r.room_p99_ms, 0) >= 3000
    )
    AND COALESCE(r.first_frame_p95_ms, 0) > 5000 THEN true
    ELSE false
  END AS room_pool_recommended,
  CASE
    WHEN COALESCE(r.first_frame_sample_count, 0) < 20 THEN 'insufficient_first_frame_samples'
    WHEN COALESCE(r.first_frame_p95_ms, 0) <= 5000
      AND COALESCE(r.first_frame_p99_ms, 0) <= 8000 THEN 'pool_not_needed_first_frame_within_target'
    WHEN COALESCE(r.room_sample_count, 0) < 10 THEN 'insufficient_room_create_samples'
    WHEN (
      COALESCE(r.room_p95_ms, 0) >= 1500
      OR COALESCE(r.room_p99_ms, 0) >= 3000
    )
    AND COALESCE(r.first_frame_p95_ms, 0) > 5000 THEN 'evaluate_daily_room_pool_room_create_is_bottleneck'
    ELSE 'pool_not_recommended_investigate_join_client_or_network_segments'
  END AS decision_reason,
  CASE
    WHEN COALESCE(r.first_frame_sample_count, 0) < 20 THEN 'insufficient_data'
    WHEN COALESCE(r.first_frame_p95_ms, 0) <= 5000
      AND COALESCE(r.first_frame_p99_ms, 0) <= 8000 THEN 'healthy'
    WHEN (
      COALESCE(r.room_p95_ms, 0) >= 1500
      OR COALESCE(r.room_p99_ms, 0) >= 3000
    )
    AND COALESCE(r.first_frame_p95_ms, 0) > 5000 THEN 'warning'
    ELSE 'warning'
  END AS decision_status
FROM rolled r;

REVOKE ALL ON TABLE public.vw_video_date_daily_pool_decision FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_daily_pool_decision TO service_role;

COMMENT ON VIEW public.vw_video_date_daily_pool_decision IS
  'Service-role Phase 7 decision view. Recommends a Daily room pool only when first-frame P95/P99 breaches and room create/verify is a measured bottleneck.';

CREATE OR REPLACE FUNCTION public.get_video_date_daily_performance_decision(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  window_id text,
  window_label text,
  event_id uuid,
  first_frame_sample_count integer,
  first_frame_p95_ms integer,
  first_frame_p99_ms integer,
  room_sample_count integer,
  room_p95_ms integer,
  room_p99_ms integer,
  token_sample_count integer,
  token_p95_ms integer,
  token_p99_ms integer,
  join_sample_count integer,
  join_p95_ms integer,
  join_p99_ms integer,
  reconnect_sample_count integer,
  reconnect_p95_ms integer,
  extension_refresh_sample_count integer,
  extension_refresh_p95_ms integer,
  room_pool_recommended boolean,
  decision_reason text,
  decision_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    d.window_id,
    d.window_label,
    d.event_id,
    d.first_frame_sample_count,
    d.first_frame_p95_ms,
    d.first_frame_p99_ms,
    d.room_sample_count,
    d.room_p95_ms,
    d.room_p99_ms,
    d.token_sample_count,
    d.token_p95_ms,
    d.token_p99_ms,
    d.join_sample_count,
    d.join_p95_ms,
    d.join_p99_ms,
    d.reconnect_sample_count,
    d.reconnect_p95_ms,
    d.extension_refresh_sample_count,
    d.extension_refresh_p95_ms,
    d.room_pool_recommended,
    d.decision_reason,
    d.decision_status
  FROM public.vw_video_date_daily_pool_decision d
  WHERE p_event_id IS NULL OR d.event_id = p_event_id
  ORDER BY CASE d.window_id WHEN '24h' THEN 0 ELSE 1 END, d.event_id;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_daily_performance_decision(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_daily_performance_decision(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_daily_performance_decision(uuid) IS
  'Service-role Phase 7 Daily performance decision RPC. Keeps video_date.daily_pool_v2 gated until measured P95/P99 requires a room pool.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260522015000',
  'Video Date Phase 7 Daily performance decision gate',
  'schema+policy',
  'Adds token-free Daily performance checkpoints, service-role segment health views, and a no-pool-unless-measured decision RPC. No client-visible state mutation and no Daily room pool runtime behavior.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
