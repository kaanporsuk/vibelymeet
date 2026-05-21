-- Phase 6.1 / 6.2: queue fairness metrics and anti-starvation scoring.
--
-- Product truth remains in Postgres. Daily tokens are not touched here.
-- The candidate read models are service-role-only operator views. The
-- candidate view is intentionally definer-owned because drain_match_queue_v2 is
-- a SECURITY DEFINER hot path and must not depend on participant grants for
-- internal queue/readiness tables or scoring helpers. Participant entry still
-- flows through drain_match_queue_v2 and its transaction rechecks.

CREATE OR REPLACE FUNCTION public.video_date_queue_participant_reliability_penalty(
  p_event_id uuid,
  p_participant_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT LEAST(
    120,
    COALESCE((
      SELECT
        count(*) FILTER (
          WHERE COALESCE(vs.ended_reason, '') IN (
            'ready_gate_forfeit',
            'ready_gate_expired',
            'partial_join_peer_timeout',
            'reconnect_grace_expired'
          )
        )::integer * 24
        + count(*) FILTER (
          WHERE COALESCE(vs.ended_reason, '') IN (
            'queued_ttl_expired',
            'handshake_grace_expired',
            'prepare_entry_expired',
            'provider_join_timeout'
          )
        )::integer * 12
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND vs.ended_at >= COALESCE(p_now, now()) - interval '30 minutes'
        AND (vs.participant_1_id = p_participant_id OR vs.participant_2_id = p_participant_id)
    ), 0)
  );
$function$;

REVOKE ALL ON FUNCTION public.video_date_queue_participant_reliability_penalty(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_queue_participant_reliability_penalty(uuid, uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.video_date_queue_participant_reliability_penalty(uuid, uuid, timestamptz) IS
  'Service/operator helper for Phase 6 queue fairness. Penalizes very recent no-show/disconnect-like terminal reasons, capped so age-based anti-starvation can still win.';

-- Keep the fairness picker and operator health views predictable under load.
-- These are additive partial indexes only; they do not change state ownership,
-- grants, RLS, matching semantics, or Daily provider behavior.
CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_event
  ON public.video_sessions(event_id, started_at, queued_expires_at, id)
  WHERE ended_at IS NULL
    AND ready_gate_status = 'queued';

CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_p1
  ON public.video_sessions(event_id, participant_1_id, started_at, queued_expires_at, id)
  WHERE ended_at IS NULL
    AND ready_gate_status = 'queued';

CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_p2
  ON public.video_sessions(event_id, participant_2_id, started_at, queued_expires_at, id)
  WHERE ended_at IS NULL
    AND ready_gate_status = 'queued';

CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_recent_terminal_p1
  ON public.video_sessions(event_id, participant_1_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_recent_terminal_p2
  ON public.video_sessions(event_id, participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase6_queue_drain_event_recent
  ON public.event_loop_observability_events(event_id, created_at DESC, outcome, reason_code)
  WHERE operation IN ('drain_match_queue', 'drain_match_queue_v2');

CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase6_queue_drain_actor_recent
  ON public.event_loop_observability_events(event_id, actor_id, created_at DESC, outcome, reason_code)
  WHERE operation IN ('drain_match_queue', 'drain_match_queue_v2');

CREATE OR REPLACE VIEW public.v_video_date_queue_fairness_candidates AS
WITH candidates AS (
  SELECT
    vs.id AS session_id,
    vs.event_id,
    pair.actor_id,
    pair.partner_id,
    vs.started_at AS queued_at,
    vs.queued_expires_at,
    GREATEST(0, EXTRACT(EPOCH FROM (now() - vs.started_at))::integer) AS queued_age_seconds,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (
        COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') - now()
      ))::integer
    ) AS ttl_remaining_seconds,
    actor_runtime.foreground AS actor_foreground,
    actor_runtime.readiness_status AS actor_readiness_status,
    actor_runtime.last_heartbeat_at AS actor_last_heartbeat_at,
    partner_runtime.foreground AS partner_foreground,
    partner_runtime.readiness_status AS partner_readiness_status,
    partner_runtime.last_heartbeat_at AS partner_last_heartbeat_at,
    actor_runtime.client_platform AS actor_client_platform,
    partner_runtime.client_platform AS partner_client_platform,
    actor_profile.gender AS actor_gender,
    partner_profile.gender AS partner_gender,
    (
      actor_runtime.foreground IS TRUE
      AND actor_runtime.last_heartbeat_at >= now() - interval '45 seconds'
      AND actor_runtime.readiness_status IN ('ready', 'warning')
    ) AS actor_hot_ready,
    (
      partner_runtime.foreground IS TRUE
      AND partner_runtime.last_heartbeat_at >= now() - interval '45 seconds'
      AND partner_runtime.readiness_status IN ('ready', 'warning')
    ) AS partner_hot_ready,
    public.video_date_queue_participant_reliability_penalty(vs.event_id, pair.actor_id, now()) AS actor_recent_reliability_penalty,
    public.video_date_queue_participant_reliability_penalty(vs.event_id, pair.partner_id, now()) AS partner_recent_reliability_penalty,
    COALESCE((
      SELECT count(*)::integer
      FROM public.event_loop_observability_events eo
      WHERE eo.event_id = vs.event_id
        AND eo.actor_id = pair.actor_id
        AND eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND eo.outcome = 'no_op'
        AND eo.reason_code = 'no_queued_session'
        AND eo.created_at >= now() - interval '15 minutes'
    ), 0) AS actor_recent_no_match_attempts,
    COALESCE((
      SELECT count(*)::integer
      FROM public.video_sessions prior
      WHERE prior.event_id = vs.event_id
        AND prior.id <> vs.id
        AND prior.ended_at IS NOT NULL
        AND prior.ended_at >= now() - interval '30 minutes'
        AND (
          prior.participant_1_id = pair.actor_id
          OR prior.participant_2_id = pair.actor_id
          OR prior.participant_1_id = pair.partner_id
          OR prior.participant_2_id = pair.partner_id
        )
    ), 0) AS recent_terminal_session_count
  FROM public.video_sessions vs
  CROSS JOIN LATERAL (
    VALUES
      (vs.participant_1_id, vs.participant_2_id),
      (vs.participant_2_id, vs.participant_1_id)
  ) AS pair(actor_id, partner_id)
  LEFT JOIN public.event_participant_runtime_state actor_runtime
    ON actor_runtime.event_id = vs.event_id
   AND actor_runtime.participant_id = pair.actor_id
  LEFT JOIN public.event_participant_runtime_state partner_runtime
    ON partner_runtime.event_id = vs.event_id
   AND partner_runtime.participant_id = pair.partner_id
  LEFT JOIN public.profiles actor_profile
    ON actor_profile.id = pair.actor_id
  LEFT JOIN public.profiles partner_profile
    ON partner_profile.id = pair.partner_id
  WHERE vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
)
SELECT
  c.*,
  (c.actor_hot_ready AND c.partner_hot_ready) AS both_hot_ready,
  (
    LEAST(c.queued_age_seconds, 3600)
    + LEAST(c.actor_recent_no_match_attempts * 18, 180)
    + CASE WHEN c.actor_hot_ready AND c.partner_hot_ready THEN 600 ELSE 0 END
    + CASE WHEN c.actor_hot_ready THEN 90 ELSE 0 END
    + CASE WHEN c.partner_hot_ready THEN 90 ELSE 0 END
    + CASE WHEN c.ttl_remaining_seconds <= 90 THEN 90 ELSE 0 END
    - c.actor_recent_reliability_penalty
    - c.partner_recent_reliability_penalty
  )::integer AS candidate_score
FROM candidates c;

COMMENT ON VIEW public.v_video_date_queue_fairness_candidates IS
  'Service-role, definer-owned candidate-level queue fairness view. Scores queued video_sessions per actor perspective using wait age, recent no-match attempts, hot readiness, TTL pressure, and capped recent no-show/disconnect penalties. Definer ownership keeps drain_match_queue_v2 independent of participant grants; direct SELECT remains service-role only. Contains no Daily tokens.';

CREATE OR REPLACE VIEW public.v_video_date_queue_fairness_event_health
WITH (security_invoker = true) AS
WITH candidate_rollup AS (
  SELECT
    event_id,
    count(DISTINCT session_id)::integer AS queued_session_count,
    count(*)::integer AS queued_participant_slots,
    max(queued_age_seconds)::integer AS oldest_wait_seconds,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY queued_age_seconds) AS p95_wait_seconds,
    count(*) FILTER (WHERE queued_age_seconds >= 120)::integer AS starved_slots_120s,
    count(*) FILTER (WHERE queued_age_seconds >= 300)::integer AS starved_slots_300s,
    count(*) FILTER (WHERE both_hot_ready)::integer AS both_hot_ready_slots,
    count(*) FILTER (WHERE NOT both_hot_ready)::integer AS not_both_hot_ready_slots,
    count(*) FILTER (WHERE actor_recent_reliability_penalty + partner_recent_reliability_penalty > 0)::integer AS reliability_penalized_slots,
    max(candidate_score)::integer AS max_candidate_score,
    avg(candidate_score)::numeric(14, 2) AS avg_candidate_score,
    jsonb_object_agg(
      COALESCE(actor_client_platform, 'unknown'),
      platform_count
    ) FILTER (WHERE actor_client_platform IS NOT NULL OR platform_count IS NOT NULL) AS actor_platform_slots,
    jsonb_object_agg(
      COALESCE(actor_gender, 'unknown'),
      gender_count
    ) FILTER (WHERE actor_gender IS NOT NULL OR gender_count IS NOT NULL) AS actor_gender_slots
  FROM (
    SELECT
      c.*,
      count(*) OVER (PARTITION BY c.event_id, COALESCE(c.actor_client_platform, 'unknown'))::integer AS platform_count,
      count(*) OVER (PARTITION BY c.event_id, COALESCE(c.actor_gender, 'unknown'))::integer AS gender_count
    FROM public.v_video_date_queue_fairness_candidates c
  ) counted
  GROUP BY event_id
),
drain_rollup AS (
  SELECT
    eo.event_id,
    count(*) FILTER (
      WHERE eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND eo.created_at >= now() - interval '15 minutes'
    )::integer AS drain_attempts_15m,
    count(*) FILTER (
      WHERE eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND eo.outcome = 'success'
        AND eo.created_at >= now() - interval '15 minutes'
    )::integer AS drain_successes_15m,
    count(*) FILTER (
      WHERE eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND eo.outcome = 'no_op'
        AND eo.reason_code = 'no_queued_session'
        AND eo.created_at >= now() - interval '15 minutes'
    )::integer AS no_match_attempts_15m,
    count(*) FILTER (
      WHERE eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND eo.outcome = 'blocked'
        AND eo.reason_code IN ('self_runtime_not_ready', 'partner_runtime_not_ready', 'self_not_present', 'partner_not_present')
        AND eo.created_at >= now() - interval '15 minutes'
    )::integer AS runtime_blocked_attempts_15m
  FROM public.event_loop_observability_events eo
  WHERE eo.event_id IS NOT NULL
    AND eo.created_at >= now() - interval '15 minutes'
    AND eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
  GROUP BY eo.event_id
)
SELECT
  COALESCE(c.event_id, d.event_id) AS event_id,
  COALESCE(c.queued_session_count, 0) AS queued_session_count,
  COALESCE(c.queued_participant_slots, 0) AS queued_participant_slots,
  c.oldest_wait_seconds,
  c.p95_wait_seconds,
  COALESCE(c.starved_slots_120s, 0) AS starved_slots_120s,
  COALESCE(c.starved_slots_300s, 0) AS starved_slots_300s,
  COALESCE(c.both_hot_ready_slots, 0) AS both_hot_ready_slots,
  COALESCE(c.not_both_hot_ready_slots, 0) AS not_both_hot_ready_slots,
  COALESCE(c.reliability_penalized_slots, 0) AS reliability_penalized_slots,
  c.max_candidate_score,
  c.avg_candidate_score,
  COALESCE(c.actor_platform_slots, '{}'::jsonb) AS actor_platform_slots,
  COALESCE(c.actor_gender_slots, '{}'::jsonb) AS actor_gender_slots,
  COALESCE(d.drain_attempts_15m, 0) AS drain_attempts_15m,
  COALESCE(d.drain_successes_15m, 0) AS drain_successes_15m,
  COALESCE(d.no_match_attempts_15m, 0) AS no_match_attempts_15m,
  COALESCE(d.runtime_blocked_attempts_15m, 0) AS runtime_blocked_attempts_15m,
  CASE
    WHEN COALESCE(c.starved_slots_300s, 0) > 0 THEN 'critical'
    WHEN COALESCE(c.starved_slots_120s, 0) > 0 OR COALESCE(d.no_match_attempts_15m, 0) >= 3 THEN 'warning'
    ELSE 'healthy'
  END AS fairness_status
FROM candidate_rollup c
FULL OUTER JOIN drain_rollup d
  ON d.event_id = c.event_id;

COMMENT ON VIEW public.v_video_date_queue_fairness_event_health IS
  'Service-role event-level queue fairness health. Tracks wait-time, starvation, no-match, runtime-block, readiness, platform balance, and capped reliability-penalty signals without exposing Daily tokens.';

CREATE OR REPLACE FUNCTION public.get_video_date_queue_fairness_health(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  event_id uuid,
  queued_session_count integer,
  queued_participant_slots integer,
  oldest_wait_seconds integer,
  p95_wait_seconds integer,
  starved_slots_120s integer,
  starved_slots_300s integer,
  both_hot_ready_slots integer,
  not_both_hot_ready_slots integer,
  reliability_penalized_slots integer,
  max_candidate_score integer,
  avg_candidate_score numeric,
  actor_platform_slots jsonb,
  actor_gender_slots jsonb,
  drain_attempts_15m integer,
  drain_successes_15m integer,
  no_match_attempts_15m integer,
  runtime_blocked_attempts_15m integer,
  fairness_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    h.event_id,
    h.queued_session_count,
    h.queued_participant_slots,
    h.oldest_wait_seconds,
    h.p95_wait_seconds,
    h.starved_slots_120s,
    h.starved_slots_300s,
    h.both_hot_ready_slots,
    h.not_both_hot_ready_slots,
    h.reliability_penalized_slots,
    h.max_candidate_score,
    h.avg_candidate_score,
    h.actor_platform_slots,
    h.actor_gender_slots,
    h.drain_attempts_15m,
    h.drain_successes_15m,
    h.no_match_attempts_15m,
    h.runtime_blocked_attempts_15m,
    h.fairness_status
  FROM public.v_video_date_queue_fairness_event_health h
  WHERE p_event_id IS NULL OR h.event_id = p_event_id
  ORDER BY
    CASE h.fairness_status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    h.oldest_wait_seconds DESC NULLS LAST,
    h.event_id;
$function$;

REVOKE ALL ON TABLE public.v_video_date_queue_fairness_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.v_video_date_queue_fairness_event_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_video_date_queue_fairness_candidates TO service_role;
GRANT SELECT ON TABLE public.v_video_date_queue_fairness_event_health TO service_role;

REVOKE ALL ON FUNCTION public.get_video_date_queue_fairness_health(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_video_date_queue_fairness_health(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_queue_fairness_health(uuid) IS
  'Service-role queue fairness health read model for video-date operators. Optional event_id filter; no participant payloads, Daily room URLs, or tokens are returned.';

CREATE OR REPLACE FUNCTION public.drain_match_queue_v2(
  p_event_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_active record;
  v_inactive_reason text;
  v_match public.video_sessions%ROWTYPE;
  v_existing_command public.video_session_commands%ROWTYPE;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low public.event_registrations%ROWTYPE;
  v_er_high public.event_registrations%ROWTYPE;
  v_self public.event_registrations%ROWTYPE;
  v_partner public.event_registrations%ROWTYPE;
  v_self_runtime public.event_participant_runtime_state%ROWTYPE;
  v_partner_runtime public.event_participant_runtime_state%ROWTYPE;
  v_self_runtime_ok boolean := false;
  v_partner_runtime_ok boolean := false;
  v_begin jsonb;
  v_command_id bigint;
  v_request jsonb;
  v_result jsonb;
  v_event jsonb := '{}'::jsonb;
  v_fairness jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      NULL,
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('found', false, 'success', false, 'error', 'invalid_idempotency_key', 'reason', 'invalid_idempotency_key');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_session_command:' || v_actor::text || ':' || v_key, 0)
  );

  SELECT *
  INTO v_existing_command
  FROM public.video_session_commands
  WHERE actor = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_command.command_kind IS DISTINCT FROM 'drain_match_queue'
       OR v_existing_command.request_payload->>'event_id' IS DISTINCT FROM p_event_id::text THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', 'idempotency_conflict',
        'commandStatus', 'idempotency_conflict',
        'existingSessionId', v_existing_command.session_id,
        'existingCommandKind', v_existing_command.command_kind,
        'existingRequestHash', v_existing_command.request_hash
      );
    END IF;

    v_begin := public.video_session_command_begin_v2(
      v_existing_command.session_id,
      v_actor,
      'drain_match_queue',
      v_key,
      COALESCE(v_existing_command.request_payload, '{}'::jsonb),
      v_existing_command.request_hash
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
        'commandStatus', v_begin->>'status',
        'requestHash', v_begin->>'requestHash'
      );
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      RETURN COALESCE(v_begin->'result', '{}'::jsonb)
        || jsonb_build_object(
          'idempotent', true,
          'requestHash', v_begin->>'requestHash',
          'commandStatus', v_begin->>'status'
        );
    END IF;

    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object('inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  SELECT vs.*
  INTO v_match
  FROM public.video_sessions vs
  JOIN public.v_video_date_queue_fairness_candidates fair
    ON fair.session_id = vs.id
   AND fair.actor_id = v_actor
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = v_actor OR vs.participant_2_id = v_actor)
  ORDER BY
    fair.candidate_score DESC,
    fair.both_hot_ready DESC,
    fair.queued_age_seconds DESC,
    fair.ttl_remaining_seconds ASC,
    vs.started_at ASC NULLS LAST,
    vs.id ASC
  LIMIT 1
  FOR UPDATE OF vs SKIP LOCKED;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'no_queued_session',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object(
        'step', 'pick_queued_session',
        'queue_scoring_version', 'phase6_v1',
        'candidate_source', 'v_video_date_queue_fairness_candidates'
      )
    );
    RETURN jsonb_build_object('found', false, 'reason', 'no_queued_session');
  END IF;

  SELECT jsonb_build_object(
    'queue_scoring_version', 'phase6_v1',
    'candidate_score', fair.candidate_score,
    'queued_age_seconds', fair.queued_age_seconds,
    'ttl_remaining_seconds', fair.ttl_remaining_seconds,
    'both_hot_ready', fair.both_hot_ready,
    'actor_hot_ready', fair.actor_hot_ready,
    'partner_hot_ready', fair.partner_hot_ready,
    'actor_recent_no_match_attempts', fair.actor_recent_no_match_attempts,
    'actor_recent_reliability_penalty', fair.actor_recent_reliability_penalty,
    'partner_recent_reliability_penalty', fair.partner_recent_reliability_penalty
  )
  INTO v_fairness
  FROM public.v_video_date_queue_fairness_candidates fair
  WHERE fair.session_id = v_match.id
    AND fair.actor_id = v_actor;

  v_fairness := COALESCE(v_fairness, jsonb_build_object('queue_scoring_version', 'phase6_v1'));

  v_partner_id := CASE
    WHEN v_match.participant_1_id = v_actor THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(v_actor, v_partner_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(v_actor, v_partner_id)::text,
      0
    )
  );

  v_request := jsonb_build_object(
    'event_id', p_event_id,
    'queued_session_id', v_match.id,
    'partner_id', v_partner_id
  );

  v_begin := public.video_session_command_begin_v2(
    v_match.id,
    v_actor,
    'drain_match_queue',
    v_key,
    v_request,
    NULL
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
      'commandStatus', v_begin->>'status',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb)
      || jsonb_build_object(
        'idempotent', true,
        'requestHash', v_begin->>'requestHash',
        'commandStatus', v_begin->>'status'
      );
  END IF;

  IF v_begin->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, v_actor, v_partner_id, v_match.id) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'pair_already_met_this_event',
      'session_id', v_match.id,
      'video_session_id', v_match.id
    );

    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'pair_already_met_this_event',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id, 'terminal_encounter_pair', true, 'fairness', v_fairness)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_er_low.profile_id = v_actor THEN
    v_self := v_er_low;
    v_partner := v_er_high;
  ELSE
    v_self := v_er_high;
    v_partner := v_er_low;
  END IF;

  IF v_self.admission_status IS DISTINCT FROM 'confirmed'
     OR v_partner.admission_status IS DISTINCT FROM 'confirmed' THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'admission_not_confirmed'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'admission_not_confirmed');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_self_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_actor
  FOR UPDATE;

  v_self_runtime_ok := FOUND
    AND v_self_runtime.foreground IS TRUE
    AND v_self_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_self_runtime.readiness_status IN ('ready', 'warning');

  SELECT *
  INTO v_partner_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_partner_id
  FOR UPDATE;

  v_partner_runtime_ok := FOUND
    AND v_partner_runtime.foreground IS TRUE
    AND v_partner_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_partner_runtime.readiness_status IN ('ready', 'warning');

  IF NOT v_self_runtime_ok THEN
    UPDATE public.event_registrations
    SET
      last_lobby_foregrounded_at = now(),
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id = v_actor;

    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'self_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'self_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_self_runtime.foreground, false),
        'readiness_status', v_self_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_self_runtime.last_heartbeat_at))::int,
        'fairness', v_fairness
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF NOT v_partner_runtime_ok THEN
    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'partner_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'partner_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_partner_runtime.foreground, false),
        'readiness_status', v_partner_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_partner_runtime.last_heartbeat_at))::int,
        'fairness', v_fairness
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF public.is_blocked(v_actor, v_partner_id)
     OR EXISTS (
       SELECT 1
       FROM public.user_reports ur
       WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
          OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
     ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'blocked_or_reported_pair'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'browsing',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'blocked_or_reported_pair');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'blocked_or_reported_pair',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id, 'fairness', v_fairness)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, v_inactive_reason),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'queued_session_not_promotable'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'session_not_promotable');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.id <> v_match.id
      AND (
        z.participant_1_id IN (v_actor, v_partner_id)
        OR z.participant_2_id IN (v_actor, v_partner_id)
      )
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'participant_has_active_session_conflict'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'participant_has_active_session_conflict');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  UPDATE public.video_sessions
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = now() + interval '30 seconds',
    queued_expires_at = NULL,
    state_updated_at = now()
  WHERE id = v_match.id;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_match.id,
    current_partner_id = CASE
      WHEN profile_id = v_actor THEN v_partner_id
      ELSE v_actor
    END,
    last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (v_actor, v_partner_id);

  PERFORM public.record_event_profile_impression_v2(
    p_event_id,
    v_actor,
    v_partner_id,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  INSERT INTO public.event_profile_impressions (
    event_id,
    viewer_id,
    target_id,
    last_action,
    strongest_exclusion_reason,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  )
  ON CONFLICT (event_id, viewer_id, target_id) DO UPDATE
  SET
    last_action = EXCLUDED.last_action,
    last_action_at = now(),
    strongest_exclusion_reason = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN EXCLUDED.strongest_exclusion_reason
      ELSE event_profile_impressions.strongest_exclusion_reason
    END,
    source = EXCLUDED.source,
    session_id = COALESCE(EXCLUDED.session_id, event_profile_impressions.session_id),
    metadata = event_profile_impressions.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.event_profile_impression_events (
    event_id,
    viewer_id,
    target_id,
    action,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  v_event := public.append_video_session_event_v2(
    v_match.id,
    'queue_promoted_to_ready_gate',
    'participants',
    v_actor,
    jsonb_build_object(
      'event_id', p_event_id,
      'partner_id', v_partner_id,
      'ready_gate_status', 'ready'
    ),
    jsonb_build_object(
      'event_id', p_event_id,
      'ready_gate_status', 'ready'
    ),
    true,
    gen_random_uuid()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_actor,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_actor::text,
    now()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_partner_id,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_partner_id::text,
    now()
  );

  v_result := jsonb_build_object(
    'found', true,
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id,
    'ready_gate_status', 'ready',
    'event', v_event
  );

  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'drain_match_queue_v2',
    'success',
    NULL,
    v_ms,
    p_event_id,
    v_actor,
    v_match.id,
    jsonb_build_object(
      'promoted', true,
      'partner_id', v_partner_id,
      'runtime_revalidated', true,
      'queued_sessions_browseable', true,
      'fairness', v_fairness
    )
  );

  RETURN v_result || jsonb_build_object(
    'idempotent', false,
    'requestHash', v_begin->>'requestHash',
    'commandStatus', 'committed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue_v2(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_v2(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue_v2(uuid, text) IS
  'Phase 6 queue-drain promotion. Scores queued sessions by wait age, no-match history, readiness, TTL pressure, and capped reliability penalties, then atomically revalidates runtime heartbeat/readiness, block/report exclusions, active-session absence, prior-pair exclusions, and registration state before promoting to Ready Gate with v4 command idempotency.';
