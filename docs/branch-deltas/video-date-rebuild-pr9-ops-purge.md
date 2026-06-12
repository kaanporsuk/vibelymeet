# Video Date Rebuild PR 9: Backend Ops-Surface Purge + Ops Posture

Branch: `claude/vd-rebuild-09-ops-purge`
Migration: `supabase/migrations/20260612210000_video_date_ops_surface_purge.sql` (cloud-applied to `schdyxcunwcvddlcshwd`)

## Posture (user-decided, do not re-litigate)

- Keep ONE synthetic monitor: `synthetic-video-date-monitor` (+ `vw_synthetic_video_date_health`, `vw_video_date_flag_rollout`).
- Keep ONE recovery-alert path: `video-date-recovery-alert-dispatcher` + `vw_video_date_recovery_alerts` (+ its base view `vw_video_date_lease_recovery_health`) + `video_date_recovery_alert_dispatches`.
- Keep `post-date-verdict-reminders` (pending-verdict lane only).
- `admin-video-date-ops` is READ-ONLY support diagnostics.

## Surviving admin-video-date-ops actions (deployed v353)

1. `metrics` (read-only): `ready_gate_open_to_date_join_latency`, `simultaneous_swipe_recovery`, `notification_outbox_health`, `timer_drift_recovered_by_server_truth` (external PostHog pointer), over 24h/7d windows.
2. `get_session_timeline` (read-only): service-role session timeline via `get_video_date_session_timeline`, payload redaction unchanged.

Removed from the Edge function: `get_video_date_sprint7_ops_health` wiring (`safety_privacy_ops_health`), launch-latency first-frame metrics (`ready_tap_to_first_remote_frame_latency`, segment/cohort/slowest-sessions), and `vw_video_date_daily_pool_decision` / `vw_video_date_daily_performance_emission_health` reads. No mutating actions existed in the deployed source at the start of this PR (already removed by earlier passes); this PR removed the dead read surfaces.

## Dropped in migration `20260612210000` (each with dependent-scan result)

Functions (31) — repo grep (src, apps/mobile, shared, scripts, supabase/functions, generated types) + live `pg_proc.prosrc` scan showed zero remaining runtime callers after the same-branch Edge/client prunes:

- Phase-8/certification: `record_video_date_phase8_certification_run_v2`, `record_video_date_phase8_legacy_cleanup_v2`, `record_video_date_phase8_rollout_step_v2`, `get_video_date_phase8_release_closure`, `get_video_date_phase8_rollout_readiness`, `upsert_video_date_certification_feedback_exception_v1`, `revoke_video_date_certification_feedback_exception_v1`, `video_date_certification_feedback_exception_active_v1`, `video_date_missing_feedback_operator_diagnostics_v1` (read both dropped ledgers; callers were tests only).
- Worker-run mutex: `begin_video_date_worker_run_v1`, `refresh_video_date_worker_run_v1`, `finish_video_date_worker_run_v1`. Verified first: drainer/finalizer lease safety is the per-row claim family (`claim_video_date_provider_outbox_v2`, `claim_video_session_deadlines_v2`, `refresh_video_date_provider_outbox_claim_v1`, `refresh_video_session_deadline_claim_v1`) — kept; the worker-run writes were removed from both Edge functions in this branch.
- Launch latency: `record_video_date_launch_latency_checkpoint`, `record_video_date_launch_latency_checkpoints_v1`, `video_date_launch_latency_safe_bool/int/text`. The `_20260505214500` generation named in the brief no longer existed live. Rows lived in `event_loop_observability_events` (kept).
- Client-stuck: `record_video_date_client_stuck_observability`, `video_date_client_stuck_safe_bool/int`. KEPT `video_date_client_stuck_safe_text` — `claim_video_date_surface` (golden flow) uses it (live prosrc scan).
- Ops-health duplicates: `get_video_date_sprint7_ops_health`, `get_video_date_phase2_recovery_health` (the dispatcher now reads `vw_video_date_recovery_alerts` directly; the RPC's `queues`/`orphanRoomCleanup` payload fields had no consumer). The `_20260610000100` generation named in the brief no longer existed live.
- Zero-feedback reminders: `claim/mark_stale/record_result/sync` `post_date_zero_feedback_reminders` v1 quartet (lane removed from `post-date-verdict-reminders`).
- Half-verdict timeouts: `detect_post_date_half_verdict_timeouts` + hourly cron `post-date-half-verdict-timeout-detection` (jobid 21) unscheduled.
- Daily-performance: `get_video_date_daily_performance_decision`, `get_video_date_daily_performance_emission_health` (validation-SQL/tests only).
- Circuit breaker: `apply_video_date_circuit_breaker_v1`, `get_video_date_circuit_breaker_decision_v1` — zero DB (`pg_proc.prosrc`), Edge, and client callers; contract-test-only. `client_feature_flags` rows untouched.

Views (16): `vw_video_date_phase8_release_closure`, `vw_video_date_phase8_rollout_readiness`, `vw_video_date_phase8_certification_latest`, `vw_video_date_phase8_rollout_step_latest`, `vw_video_date_daily_pool_decision`, `vw_video_date_daily_performance_emission_health`, `vw_video_date_daily_performance_segment_health`, `vw_video_date_daily_performance_samples` (chain's only readers were admin-video-date-ops + the dropped phase-8 views; the samples view also depended on the dropped `video_date_launch_latency_safe_*` helpers, which forced the drop order), `vw_video_date_legacy_deck_cleanup_readiness`, `vw_video_date_extension_refund_certification`, `vw_video_date_extension_mutual_health` (zero references anywhere), `vw_video_date_multi_device_health`, `vw_video_date_provider_room_reconciliation`, `vw_video_date_v4_schema_inventory`, `vw_video_date_orphan_room_cleanup_health` (only reader was the dropped phase2 RPC; the orphan-cleanup Edge writes `video_date_orphan_room_cleanup_audit`, kept), `vw_video_date_phase5_circuit_breaker_decision`.

Tables (4): `video_date_phase8_certification_runs`, `video_date_certification_feedback_exceptions`, `video_date_worker_runs`, `post_date_zero_feedback_reminders`.

## Kept with proof of dependents

- `vw_video_date_recovery_alerts` ← dispatcher (direct read after this PR); `vw_video_date_lease_recovery_health` ← `vw_video_date_recovery_alerts` definition (pg_rewrite dependency).
- `vw_video_date_flag_rollout` + `vw_synthetic_video_date_health` ← `synthetic-video-date-monitor`.
- `video_date_client_stuck_safe_text` ← `claim_video_date_surface`.
- BOTH token-refresh rate limiters ← `video-date-token-refresh` calls the provider-scoped one at room_lookup/meeting_token choke points and the caller-scoped one before mint; the brief's "collapse to whichever is called" premise was false.
- `video_date_orphan_room_cleanup_audit` + `record_video_date_orphan_room_cleanup_audit_v2` ← orphan-cleanup Edge.

## Cron consolidation decision

DEFERRED. `video-date-room-cleanup` (session-bound rooms, presence-grace before delete) and `video-date-orphan-room-cleanup` (provider-side reconciliation with safety interlock + audit ledger) both call the Daily API directly; neither routes deletes through the provider outbox `daily.delete_video_date_room` kind. Merging them means re-plumbing both through the outbox with new dedupe/lease semantics — a behavior change, not a mechanical merge. Final cron set documented in the command-center entry.

## Same-branch source changes

- Edge: `admin-video-date-ops` (1,411→~700 LOC), `video-date-recovery-alert-dispatcher` (view read), `video-date-outbox-drainer` + `video-date-deadline-finalizer` (worker-run mutex removed; row claims unchanged), `post-date-verdict-reminders` (zero-feedback lane removed), `_shared/video-date-provider-reliability.ts` (worker-run helpers removed), `_shared/admin-video-date-ops.ts` (first-frame dedupe helper removed).
- Clients: client-stuck emitter modules deleted (`shared/observability/videoDateClientStuckObservability.ts` + web/native wrappers) and their fire-and-forget call statements stripped from 11 runtime files; launch-latency mirror module deleted (`shared/observability/videoDateLaunchLatencyCheckpointObservability.ts`) and the analytics-side mirror hooks removed from `src/lib/analytics.ts` / `apps/mobile/lib/analytics.ts`. PostHog checkpoints unchanged.
- Admin UI: `AdminLiveEventMetrics` (first-frame/daily-performance tiles + slowest-sessions block removed), `AdminVideoDateTimelinePanel` (first-frame waterfall removed; timeline action intact).
- Scripts/config: `scripts/phase8-certification.ts`, `scripts/phase8-live-certification.ts`, `scripts/phase8-rollout.sh`, `shared/matching/videoDatePhase8Certification.ts` deleted; `package.json` phase8 scripts removed; `certify-video-date-required.mjs` phase8 steps removed. `test:media-phase8` (Bunny media domain) untouched.
- Validation SQL: `video_date_phase8_certification_rollout.sql`, `video_date_launch_latency_baseline.sql`, `video_date_sprint7_safety_privacy_ops.sql` deleted; `video_date_end_to_end_hardening.sql` checks 14–20 (client-stuck/launch-latency) removed.
- `src/lib/vdbg.ts`: dev-console JSON vocabulary pruned to live events (`daily_no_remote_watchdog_recovery` had no emitter; `journey_*` entries were redundant with the prefix rule).
- Tests: 4 dedicated suites deleted (phase-7 daily performance, phase-8 certification, missing-feedback closure, certification-exception closure) and removed from both runner lists; ~12 mixed suites updated to assert the retired surface stays gone (kept behavioral assertions intact).

## Cloud artifacts

- Migration `20260612210000_video_date_ops_surface_purge.sql` applied; post-apply dry-run: `Remote database is up to date`; DB lint: 0 errors (5 pre-existing warnings).
- Edge deploys: `admin-video-date-ops` v353, `post-date-verdict-reminders` v307, `video-date-outbox-drainer` v48, `video-date-deadline-finalizer` v37, `video-date-recovery-alert-dispatcher` v35.
- Known gap window: one minutely tick (2026-06-12 17:26:02Z) failed for drainer + finalizer between migration apply and Edge redeploy (`begin_video_date_worker_run_v1` missing); zero failures since; 200-OK responses verified for all kept paths after deploy.

## Manual follow-ups

- Pre-existing page alert: 26 failed `notification.send` outbox rows (`notification_no_preferences`, oldest 2026-05-27) from disposable test users without notification preferences. Either backfill prefs for smoke fixtures or classify `notification_no_preferences` as non-paging in `vw_video_date_recovery_alerts`.
- Program bar unchanged: fresh two-user run through persisted `date_feedback` still required before calling Video Date healthy.
