-- Vibely Video Date v4 Phase 8.1-8.3:
-- Certification and rollout gates.
--
-- Phase 8 is intentionally operational: record real two-user, RLS, chaos,
-- load, native, rollout, and legacy-cleanup certifications; expose a
-- service-role readiness view that blocks ramp-up when any critical proof is
-- missing. No Daily tokens or provider secrets are stored here.

CREATE TABLE IF NOT EXISTS public.video_date_phase8_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  run_kind text NOT NULL CHECK (
    run_kind IN (
      'two_user_e2e',
      'rls_negative',
      'chaos',
      'load',
      'native_smoke',
      'rollout_step',
      'legacy_cleanup'
    )
  ),
  platform text NOT NULL CHECK (
    platform IN ('web', 'native', 'mobile', 'cross_platform', 'backend', 'ops')
  ),
  status text NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'blocked', 'waived')),
  rollout_bps integer NULL CHECK (rollout_bps IS NULL OR rollout_bps BETWEEN 0 AND 10000),
  commit_sha text NULL CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{7,40}$'),
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL,
  certified_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  certified_at timestamptz NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_phase8_certification_runs_report_object
    CHECK (jsonb_typeof(report) = 'object'),
  CONSTRAINT video_date_phase8_certification_runs_report_no_secret
    CHECK (NOT public.video_date_jsonb_has_secret_key(report))
);

ALTER TABLE public.video_date_phase8_certification_runs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS video_date_phase8_certification_runs_updated_at
  ON public.video_date_phase8_certification_runs;
CREATE TRIGGER video_date_phase8_certification_runs_updated_at
  BEFORE UPDATE ON public.video_date_phase8_certification_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_video_date_phase8_cert_runs_latest
  ON public.video_date_phase8_certification_runs(event_id, run_kind, platform, certified_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_date_phase8_cert_runs_status
  ON public.video_date_phase8_certification_runs(status, expires_at, created_at DESC);

REVOKE ALL ON TABLE public.video_date_phase8_certification_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.video_date_phase8_certification_runs TO service_role;

COMMENT ON TABLE public.video_date_phase8_certification_runs IS
  'Service-role ledger for Phase 8 Video Date certification runs. Stores token-free proof metadata for two-user E2E, RLS, chaos, load, native smoke, rollout, and legacy-cleanup gates.';

CREATE OR REPLACE FUNCTION public.record_video_date_phase8_certification_run_v2(
  p_run_kind text,
  p_platform text,
  p_status text,
  p_event_id uuid DEFAULT NULL,
  p_rollout_bps integer DEFAULT NULL,
  p_commit_sha text DEFAULT NULL,
  p_report jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_run_kind text := lower(btrim(COALESCE(p_run_kind, '')));
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_report jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_report, '{}'::jsonb)) = 'object' THEN COALESCE(p_report, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role_required');
  END IF;

  IF v_run_kind NOT IN (
    'two_user_e2e',
    'rls_negative',
    'chaos',
    'load',
    'native_smoke',
    'rollout_step',
    'legacy_cleanup'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_run_kind');
  END IF;

  IF v_platform NOT IN ('web', 'native', 'mobile', 'cross_platform', 'backend', 'ops') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_platform');
  END IF;

  IF v_status NOT IN ('pending', 'passed', 'failed', 'blocked', 'waived') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF p_rollout_bps IS NOT NULL AND (p_rollout_bps < 0 OR p_rollout_bps > 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rollout_bps');
  END IF;

  IF v_run_kind = 'rollout_step' AND COALESCE(p_rollout_bps, -1) NOT IN (100, 1000, 5000, 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rollout_step_bps');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_report) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sensitive_report_payload');
  END IF;

  INSERT INTO public.video_date_phase8_certification_runs (
    event_id,
    run_kind,
    platform,
    status,
    rollout_bps,
    commit_sha,
    report,
    notes,
    certified_by,
    certified_at,
    expires_at
  )
  VALUES (
    p_event_id,
    v_run_kind,
    v_platform,
    v_status,
    p_rollout_bps,
    NULLIF(lower(btrim(COALESCE(p_commit_sha, ''))), ''),
    v_report,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    auth.uid(),
    CASE WHEN v_status IN ('passed', 'failed', 'blocked', 'waived') THEN now() ELSE NULL END,
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'run_kind', v_run_kind,
    'platform', v_platform,
    'status', v_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz) IS
  'Service-role writer for Phase 8 Video Date certification results. Rejects token/secret-shaped report payloads.';

CREATE OR REPLACE VIEW public.vw_video_date_phase8_certification_latest
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (event_id, run_kind, platform)
  id,
  event_id,
  run_kind,
  platform,
  status,
  rollout_bps,
  commit_sha,
  report,
  notes,
  certified_by,
  certified_at,
  expires_at,
  created_at,
  updated_at
FROM public.video_date_phase8_certification_runs
WHERE expires_at IS NULL OR expires_at > now()
ORDER BY event_id NULLS FIRST, run_kind, platform, certified_at DESC NULLS LAST, created_at DESC;

REVOKE ALL ON TABLE public.vw_video_date_phase8_certification_latest FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_phase8_certification_latest TO service_role;

COMMENT ON VIEW public.vw_video_date_phase8_certification_latest IS
  'Service-role latest non-expired Phase 8 certification result by event, run kind, and platform.';

CREATE OR REPLACE VIEW public.vw_video_date_phase8_rollout_step_latest
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (event_id, platform, rollout_bps)
  id,
  event_id,
  run_kind,
  platform,
  status,
  rollout_bps,
  commit_sha,
  report,
  notes,
  certified_by,
  certified_at,
  expires_at,
  created_at,
  updated_at
FROM public.video_date_phase8_certification_runs
WHERE run_kind = 'rollout_step'
  AND rollout_bps IN (100, 1000, 5000, 10000)
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY event_id NULLS FIRST, platform, rollout_bps, certified_at DESC NULLS LAST, created_at DESC;

REVOKE ALL ON TABLE public.vw_video_date_phase8_rollout_step_latest FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_phase8_rollout_step_latest TO service_role;

COMMENT ON VIEW public.vw_video_date_phase8_rollout_step_latest IS
  'Service-role latest non-expired Phase 8 rollout-step result by event, platform, and rollout_bps. Prevents stale step passes from surviving later failed step certifications.';

CREATE OR REPLACE VIEW public.vw_video_date_legacy_deck_cleanup_readiness
WITH (security_invoker = true)
AS
WITH expected(flag_key) AS (
  VALUES ('video_date.deck_deal_v2'::text)
)
SELECT
  expected.flag_key,
  COALESCE(f.enabled, false) AS enabled,
  COALESCE(f.rollout_bps, 0) AS rollout_bps,
  COALESCE(f.kill_switch_active, false) AS kill_switch_active,
  f.updated_at AS current_state_since,
  (
    COALESCE(f.enabled, false) = true
    AND COALESCE(f.rollout_bps, 0) = 10000
    AND COALESCE(f.kill_switch_active, false) = false
  ) AS deck_deal_100pct_active,
  (
    COALESCE(f.enabled, false) = true
    AND COALESCE(f.rollout_bps, 0) = 10000
    AND COALESCE(f.kill_switch_active, false) = false
    AND f.updated_at <= now() - interval '7 days'
  ) AS deck_deal_100pct_baked,
  CASE
    WHEN f.flag_key IS NULL THEN 'deck_deal_flag_missing'
    WHEN COALESCE(f.kill_switch_active, false) THEN 'deck_deal_kill_switch_active'
    WHEN NOT COALESCE(f.enabled, false) THEN 'deck_deal_not_enabled'
    WHEN COALESCE(f.rollout_bps, 0) < 10000 THEN 'deck_deal_not_100pct'
    WHEN f.updated_at > now() - interval '7 days' THEN 'deck_deal_100pct_needs_one_week_bake'
    ELSE 'legacy_deck_cleanup_allowed'
  END AS cleanup_readiness_reason
FROM expected
LEFT JOIN public.client_feature_flags f ON f.flag_key = expected.flag_key;

REVOKE ALL ON TABLE public.vw_video_date_legacy_deck_cleanup_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_legacy_deck_cleanup_readiness TO service_role;

COMMENT ON VIEW public.vw_video_date_legacy_deck_cleanup_readiness IS
  'Service-role Phase 8 cleanup gate for removing client-only deck seen refs. Requires video_date.deck_deal_v2 at 100% with no kill switch for one full week.';

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
          AND r.status = 'passed'
          AND r.rollout_bps = 100
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.rollout_bps = 100
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
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
          AND r.status = 'passed'
          AND r.rollout_bps = 1000
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.rollout_bps = 1000
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
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
          AND r.status = 'passed'
          AND r.rollout_bps = 5000
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id = es.event_id
            AND r.run_kind = 'rollout_step'
            AND r.rollout_bps = 5000
        )
        AND EXISTS (
          SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
          WHERE r.event_id IS NULL
            AND r.run_kind = 'rollout_step'
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

CREATE OR REPLACE FUNCTION public.get_video_date_phase8_rollout_readiness(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  window_id text,
  window_label text,
  event_id uuid,
  target_rollout_bps integer,
  target_label text,
  can_advance_rollout boolean,
  rollout_blockers text[],
  two_user_web_passed boolean,
  two_user_native_passed boolean,
  rls_negative_passed boolean,
  chaos_passed boolean,
  load_passed boolean,
  rollout_1pct_passed boolean,
  rollout_10pct_passed boolean,
  rollout_50pct_passed boolean,
  recovery_page_alerts integer,
  recovery_watch_alerts integer,
  stuck_active_sessions_over_2m integer,
  first_frame_sample_count integer,
  first_frame_p95_ms integer,
  first_frame_p99_ms integer,
  queue_fairness_status text,
  core_flags_present boolean,
  core_flags_enabled boolean,
  core_flags_killed boolean,
  current_rollout_bps integer,
  deck_deal_100pct_baked boolean,
  legacy_deck_cleanup_reason text,
  generated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    r.window_id,
    r.window_label,
    r.event_id,
    r.target_rollout_bps,
    r.target_label,
    r.can_advance_rollout,
    r.rollout_blockers,
    r.two_user_web_passed,
    r.two_user_native_passed,
    r.rls_negative_passed,
    r.chaos_passed,
    r.load_passed,
    r.rollout_1pct_passed,
    r.rollout_10pct_passed,
    r.rollout_50pct_passed,
    r.recovery_page_alerts,
    r.recovery_watch_alerts,
    r.stuck_active_sessions_over_2m,
    r.first_frame_sample_count,
    r.first_frame_p95_ms,
    r.first_frame_p99_ms,
    r.queue_fairness_status,
    r.core_flags_present,
    r.core_flags_enabled,
    r.core_flags_killed,
    r.current_rollout_bps,
    r.deck_deal_100pct_baked,
    r.legacy_deck_cleanup_reason,
    r.generated_at
  FROM public.vw_video_date_phase8_rollout_readiness r
  WHERE p_event_id IS NULL OR r.event_id = p_event_id
  ORDER BY
    r.event_id NULLS LAST,
    CASE r.window_id WHEN '24h' THEN 0 ELSE 1 END,
    r.target_rollout_bps;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid) IS
  'Service-role Phase 8 rollout readiness reader. Blocks rollout on missing two-user/native/RLS/chaos/load proof, uncertified prior rollout steps, active recovery pages, stuck sessions, failed latency targets, critical fairness, killed flags, or unbaked deck cleanup.';
