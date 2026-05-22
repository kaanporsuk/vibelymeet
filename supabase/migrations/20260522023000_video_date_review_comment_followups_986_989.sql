-- Forward fixes for review follow-ups on PRs 986-989 after the Phase 6-8
-- migrations had already been merged/applied.

CREATE OR REPLACE VIEW public.vw_video_date_extension_refund_certification
WITH (security_invoker = true)
AS
SELECT
  vs.id AS session_id,
  vs.event_id,
  vs.ended_reason,
  vs.refund_status,
  vs.refund_granted_at,
  count(sp.id)::integer AS extension_spend_count,
  count(sp.id) FILTER (WHERE sp.credit_type = 'extra_time')::integer AS extra_time_spend_count,
  count(sp.id) FILTER (WHERE sp.credit_type = 'extended_vibe')::integer AS extended_vibe_spend_count,
  COALESCE(bool_or(sp.idempotency_key LIKE 'mutual:%'), false) AS has_mutual_extension_spend,
  vs.refund_breakdown
FROM public.video_sessions vs
LEFT JOIN public.video_date_credit_extension_spends sp ON sp.session_id = vs.id
GROUP BY vs.id, vs.event_id, vs.ended_reason, vs.refund_status, vs.refund_granted_at, vs.refund_breakdown;

REVOKE ALL ON TABLE public.vw_video_date_extension_refund_certification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_extension_refund_certification TO service_role;

COMMENT ON VIEW public.vw_video_date_extension_refund_certification IS
  'Service-role certification view proving all one-sided and mutual extension charges are visible to the canonical refund_failed_video_date ledger path.';

CREATE OR REPLACE VIEW public.vw_video_date_phase8_rollout_readiness
WITH (security_invoker = true)
AS
WITH
core_flags(flag_key) AS (
  VALUES
    ('video_date.snapshot_v2'),
    ('video_date.deck_deal_v2'),
    ('video_date.readiness_v2'),
    ('video_date.micro_verdict_v2'),
    ('video_date.broadcast_v2'),
    ('video_date.timeline_v2'),
    ('video_date.daily_webhooks_v2'),
    ('video_date.extension_mutual_v2'),
    ('video_date.safety_always_on_v2'),
    ('video_date.multi_device_v2'),
    ('video_date.outbox_v2.mark_ready'),
    ('video_date.outbox_v2.forfeit'),
    ('video_date.outbox_v2.continue_handshake'),
    ('video_date.outbox_v2.handshake_auto_promote'),
    ('video_date.outbox_v2.date_timeout'),
    ('video_date.outbox_v2.submit_verdict'),
    ('video_date.outbox_v2.extension'),
    ('video_date.outbox_v2.safety'),
    ('video_date.outbox_v2.drain_match_queue')
),
flag_rollup AS (
  SELECT
    count(f.flag_key) = count(cf.flag_key) AS core_flags_present,
    bool_and(COALESCE(f.enabled, false)) AS core_flags_enabled,
    bool_or(COALESCE(f.kill_switch_active, false)) AS core_flags_killed,
    min(COALESCE(f.rollout_bps, 0))::integer AS current_rollout_bps,
    count(cf.flag_key)::integer AS required_flag_count,
    count(f.flag_key)::integer AS present_flag_count
  FROM core_flags cf
  LEFT JOIN public.client_feature_flags f ON f.flag_key = cf.flag_key
),
windows(window_id, window_label, max_p95_ms, max_p99_ms) AS (
  VALUES
    ('24h'::text, '24h'::text, 5000::integer, 8000::integer),
    ('7d'::text, '7d'::text, 5000::integer, 8000::integer)
),
targets(target_rollout_bps, target_label, min_samples, requires_deck_bake) AS (
  VALUES
    (100::integer, '1%'::text, 0::integer, false::boolean),
    (1000::integer, '10%'::text, 20::integer, false::boolean),
    (5000::integer, '50%'::text, 50::integer, false::boolean),
    (10000::integer, '100%'::text, 100::integer, true::boolean)
),
event_scope AS (
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
  SELECT DISTINCT r.event_id
  FROM public.video_date_phase8_certification_runs r
  WHERE r.event_id IS NOT NULL
),
stuck AS (
  SELECT
    vs.event_id,
    count(*)::integer AS stuck_active_sessions_over_2m
  FROM public.video_sessions vs
  WHERE vs.event_id IS NOT NULL
    AND vs.ended_at IS NULL
    AND COALESCE(vs.state::text, '') <> 'ended'
    AND COALESCE(vs.phase, '') <> 'ended'
    AND COALESCE(vs.state_updated_at, vs.started_at, now()) <= now() - interval '2 minutes'
    AND (
      vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'queued')
      OR COALESCE(vs.phase, '') IN ('handshake', 'date')
      OR COALESCE(vs.state::text, '') IN ('ready', 'handshake', 'date', 'queued')
    )
  GROUP BY vs.event_id
),
alerts AS (
  SELECT
    count(*) FILTER (WHERE severity = 'page')::integer AS recovery_page_alerts,
    count(*) FILTER (WHERE severity = 'watch')::integer AS recovery_watch_alerts
  FROM public.vw_video_date_recovery_alerts
),
cert AS (
  SELECT
    es.event_id,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'two_user_e2e'
          AND r.platform IN ('web', 'cross_platform')
          AND r.status = 'passed'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'two_user_e2e'
            AND r.platform IN ('web', 'cross_platform')
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'two_user_e2e'
            AND r.platform IN ('web', 'cross_platform')
            AND r.status = 'passed'
        )
      )
    ) AS two_user_web_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
        WHERE r.event_id = es.event_id
          AND (
            (
              r.run_kind = 'two_user_e2e'
              AND r.platform IN ('native', 'mobile', 'cross_platform')
            )
            OR (
              r.run_kind = 'native_smoke'
              AND r.platform IN ('native', 'mobile', 'cross_platform')
            )
          )
          AND r.status = 'passed'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id = es.event_id
            AND (
              (
                r.run_kind = 'two_user_e2e'
                AND r.platform IN ('native', 'mobile', 'cross_platform')
              )
              OR (
                r.run_kind = 'native_smoke'
                AND r.platform IN ('native', 'mobile', 'cross_platform')
              )
            )
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id IS NULL
            AND (
              (
                r.run_kind = 'two_user_e2e'
                AND r.platform IN ('native', 'mobile', 'cross_platform')
              )
              OR (
                r.run_kind = 'native_smoke'
                AND r.platform IN ('native', 'mobile', 'cross_platform')
              )
            )
            AND r.status = 'passed'
        )
      )
    ) AS two_user_native_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'rls_negative'
          AND r.status = 'passed'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rls_negative'
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rls_negative'
            AND r.status = 'passed'
        )
      )
    ) AS rls_negative_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'chaos'
          AND r.status = 'passed'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'chaos'
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'chaos'
            AND r.status = 'passed'
        )
      )
    ) AS chaos_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'load'
          AND r.status = 'passed'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'load'
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_certification_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'load'
            AND r.status = 'passed'
        )
      )
    ) AS load_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'rollout_step'
          AND r.platform = 'ops'
          AND r.status = 'passed'
          AND r.rollout_bps = 100
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.rollout_bps = 100
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.status = 'passed'
            AND r.rollout_bps = 100
        )
      )
    ) AS rollout_1pct_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'rollout_step'
          AND r.platform = 'ops'
          AND r.status = 'passed'
          AND r.rollout_bps = 1000
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.rollout_bps = 1000
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.status = 'passed'
            AND r.rollout_bps = 1000
        )
      )
    ) AS rollout_10pct_passed,
    (
      EXISTS (
        SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
        WHERE r.event_id = es.event_id
          AND r.run_kind = 'rollout_step'
          AND r.platform = 'ops'
          AND r.status = 'passed'
          AND r.rollout_bps = 5000
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.rollout_bps = 5000
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
            AND r.platform = 'ops'
            AND r.status = 'passed'
            AND r.rollout_bps = 5000
        )
      )
    ) AS rollout_50pct_passed
  FROM event_scope es
),
readiness AS (
  SELECT
    w.window_id,
    w.window_label,
    es.event_id,
    t.target_rollout_bps,
    t.target_label,
    COALESCE(c.two_user_web_passed, false) AS two_user_web_passed,
    COALESCE(c.two_user_native_passed, false) AS two_user_native_passed,
    COALESCE(c.rls_negative_passed, false) AS rls_negative_passed,
    COALESCE(c.chaos_passed, false) AS chaos_passed,
    COALESCE(c.load_passed, false) AS load_passed,
    COALESCE(c.rollout_1pct_passed, false) AS rollout_1pct_passed,
    COALESCE(c.rollout_10pct_passed, false) AS rollout_10pct_passed,
    COALESCE(c.rollout_50pct_passed, false) AS rollout_50pct_passed,
    COALESCE(a.recovery_page_alerts, 0) AS recovery_page_alerts,
    COALESCE(a.recovery_watch_alerts, 0) AS recovery_watch_alerts,
    COALESCE(s.stuck_active_sessions_over_2m, 0) AS stuck_active_sessions_over_2m,
    COALESCE(d.first_frame_sample_count, 0) AS first_frame_sample_count,
    d.first_frame_p95_ms,
    d.first_frame_p99_ms,
    COALESCE(q.fairness_status, 'unknown') AS queue_fairness_status,
    fr.core_flags_present,
    fr.core_flags_enabled,
    fr.core_flags_killed,
    fr.current_rollout_bps,
    COALESCE(deck.deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
    deck.cleanup_readiness_reason AS legacy_deck_cleanup_reason,
    array_remove(ARRAY[
      CASE WHEN NOT COALESCE(c.two_user_web_passed, false) THEN 'two_user_web_not_passed' END,
      CASE WHEN NOT COALESCE(c.two_user_native_passed, false) THEN 'two_user_native_not_passed' END,
      CASE WHEN NOT COALESCE(c.rls_negative_passed, false) THEN 'rls_negative_not_passed' END,
      CASE WHEN NOT COALESCE(c.chaos_passed, false) THEN 'chaos_not_passed' END,
      CASE WHEN NOT COALESCE(c.load_passed, false) THEN 'load_not_passed' END,
      CASE WHEN NOT fr.core_flags_present THEN 'core_flags_missing' END,
      CASE WHEN NOT fr.core_flags_enabled THEN 'core_flags_not_enabled' END,
      CASE WHEN fr.core_flags_killed THEN 'core_flag_kill_switch_active' END,
      CASE WHEN COALESCE(a.recovery_page_alerts, 0) > 0 THEN 'recovery_page_alerts_active' END,
      CASE WHEN COALESCE(s.stuck_active_sessions_over_2m, 0) > 0 THEN 'stuck_active_sessions_over_2m' END,
      CASE WHEN COALESCE(q.fairness_status, 'unknown') = 'critical' THEN 'queue_fairness_critical' END,
      CASE WHEN t.target_rollout_bps >= 1000 AND NOT COALESCE(c.rollout_1pct_passed, false) THEN 'rollout_1pct_not_certified' END,
      CASE WHEN t.target_rollout_bps >= 1000 AND COALESCE(fr.current_rollout_bps, 0) < 100 THEN 'current_rollout_bps_below_1pct' END,
      CASE WHEN t.target_rollout_bps >= 5000 AND NOT COALESCE(c.rollout_10pct_passed, false) THEN 'rollout_10pct_not_certified' END,
      CASE WHEN t.target_rollout_bps >= 5000 AND COALESCE(fr.current_rollout_bps, 0) < 1000 THEN 'current_rollout_bps_below_10pct' END,
      CASE WHEN t.target_rollout_bps >= 10000 AND NOT COALESCE(c.rollout_50pct_passed, false) THEN 'rollout_50pct_not_certified' END,
      CASE WHEN t.target_rollout_bps >= 10000 AND COALESCE(fr.current_rollout_bps, 0) < 5000 THEN 'current_rollout_bps_below_50pct' END,
      CASE WHEN COALESCE(d.first_frame_sample_count, 0) < t.min_samples THEN 'insufficient_first_frame_samples' END,
      CASE WHEN t.min_samples > 0 AND (d.first_frame_p95_ms IS NULL OR d.first_frame_p95_ms > w.max_p95_ms) THEN 'first_frame_p95_over_target' END,
      CASE WHEN t.min_samples > 0 AND (d.first_frame_p99_ms IS NULL OR d.first_frame_p99_ms > w.max_p99_ms) THEN 'first_frame_p99_over_target' END,
      CASE WHEN t.requires_deck_bake AND NOT COALESCE(deck.deck_deal_100pct_baked, false) THEN 'deck_deal_100pct_not_baked' END
    ], NULL)::text[] AS rollout_blockers
  FROM event_scope es
  CROSS JOIN windows w
  CROSS JOIN targets t
  CROSS JOIN flag_rollup fr
  CROSS JOIN alerts a
  LEFT JOIN cert c ON c.event_id = es.event_id
  LEFT JOIN stuck s ON s.event_id = es.event_id
  LEFT JOIN public.vw_video_date_daily_pool_decision d
    ON d.event_id = es.event_id
   AND d.window_id = w.window_id
  LEFT JOIN public.v_video_date_queue_fairness_event_health q
    ON q.event_id = es.event_id
  LEFT JOIN public.vw_video_date_legacy_deck_cleanup_readiness deck
    ON deck.flag_key = 'video_date.deck_deal_v2'
)
SELECT
  *,
  COALESCE(array_length(rollout_blockers, 1), 0) = 0 AS can_advance_rollout,
  now() AS generated_at
FROM readiness;

REVOKE ALL ON TABLE public.vw_video_date_phase8_rollout_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_phase8_rollout_readiness TO service_role;

COMMENT ON VIEW public.vw_video_date_phase8_rollout_readiness IS
  'Service-role Phase 8 rollout gate. One row per event/window/target rollout step with certification, prior-step rollout, RLS, chaos, load, latency, fairness, alert, stuck-session, and legacy deck cleanup blockers.';
