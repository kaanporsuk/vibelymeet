-- VD rebuild PR 9: backend ops-surface purge.
-- Posture (user-decided): keep ONE synthetic monitor (synthetic-video-date-monitor),
-- ONE recovery-alert path (video-date-recovery-alert-dispatcher reading
-- vw_video_date_recovery_alerts + video_date_recovery_alert_dispatches),
-- post-date-verdict-reminders (pending-verdict lane only), and read-only
-- admin-video-date-ops diagnostics. Everything below had zero remaining runtime
-- readers after the Edge-function prunes shipped in the same branch
-- (dependent scans recorded in the PR description).
--
-- KEPT on purpose (live dependents):
--   vw_video_date_recovery_alerts            <- alert dispatcher (reads directly after this PR)
--   vw_video_date_lease_recovery_health      <- vw_video_date_recovery_alerts definition
--   vw_video_date_flag_rollout               <- synthetic-video-date-monitor
--   vw_synthetic_video_date_health           <- synthetic-video-date-monitor
--   video_date_client_stuck_safe_text        <- claim_video_date_surface (golden flow)
--   take_video_date_token_refresh_provider_rate_limit_v1 + take_video_date_token_refresh_rate_limit_v1
--     (video-date-token-refresh calls BOTH: per-session provider buckets and caller-scope limit)
--   video_date_orphan_room_cleanup_audit + record_video_date_orphan_room_cleanup_audit_v2
--     (video-date-orphan-room-cleanup)

-- 1. Cron: half-verdict timeout detection (duplicate reminder surface).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-date-half-verdict-timeout-detection') THEN
    PERFORM cron.unschedule('post-date-half-verdict-timeout-detection');
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.detect_post_date_half_verdict_timeouts(interval, integer);

-- 2. Phase-8 / certification surface (views before backing table).
DROP VIEW IF EXISTS public.vw_video_date_phase8_release_closure;
DROP VIEW IF EXISTS public.vw_video_date_phase8_rollout_readiness;
DROP VIEW IF EXISTS public.vw_video_date_phase8_certification_latest;
DROP VIEW IF EXISTS public.vw_video_date_phase8_rollout_step_latest;

DROP FUNCTION IF EXISTS public.get_video_date_phase8_release_closure();
DROP FUNCTION IF EXISTS public.get_video_date_phase8_rollout_readiness(uuid);
DROP FUNCTION IF EXISTS public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamp with time zone);

DROP TABLE IF EXISTS public.video_date_phase8_certification_runs;

-- Certification feedback exceptions (runtime-dead; only callers were the
-- certification scripts/tests removed in this branch).
DROP FUNCTION IF EXISTS public.upsert_video_date_certification_feedback_exception_v1(uuid, uuid, text, text, jsonb, timestamp with time zone);
DROP FUNCTION IF EXISTS public.revoke_video_date_certification_feedback_exception_v1(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.video_date_certification_feedback_exception_active_v1(uuid, uuid);
-- Operator diagnostics RPC reads both dropped tables; no runtime caller.
DROP FUNCTION IF EXISTS public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer);

DROP TABLE IF EXISTS public.video_date_certification_feedback_exceptions;

-- 3. Worker-run observability. The outbox drainer and deadline finalizer used
-- video_date_worker_runs only as a whole-run mutex; per-row safety is the
-- claim/lease RPC family (claim_video_date_provider_outbox_v2 /
-- claim_video_session_deadlines_v2 + refresh_*_claim_v1), which stays.
-- The worker-run writes are removed from both Edge functions in this branch.
DROP FUNCTION IF EXISTS public.begin_video_date_worker_run_v1(text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.refresh_video_date_worker_run_v1(text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.finish_video_date_worker_run_v1(text, text, jsonb);
DROP TABLE IF EXISTS public.video_date_worker_runs;

-- 4. Daily-performance decision surface. Only readers were admin-video-date-ops
-- (pruned in this branch) and the phase-8 views dropped above. These views
-- must drop before the launch-latency sanitizer helpers they reference.
DROP FUNCTION IF EXISTS public.get_video_date_daily_performance_decision(uuid);
DROP FUNCTION IF EXISTS public.get_video_date_daily_performance_emission_health(uuid);
DROP VIEW IF EXISTS public.vw_video_date_daily_pool_decision;
DROP VIEW IF EXISTS public.vw_video_date_daily_performance_emission_health;
DROP VIEW IF EXISTS public.vw_video_date_daily_performance_segment_health;
DROP VIEW IF EXISTS public.vw_video_date_daily_performance_samples;

-- 5. Launch-latency checkpoint observability (writers + sanitizer helpers).
-- Rows lived in event_loop_observability_events (kept table); only the
-- recording RPCs and their client emitters (removed in this branch) go.
DROP FUNCTION IF EXISTS public.record_video_date_launch_latency_checkpoints_v1(uuid, jsonb);
DROP FUNCTION IF EXISTS public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.video_date_launch_latency_safe_bool(text);
DROP FUNCTION IF EXISTS public.video_date_launch_latency_safe_int(text, integer, integer);
DROP FUNCTION IF EXISTS public.video_date_launch_latency_safe_text(text, integer);

-- 6. Client-stuck debug observability. claim_video_date_surface keeps
-- video_date_client_stuck_safe_text; the bool/int helpers were only used by
-- the dropped recorder.
DROP FUNCTION IF EXISTS public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.video_date_client_stuck_safe_bool(text);
DROP FUNCTION IF EXISTS public.video_date_client_stuck_safe_int(text, integer, integer);

-- 7. Ops-health RPC duplicates. The kept alert dispatcher now reads
-- vw_video_date_recovery_alerts directly; admin-video-date-ops no longer
-- calls the sprint7 aggregate.
DROP FUNCTION IF EXISTS public.get_video_date_sprint7_ops_health(uuid);
DROP FUNCTION IF EXISTS public.get_video_date_phase2_recovery_health();

-- 8. Zero-feedback reminder lane (duplicate of pending-verdict reminders).
DROP FUNCTION IF EXISTS public.claim_post_date_zero_feedback_reminders_v1(integer);
DROP FUNCTION IF EXISTS public.mark_post_date_zero_feedback_reminders_stale_v1(interval, integer);
DROP FUNCTION IF EXISTS public.record_post_date_zero_feedback_reminder_result_v1(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.sync_post_date_zero_feedback_reminders_v1(interval, integer);
DROP TABLE IF EXISTS public.post_date_zero_feedback_reminders;

-- 9. Circuit-breaker decision surface: zero DB/Edge/client callers
-- (contract-test-only since the flag purge; client_feature_flags rows untouched).
DROP FUNCTION IF EXISTS public.apply_video_date_circuit_breaker_v1(text, boolean);
DROP FUNCTION IF EXISTS public.get_video_date_circuit_breaker_decision_v1();
DROP VIEW IF EXISTS public.vw_video_date_phase5_circuit_breaker_decision;

-- 10. Health/rollout views with zero remaining readers after the above.
DROP VIEW IF EXISTS public.vw_video_date_legacy_deck_cleanup_readiness;
DROP VIEW IF EXISTS public.vw_video_date_extension_refund_certification;
DROP VIEW IF EXISTS public.vw_video_date_extension_mutual_health;
DROP VIEW IF EXISTS public.vw_video_date_multi_device_health;
DROP VIEW IF EXISTS public.vw_video_date_provider_room_reconciliation;
DROP VIEW IF EXISTS public.vw_video_date_v4_schema_inventory;
DROP VIEW IF EXISTS public.vw_video_date_orphan_room_cleanup_health;
