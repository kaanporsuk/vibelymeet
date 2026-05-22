-- Vibely Video Date v4 Phase 7/8 audit hardening:
-- close the measurement and certification-automation gaps found after Phase 8.
--
-- This migration is additive/forward-only:
-- - Daily join and first-remote-frame checkpoints become explicit durable
--   Phase 7 samples, not just generic launch breadcrumbs.
-- - Operators get a service-role emission-health view/RPC for all six Daily
--   performance segments so dark emitters are visible before rollout gates.
-- - No Daily credential material is stored.

DROP FUNCTION IF EXISTS public.record_vd_launch_latency_202605220240_base(uuid, text, jsonb, integer);

ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  RENAME TO record_vd_launch_latency_202605220240_base;

REVOKE ALL ON FUNCTION public.record_vd_launch_latency_202605220240_base(uuid, text, jsonb, integer)
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
BEGIN
  IF v_checkpoint IN (
    'daily_join_started',
    'daily_join_success',
    'daily_join_failure',
    'first_remote_frame'
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
      WHEN v_checkpoint = 'first_remote_frame' THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
          CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
          public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      WHEN v_checkpoint IN ('daily_join_success', 'daily_join_failure') THEN
        COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
          CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
      ELSE
        COALESCE(
          CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        )
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
      'daily_performance_segment', CASE
        WHEN v_checkpoint LIKE 'daily_join_%' THEN 'daily_join'
        WHEN v_checkpoint = 'first_remote_frame' THEN 'first_remote_frame'
        ELSE public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment')
      END,
      'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
      'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
      'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
      'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
      'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
      'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
      'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
      'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
      'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
      'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
      'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
      'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
      'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
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
    RETURN public.record_vd_launch_latency_202605220240_base(
      p_session_id,
      p_checkpoint,
      p_payload,
      p_latency_ms
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. Phase 7 audit hardening explicitly captures Daily join and first remote frame as durable Daily performance decision samples; other checkpoints delegate to the prior allowlisted wrapper. Payload remains allowlisted and credential-free.';

CREATE OR REPLACE VIEW public.vw_video_date_daily_performance_emission_health
WITH (security_invoker = true)
AS
WITH
segments(segment_key, segment_label, minimum_samples, blocks_rollout_gate) AS (
  VALUES
    ('room_create_or_verify'::text, 'Daily room create/verify'::text, 10::integer, false::boolean),
    ('token_mint'::text, 'Daily token mint'::text, 10::integer, false::boolean),
    ('daily_join'::text, 'Daily join'::text, 20::integer, true::boolean),
    ('first_remote_frame'::text, 'First remote frame'::text, 20::integer, true::boolean),
    ('daily_reconnect'::text, 'Daily reconnect'::text, 5::integer, false::boolean),
    ('extension_refresh'::text, 'Extension refresh'::text, 5::integer, false::boolean)
),
windows(window_id, window_label, window_interval, stale_after) AS (
  VALUES
    ('24h'::text, '24 hours'::text, interval '24 hours', interval '6 hours'),
    ('7d'::text, '7 days'::text, interval '7 days', interval '2 days')
),
event_scope AS (
  SELECT NULL::uuid AS event_id
  UNION
  SELECT e.id AS event_id
  FROM public.events e
  WHERE e.event_date >= now() - interval '30 days'
    AND e.event_date < now() + interval '30 days'
  UNION
  SELECT DISTINCT vs.event_id
  FROM public.video_sessions vs
  WHERE vs.event_id IS NOT NULL
    AND COALESCE(vs.started_at, vs.state_updated_at, now()) >= now() - interval '30 days'
  UNION
  SELECT DISTINCT s.event_id
  FROM public.vw_video_date_daily_performance_samples s
  WHERE s.event_id IS NOT NULL
    AND s.created_at >= now() - interval '7 days'
),
rolled AS (
  SELECT
    w.window_id,
    w.window_label,
    w.window_interval,
    w.stale_after,
    es.event_id,
    seg.segment_key,
    seg.segment_label,
    seg.minimum_samples,
    seg.blocks_rollout_gate,
    COALESCE(sum(h.sample_count), 0)::integer AS sample_count,
    COALESCE(sum(h.success_count), 0)::integer AS success_count,
    COALESCE(sum(h.failure_count), 0)::integer AS failure_count,
    max(h.p95_ms)::integer AS p95_ms,
    max(h.p99_ms)::integer AS p99_ms,
    max(h.last_sample_at) AS last_sample_at
  FROM windows w
  CROSS JOIN event_scope es
  CROSS JOIN segments seg
  LEFT JOIN public.vw_video_date_daily_performance_segment_health h
    ON h.window_id = w.window_id
   AND (
     es.event_id IS NULL
     OR h.event_id IS NOT DISTINCT FROM es.event_id
   )
   AND h.segment_key = seg.segment_key
  GROUP BY
    w.window_id,
    w.window_label,
    w.window_interval,
    w.stale_after,
    es.event_id,
    seg.segment_key,
    seg.segment_label,
    seg.minimum_samples,
    seg.blocks_rollout_gate
)
SELECT
  r.window_id,
  r.window_label,
  r.event_id,
  r.segment_key,
  r.segment_label,
  r.sample_count,
  r.success_count,
  r.failure_count,
  r.p95_ms,
  r.p99_ms,
  r.last_sample_at,
  r.minimum_samples,
  r.blocks_rollout_gate,
  CASE
    WHEN r.sample_count = 0 THEN 'dark'
    WHEN r.last_sample_at < now() - r.stale_after THEN 'stale'
    WHEN r.sample_count < r.minimum_samples THEN 'insufficient_data'
    ELSE 'receiving'
  END AS emission_status,
  (
    r.blocks_rollout_gate
    AND (
      r.sample_count = 0
      OR r.sample_count < r.minimum_samples
      OR r.last_sample_at < now() - r.stale_after
    )
  ) AS missing_for_rollout_gate
FROM rolled r;

REVOKE ALL ON TABLE public.vw_video_date_daily_performance_emission_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_daily_performance_emission_health TO service_role;

COMMENT ON VIEW public.vw_video_date_daily_performance_emission_health IS
  'Service-role Phase 7 emission health for all six Daily performance segments. Dark or stale Daily join / first-frame emitters are explicit rollout-gate risks.';

CREATE OR REPLACE FUNCTION public.get_video_date_daily_performance_emission_health(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  window_id text,
  window_label text,
  event_id uuid,
  segment_key text,
  segment_label text,
  sample_count integer,
  success_count integer,
  failure_count integer,
  p95_ms integer,
  p99_ms integer,
  last_sample_at timestamptz,
  minimum_samples integer,
  blocks_rollout_gate boolean,
  emission_status text,
  missing_for_rollout_gate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    h.window_id,
    h.window_label,
    h.event_id,
    h.segment_key,
    h.segment_label,
    h.sample_count,
    h.success_count,
    h.failure_count,
    h.p95_ms,
    h.p99_ms,
    h.last_sample_at,
    h.minimum_samples,
    h.blocks_rollout_gate,
    h.emission_status,
    h.missing_for_rollout_gate
  FROM public.vw_video_date_daily_performance_emission_health h
  WHERE p_event_id IS NULL OR h.event_id = p_event_id OR h.event_id IS NULL
  ORDER BY
    CASE h.window_id WHEN '24h' THEN 0 ELSE 1 END,
    h.event_id NULLS FIRST,
    CASE h.segment_key
      WHEN 'room_create_or_verify' THEN 0
      WHEN 'token_mint' THEN 1
      WHEN 'daily_join' THEN 2
      WHEN 'first_remote_frame' THEN 3
      WHEN 'daily_reconnect' THEN 4
      WHEN 'extension_refresh' THEN 5
      ELSE 9
    END;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_daily_performance_emission_health(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_daily_performance_emission_health(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_daily_performance_emission_health(uuid) IS
  'Service-role Phase 7 Daily performance emission-health RPC. Shows dark/stale Daily join and first-frame emitters before Phase 8 rollout gates can become false negatives.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260522024000',
  'Video Date Phase 7/8 audit automation hardening',
  'schema+policy',
  'Forward-only checkpoint wrapper and service-role emission-health view/RPC. Explicitly captures Daily join and first remote frame as durable performance samples; adds no client-visible mutation and stores no provider credential material.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
