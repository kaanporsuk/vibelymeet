import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DATE_PHASE8_PR_SLICES,
  VIDEO_DATE_PHASE8_ROLLOUT_STEPS,
  evaluateVideoDatePhase8Rollout,
  getVideoDatePhase8ReleaseClosureBlockers,
  isVideoDatePhase8ReleaseClosed,
  isVideoDateLegacyDeckCleanupAllowed,
  nextVideoDatePhase8RolloutStep,
  type VideoDatePhase8CertificationInput,
} from "./videoDatePhase8Certification";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522020000_video_date_phase8_certification_rollout.sql"),
  "utf8",
);
const validationSql = readFileSync(
  join(root, "supabase/validation/video_date_phase8_certification_rollout.sql"),
  "utf8",
);
const closureMigration = readFileSync(
  join(root, "supabase/migrations/20260522021000_video_date_phase8_release_closure.sql"),
  "utf8",
);
const rolloutSelfCheckMigration = readFileSync(
  join(root, "supabase/migrations/20260522150000_video_date_phase8_rollout_readiness_self_check.sql"),
  "utf8",
);
const reviewFollowupsMigration = readFileSync(
  join(root, "supabase/migrations/20260522023000_video_date_review_comment_followups_986_989.sql"),
  "utf8",
);
const twoUserHarness = readFileSync(join(root, "e2e/video-date-two-user.staging.spec.ts"), "utf8");
const runtimeRlsTest = readFileSync(join(root, "shared/matching/videoDateRealtimeRlsRuntime.test.ts"), "utf8");
const phase8CertificationScript = readFileSync(join(root, "scripts/phase8-certification.ts"), "utf8");
const phase8LiveCertificationScript = readFileSync(join(root, "scripts/phase8-live-certification.ts"), "utf8");
const phase8RolloutScript = readFileSync(join(root, "scripts/phase8-rollout.sh"), "utf8");
const phase8Workflow = readFileSync(join(root, ".github/workflows/video-date-phase8-certification.yml"), "utf8");
const runbook = readFileSync(join(root, "docs/video-date-v4-phase8-certification-rollout.md"), "utf8");
const legacyChecklist = readFileSync(join(root, "docs/video-date-v4-legacy-cleanup-checklist.md"), "utf8");
const dailyRoomPoolDecisionLog = readFileSync(join(root, "docs/video-date-daily-room-pool-decision-log.md"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const webDeckHook = readFileSync(join(root, "src/hooks/useEventDeck.ts"), "utf8");
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const instantExperience = readFileSync(join(root, "shared/matching/videoDateInstantExperience.ts"), "utf8");

const cleanInput: VideoDatePhase8CertificationInput = {
  twoUserWebPassed: true,
  twoUserNativePassed: true,
  rlsNegativePassed: true,
  chaosPassed: true,
  loadPassed: true,
  recoveryPageAlerts: 0,
  recoveryWatchAlerts: 0,
  stuckActiveSessionsOver2m: 0,
  firstFrameSampleCount: 150,
  firstFrameP95Ms: 4200,
  firstFrameP99Ms: 7200,
  dailyProductionConfigReady: true,
  dailyWebhookSecretReady: true,
  dailyCleanupCronReady: true,
  coreFlagsEnabled: true,
  coreFlagsKilled: false,
  currentRolloutBps: 0,
  rollout1PctPassed: true,
  rollout10PctPassed: true,
  rollout50PctPassed: true,
  deckDeal100PctBaked: true,
};

test("PR 8.1-8.6 slices are explicit and cover web, native, backend, rollout, and cleanup", () => {
  assert.deepEqual(
    VIDEO_DATE_PHASE8_PR_SLICES.map((slice) => slice.pr),
    ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6"],
  );
  assert.ok(VIDEO_DATE_PHASE8_PR_SLICES.some((slice) => slice.ownerSurface === "web_native_cleanup"));
  assert.ok(VIDEO_DATE_PHASE8_PR_SLICES.some((slice) => slice.ownerSurface === "ops_release"));
  assert.deepEqual(
    VIDEO_DATE_PHASE8_ROLLOUT_STEPS.map((step) => step.targetRolloutBps),
    [100, 1000, 5000, 10000],
  );
  assert.equal(VIDEO_DATE_PHASE8_ROLLOUT_STEPS.at(-1)?.requiresDeckBake, true);
});

test("Phase 8 release closure blocks until every rollout and cleanup proof is present", () => {
  const cleanClosure = {
    ...cleanInput,
    currentRolloutBps: 10000,
    rollout1PctPassed: true,
    rollout10PctPassed: true,
    rollout50PctPassed: true,
    rollout100PctPassed: true,
    legacyCleanupPassed: true,
  };
  assert.deepEqual(getVideoDatePhase8ReleaseClosureBlockers(cleanClosure), []);
  assert.equal(isVideoDatePhase8ReleaseClosed(cleanClosure), true);

  const blocked = getVideoDatePhase8ReleaseClosureBlockers({
    ...cleanClosure,
    currentRolloutBps: 5000,
    rollout100PctPassed: false,
    legacyCleanupPassed: false,
    recoveryPageAlerts: 1,
  });
  assert.ok(blocked.includes("current_rollout_bps_below_100pct"));
  assert.ok(blocked.includes("rollout_100pct_not_certified"));
  assert.ok(blocked.includes("legacy_cleanup_not_certified"));
  assert.ok(blocked.includes("recovery_page_alerts_active"));
});

test("Phase 8 rollout decision blocks on missing proof and allows only clean ramps", () => {
  const allowed = evaluateVideoDatePhase8Rollout(cleanInput);
  assert.equal(allowed.length, 4);
  assert.ok(allowed[0].allowed, "clean prerelease state should allow only the first 1% slice");
  assert.ok(allowed[1].blockers.includes("current_rollout_bps_below_1pct"));
  assert.ok(allowed[2].blockers.includes("current_rollout_bps_below_10pct"));
  assert.ok(allowed[3].blockers.includes("current_rollout_bps_below_50pct"));
  assert.equal(nextVideoDatePhase8RolloutStep(cleanInput)?.targetRolloutBps, 100);

  const tenPercentReady = evaluateVideoDatePhase8Rollout({
    ...cleanInput,
    currentRolloutBps: 100,
  });
  assert.equal(tenPercentReady[1].allowed, true);
  assert.equal(nextVideoDatePhase8RolloutStep({ ...cleanInput, currentRolloutBps: 100 })?.targetRolloutBps, 1000);

  const blocked = evaluateVideoDatePhase8Rollout({
    ...cleanInput,
    currentRolloutBps: 10000,
    dailyProductionConfigReady: false,
    dailyWebhookSecretReady: false,
    dailyCleanupCronReady: false,
    firstFrameSampleCount: 10,
    firstFrameP95Ms: 6100,
    deckDeal100PctBaked: false,
  });
  assert.equal(blocked[0].allowed, false);
  assert.ok(blocked[0].blockers.includes("daily_production_config_not_ready"));
  assert.ok(blocked[0].blockers.includes("daily_webhook_secret_not_ready"));
  assert.ok(blocked[0].blockers.includes("daily_cleanup_cron_not_ready"));
  assert.ok(blocked[1].blockers.includes("insufficient_first_frame_samples"));
  assert.ok(blocked[1].blockers.includes("first_frame_p95_over_target"));
  assert.ok(blocked[3].blockers.includes("deck_deal_100pct_not_baked"));

  const missingPriorSteps = evaluateVideoDatePhase8Rollout({
    ...cleanInput,
    rollout1PctPassed: false,
    rollout10PctPassed: false,
    rollout50PctPassed: false,
  });
  assert.equal(missingPriorSteps[0].allowed, true);
  assert.ok(missingPriorSteps[1].blockers.includes("rollout_1pct_not_certified"));
  assert.ok(missingPriorSteps[2].blockers.includes("rollout_10pct_not_certified"));
  assert.ok(missingPriorSteps[3].blockers.includes("rollout_50pct_not_certified"));
});

test("legacy deck cleanup is impossible until server-dealt deck has baked at 100 percent", () => {
  assert.equal(isVideoDateLegacyDeckCleanupAllowed({ ...cleanInput, currentRolloutBps: 10000 }), true);
  assert.equal(
    isVideoDateLegacyDeckCleanupAllowed({
      ...cleanInput,
      deckDeal100PctBaked: false,
    }),
    false,
  );
  assert.equal(
    isVideoDateLegacyDeckCleanupAllowed({
      ...cleanInput,
      currentRolloutBps: 5000,
    }),
    false,
  );
  assert.equal(
    isVideoDateLegacyDeckCleanupAllowed({
      ...cleanInput,
      dailyCleanupCronReady: false,
      currentRolloutBps: 10000,
    }),
    false,
  );
});

test("PR 8.3 adds service-role certification ledger, views, RPC, and token-free blockers", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_phase8_certification_runs/);
  assert.match(migration, /run_kind IN \([\s\S]*'two_user_e2e'[\s\S]*'rls_negative'[\s\S]*'chaos'[\s\S]*'load'[\s\S]*'native_smoke'[\s\S]*'rollout_step'[\s\S]*'legacy_cleanup'/);
  assert.match(migration, /platform IN \('web', 'native', 'mobile', 'cross_platform', 'backend', 'ops'\)/);
  assert.match(migration, /CHECK \(NOT public\.video_date_jsonb_has_secret_key\(report\)\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_certification_run_v2/);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'[\s\S]*session_user NOT IN \('postgres', 'supabase_admin'\)/);
  assert.match(migration, /invalid_rollout_step_bps/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase8_certification_latest/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase8_rollout_step_latest/);
  assert.match(migration, /DISTINCT ON \(event_id, platform, rollout_bps\)/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_legacy_deck_cleanup_readiness/);
  assert.match(migration, /expected\(flag_key\) AS \(\s+VALUES \('video_date\.deck_deal_v2'::text\)/);
  assert.match(migration, /'deck_deal_flag_missing'/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase8_rollout_readiness/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_phase8_rollout_readiness/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.vw_video_date_phase8_rollout_readiness TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_phase8_rollout_readiness\(uuid\)\s+TO service_role/);
  assert.match(migration, /'two_user_web_not_passed'/);
  assert.match(migration, /'rollout_1pct_not_certified'/);
  assert.match(migration, /'rollout_10pct_not_certified'/);
  assert.match(migration, /'rollout_50pct_not_certified'/);
  assert.match(migration, /'current_rollout_bps_below_1pct'/);
  assert.match(migration, /'current_rollout_bps_below_10pct'/);
  assert.match(migration, /'current_rollout_bps_below_50pct'/);
  assert.match(migration, /'first_frame_p95_over_target'/);
  assert.match(migration, /'deck_deal_100pct_not_baked'/);
  assert.match(migration, /NOT EXISTS \([\s\S]*r\.event_id = es\.event_id[\s\S]*r\.run_kind = 'two_user_e2e'[\s\S]*r\.event_id IS NULL/);
  assert.match(migration, /public\.vw_video_date_phase8_rollout_step_latest r[\s\S]*r\.event_id = es\.event_id[\s\S]*r\.event_id IS NULL/);
  assert.match(migration, /r\.run_kind = 'rollout_step'[\s\S]+r\.platform = 'ops'[\s\S]+r\.rollout_bps = 100/);
  assert.match(migration, /r\.run_kind = 'rollout_step'[\s\S]+r\.platform = 'ops'[\s\S]+r\.rollout_bps = 1000/);
  assert.match(migration, /r\.run_kind = 'rollout_step'[\s\S]+r\.platform = 'ops'[\s\S]+r\.rollout_bps = 5000/);
  assert.match(reviewFollowupsMigration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase8_rollout_readiness/);
  assert.match(reviewFollowupsMigration, /r\.run_kind = 'rollout_step'[\s\S]+r\.platform = 'ops'[\s\S]+r\.rollout_bps = 100/);
  assert.doesNotMatch(migration, /vs\.created_at/);
  assert.doesNotMatch(migration, /DAILY_API_KEY|createMeetingToken|meeting_token|daily_token|Bearer/i);
});

test("PR 8.4 and PR 8.6 add narrow ops wrappers and release closure without token material", () => {
  assert.match(closureMigration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_rollout_step_v2/);
  assert.match(closureMigration, /p_rollout_bps NOT IN \(100, 1000, 5000, 10000\)/);
  assert.match(closureMigration, /rollout_step_not_live/);
  assert.match(closureMigration, /public\.video_date_jsonb_has_secret_key\(v_report\)/);
  assert.match(closureMigration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(closureMigration, /legacy_cleanup_not_ready/);
  assert.match(closureMigration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase8_release_closure/);
  assert.match(closureMigration, /'rollout_100pct_not_certified'/);
  assert.match(closureMigration, /'legacy_cleanup_not_certified'/);
  assert.match(closureMigration, /CREATE OR REPLACE FUNCTION public\.get_video_date_phase8_release_closure/);
  assert.match(closureMigration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_phase8_rollout_step_v2/);
  assert.match(closureMigration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(closureMigration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_phase8_release_closure\(\)/);
  assert.doesNotMatch(closureMigration, /DAILY_API_KEY|createMeetingToken|meeting_token|daily_token|Bearer/i);
});

test("end-state rollout proof is fail-safe against blocked readiness rows", () => {
  assert.match(rolloutSelfCheckMigration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_certification_run_v2/);
  assert.match(rolloutSelfCheckMigration, /'error', 'dedicated_rollout_step_recorder_required'/);
  assert.match(rolloutSelfCheckMigration, /'error', 'dedicated_legacy_cleanup_recorder_required'/);
  assert.match(rolloutSelfCheckMigration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_rollout_step_v2/);
  assert.match(rolloutSelfCheckMigration, /public\.get_video_date_phase8_rollout_readiness\(p_event_id\)/);
  assert.match(rolloutSelfCheckMigration, /r\.target_rollout_bps = p_rollout_bps/);
  assert.match(rolloutSelfCheckMigration, /COALESCE\(tr\.can_advance_rollout, false\) IS NOT TRUE/);
  assert.match(rolloutSelfCheckMigration, /'error', 'rollout_readiness_missing'/);
  assert.match(rolloutSelfCheckMigration, /'error', 'rollout_readiness_blocked'/);
  assert.match(rolloutSelfCheckMigration, /'blocked_rows', v_blocked_rows/);
  assert.match(rolloutSelfCheckMigration, /'blockers', v_blockers/);
  assert.match(rolloutSelfCheckMigration, /'readiness_rows_checked', v_readiness_rows/);
  assert.match(rolloutSelfCheckMigration, /INSERT INTO public\.video_date_phase8_certification_runs \([\s\S]*'rollout_step'[\s\S]*'ops'[\s\S]*'passed'/);
  assert.match(rolloutSelfCheckMigration, /CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(rolloutSelfCheckMigration, /'error', 'legacy_cleanup_not_ready'/);
  assert.match(rolloutSelfCheckMigration, /INSERT INTO public\.video_date_phase8_certification_runs \([\s\S]*'legacy_cleanup'[\s\S]*'ops'[\s\S]*'passed'/);
  assert.doesNotMatch(
    rolloutSelfCheckMigration.match(/CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_rollout_step_v2[\s\S]+?COMMENT ON FUNCTION public\.record_video_date_phase8_rollout_step_v2/)?.[0] ?? "",
    /record_video_date_phase8_certification_run_v2/,
  );
  assert.doesNotMatch(
    rolloutSelfCheckMigration.match(/CREATE OR REPLACE FUNCTION public\.record_video_date_phase8_legacy_cleanup_v2[\s\S]+?COMMENT ON FUNCTION public\.record_video_date_phase8_legacy_cleanup_v2/)?.[0] ?? "",
    /record_video_date_phase8_certification_run_v2/,
  );
  assert.doesNotMatch(rolloutSelfCheckMigration, /DAILY_API_KEY|createMeetingToken|meeting_token|daily_token|Bearer/i);
});

test("Phase 8 certification treats Daily production config as an ops launch blocker", () => {
  assert.match(phase8CertificationScript, /evaluateDailyProductionConfigReadiness/);
  assert.match(phase8CertificationScript, /function assertDailyProductionLaunchConfigReady/);
  assert.match(phase8CertificationScript, /daily_production_config_blocked/);
  assert.match(phase8CertificationScript, /DAILY_API_KEY/);
  assert.match(phase8CertificationScript, /DAILY_DOMAIN/);
  assert.match(phase8CertificationScript, /DAILY_WEBHOOK_SECRET/);
  assert.match(phase8CertificationScript, /PHASE8_STAGING_CRON_SECRET", "CRON_SECRET"/);
  assert.match(phase8CertificationScript, /function assertRecoveryAlertConfigReady/);
  assert.match(phase8CertificationScript, /recovery_alert_config_blocked/);
  assert.match(phase8CertificationScript, /VIDEO_DATE_RECOVERY_SLACK_WEBHOOK_URL/);
  assert.match(phase8CertificationScript, /SENTRY_DSN/);
  assert.match(phase8CertificationScript, /recordRolloutStep[\s\S]*assertDailyProductionLaunchConfigReady/);
  assert.match(phase8CertificationScript, /recordLegacyCleanup[\s\S]*assertDailyProductionLaunchConfigReady/);
  assert.doesNotMatch(phase8CertificationScript, /dailyApiKey[\s\S]{0,200}console\.log|DAILY_API_KEY[\s\S]{0,200}console\.log/);
});

test("PR 8.5 retires client-only deck fallback on web and native", () => {
  assert.match(webDeckHook, /rpc\("get_event_deck_v3"/);
  assert.match(webDeckHook, /VIDEO_DATE_DECK_BUFFER_LIMIT/);
  assert.match(instantExperience, /VIDEO_DATE_DECK_BUFFER_LIMIT = 5/);
  assert.match(instantExperience, /VIDEO_DATE_DECK_TOP_UP_THRESHOLD = 2/);
  assert.match(webDeckHook, /\["event-deck", eventId, user\?\.id, "deck_v3"\]/);
  assert.doesNotMatch(webDeckHook, /video_date\.deck_deal_v2|deck_v1|["']get_event_deck["']/);
  assert.doesNotMatch(webLobby, /seenProfileIds|deckDealV2|deckNonce|deck_invalidate_after_swipe/);
  assert.doesNotMatch(webLobby, /deckPosition|1\s*\/\s*\{deckRemaining\}\s*left/);
  assert.match(webLobby, /Next card ready/);
  assert.match(webLobby, /sortedProfiles\.slice\(0, 3\)[\s\S]+new Image\(\)/);
  assert.match(webLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
  assert.match(webLobby, /Server-dealt deck v3 is the only active source of deck exclusion truth/);

  assert.match(nativeEventsApi, /rpc\('get_event_deck_v3'/);
  assert.match(nativeEventsApi, /VIDEO_DATE_DECK_BUFFER_LIMIT/);
  assert.match(nativeEventsApi, /\['event-deck', eventId, viewerProfileId, 'deck_v3'\]/);
  assert.doesNotMatch(nativeEventsApi, /video_date\.deck_deal_v2|deck_v1|["']get_event_deck["']/);
  assert.doesNotMatch(nativeLobby, /seenProfileIdsRef|deckDealV2|deckNonce|swipe_failure_advance_deck|swipe_advance_deck/);
  assert.doesNotMatch(nativeLobby, /1 \/ \$\{sortedProfiles\.length\} left|deckProgress = useMemo/);
  assert.match(nativeLobby, /Next card ready/);
  assert.match(nativeLobby, /sortedProfiles\.slice\(0, 3\)[\s\S]+prefetchNativeDeckImage\(src\)/);
  assert.match(nativeLobby, /ExpoImage\.prefetch\(uri,[\s\S]+RNImage\.prefetch\(uri\)/);
  assert.match(nativeLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
  assert.match(nativeLobby, /Server-dealt deck v3 is the only active source of deck exclusion truth/);
});

test("PR 8.1 two-user harness covers early continue, reload recovery, and survey recovery", () => {
  assert.match(twoUserHarness, /VIBELY_E2E_TWO_USER_WEB/);
  assert.match(twoUserHarness, /VIBELY_E2E_USER_A_STATE/);
  assert.match(twoUserHarness, /VIBELY_E2E_USER_B_STATE/);
  assert.match(twoUserHarness, /permissions: \["camera", "microphone"\]/);
  assert.match(twoUserHarness, /attachBrowserDiagnostics/);
  assert.match(twoUserHarness, /continue when ready/i);
  assert.match(twoUserHarness, /pageA\.reload/);
  assert.match(twoUserHarness, /Keep the vibe\|Awaiting your match\|How was/);
});

test("PR 8.2 runtime RLS, chaos, and load certification are documented and recordable", () => {
  assert.match(runtimeRlsTest, /VIDEO_DATE_RLS_NON_PARTICIPANT_JWT/);
  assert.match(runtimeRlsTest, /assert\.notEqual\(nonParticipant\.status, "SUBSCRIBED"\)/);
  assert.match(phase8LiveCertificationScript, /CHAOS_SCENARIOS = \[[\s\S]*"duplicate_taps"[\s\S]*"broadcast_loss"[\s\S]*"daily_webhook_loss"[\s\S]*"worker_crash_retry"[\s\S]*"delayed_push_deeplink"/);
  assert.match(phase8LiveCertificationScript, /LOAD_PATHS = \[[\s\S]*"deadline_finalizer"[\s\S]*"outbox_drainer"[\s\S]*"snapshot_fetch"[\s\S]*"daily_credentialed_entry"/);
  assert.doesNotMatch(phase8LiveCertificationScript, /"queue_drain"|queue_drain:/);
  assert.match(phase8LiveCertificationScript, /video-date-outbox-drainer/);
  assert.match(phase8LiveCertificationScript, /video-date-deadline-finalizer/);
  assert.match(phase8LiveCertificationScript, /synthetic-video-date-monitor/);
  assert.match(phase8LiveCertificationScript, /video-date-snapshot/);
  assert.match(phase8LiveCertificationScript, /function assertProbeOk/);
  assert.match(phase8LiveCertificationScript, /function probeSummary/);
  assert.match(phase8LiveCertificationScript, /function recordFailure/);
  assert.match(phase8LiveCertificationScript, /function runCertification/);
  assert.match(phase8LiveCertificationScript, /statusForFailure/);
  assert.match(phase8LiveCertificationScript, /"blocked"/);
  assert.match(phase8LiveCertificationScript, /"failed"/);
  assert.match(phase8LiveCertificationScript, /payloadOk = payload\.ok !== false/);
  assert.match(phase8LiveCertificationScript, /assertProbeOk\("synthetic-video-date-monitor", synthetic\)/);
  assert.match(phase8LiveCertificationScript, /assertProbeOk\("video-date-snapshot load probe", snapshot\)/);
  assert.match(phase8LiveCertificationScript, /synthetic_monitor: probeSummary\(synthetic\)/);
  assert.match(phase8LiveCertificationScript, /snapshot_fetch: probeSummary\(snapshot\)/);
  assert.match(phase8LiveCertificationScript, /throw new Error\("snapshot_probe_env_missing"\)/);
  assert.match(phase8LiveCertificationScript, /record\("chaos", "cross_platform"/);
  assert.match(phase8LiveCertificationScript, /record\("load", "backend"/);
  assert.match(phase8LiveCertificationScript, /runCertification\("two_user_e2e", "web", "two-user-web", runTwoUserWeb\)/);
  assert.match(phase8LiveCertificationScript, /runCertification\("rls_negative", "backend", "rls", runRuntimeRls\)/);
  assert.match(phase8LiveCertificationScript, /runCertification\("chaos", "cross_platform", "chaos", runChaos\)/);
  assert.match(phase8LiveCertificationScript, /runCertification\("load", "backend", "load", runLoad\)/);
  assert.match(runbook, /run_kind='rls_negative'/);
  assert.match(runbook, /run_kind='chaos'/);
  assert.match(runbook, /run_kind='load'/);
  assert.match(runbook, /Broadcast loss/);
  assert.match(runbook, /Daily webhook loss/);
  assert.match(runbook, /worker crash\/retry/);
  assert.match(runbook, /queue drain, deadline finalizer, outbox drainer, snapshot fetch, and Daily token paths/);
});

test("Phase 8 certification tooling records native smoke and rollout proof without hand-written SQL", () => {
  assert.match(phase8CertificationScript, /record_video_date_phase8_certification_run_v2/);
  assert.match(phase8CertificationScript, /record_video_date_phase8_rollout_step_v2/);
  assert.match(phase8CertificationScript, /record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(phase8CertificationScript, /NATIVE_SMOKE_FLAGS = \[[\s\S]*"ios"[\s\S]*"android"[\s\S]*"background-foreground"[\s\S]*"delayed-push-deeplink"[\s\S]*"switch-device"[\s\S]*"early-continue"[\s\S]*"safety"[\s\S]*"mutual-extension"[\s\S]*"survey-recovery"/);
  assert.match(phase8CertificationScript, /function requiredSha/);
  assert.match(phase8CertificationScript, /passed certification records require --commit-sha or GITHUB_SHA/);
  assert.match(phase8CertificationScript, /passed \$\{runKind\} records must use the dedicated/);
  assert.match(phase8CertificationScript, /native-smoke requires --operator or GITHUB_ACTOR/);
  assert.match(phase8CertificationScript, /commitSha: requiredSha\(commitSha, "native-smoke"\)/);
  assert.match(phase8CertificationScript, /commitSha: requiredSha\(commitSha, "rollout-step"\)/);
  assert.match(phase8CertificationScript, /commitSha: requiredSha\(commitSha, "legacy-cleanup"\)/);
  assert.match(phase8CertificationScript, /SECRET_KEY_PATTERN/);
  assert.match(phase8CertificationScript, /Refusing to record secret-shaped report key/);
  assert.match(phase8CertificationScript, /PHASE8_STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(phase8CertificationScript, /function formatRolloutReadinessBlockers/);
  assert.match(phase8CertificationScript, /async function assertRolloutReadiness/);
  assert.match(phase8CertificationScript, /get_video_date_phase8_rollout_readiness/);
  assert.match(phase8CertificationScript, /targetRows = rows\.filter\(\(row\) => Number\(row\.target_rollout_bps\) === rolloutBps\)/);
  assert.match(phase8CertificationScript, /Phase 8 rollout readiness blockers:/);
  assert.match(phase8CertificationScript, /rollout_readiness_blocked/);
  const rolloutStepBody = phase8CertificationScript.match(
    /async function recordRolloutStep[\s\S]+?async function recordLegacyCleanup/,
  )?.[0];
  assert.ok(rolloutStepBody, "missing recordRolloutStep body");
  assert.ok(
    rolloutStepBody.indexOf("await assertRolloutReadiness") <
      rolloutStepBody.indexOf("record_video_date_phase8_rollout_step_v2"),
    "CLI must preflight rollout readiness before recording rollout proof",
  );
  assert.match(phase8RolloutScript, /phase8-certification\.ts rollout-step/);
  assert.match(phase8RolloutScript, /phase8-certification\.ts legacy-cleanup/);
  assert.match(packageJson, /"phase8:certify": "tsx scripts\/phase8-certification\.ts"/);
  assert.match(packageJson, /"phase8:live-certify": "tsx scripts\/phase8-live-certification\.ts"/);
  assert.match(packageJson, /"phase8:rollout": "bash scripts\/phase8-rollout\.sh"/);
});

test("Phase 8 live certification runs nightly and manually against staging, not as a PR build", () => {
  assert.match(phase8Workflow, /name: Video Date Phase 8 Certification/);
  assert.match(phase8Workflow, /workflow_dispatch:/);
  assert.match(phase8Workflow, /schedule:/);
  assert.doesNotMatch(phase8Workflow, /pull_request:/);
  assert.match(phase8Workflow, /PHASE8_STAGING_BASE_URL/);
  assert.match(phase8Workflow, /PHASE8_STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(phase8Workflow, /PHASE8_E2E_USER_A_STATE_JSON/);
  assert.match(phase8Workflow, /PHASE8_RLS_NON_PARTICIPANT_JWT/);
  assert.match(phase8Workflow, /scripts\/phase8-live-certification\.ts/);
  assert.match(phase8Workflow, /npx playwright install --with-deps chromium/);
  assert.match(phase8LiveCertificationScript, /VIBELY_E2E_USE_EXTERNAL_SERVER/);
  assert.match(phase8LiveCertificationScript, /video-date-two-user\.staging\.spec\.ts/);
  assert.match(phase8LiveCertificationScript, /videoDateRealtimeRlsRuntime\.test\.ts/);
  assert.match(phase8LiveCertificationScript, /app\.video_date_phase8_event_id=\$\{targetEventId\}/);
  assert.match(phase8LiveCertificationScript, /PGOPTIONS: pgOptions/);
  assert.match(validationSql, /phase7_daily_performance_emitters_receiving/);
  assert.match(validationSql, /vw_video_date_daily_performance_emission_health/);
  assert.match(validationSql, /CROSS JOIN target_event target/);
  assert.match(validationSql, /h\.event_id IS NOT DISTINCT FROM target\.event_id/);
});

test("Phase 8 validation and legacy cleanup docs are wired to the rollout gate", () => {
  assert.match(validationSql, /phase8_certification_ledger_exists/);
  assert.match(validationSql, /COUNT\(\*\) = 5 AS ok/);
  assert.match(validationSql, /vw_video_date_phase8_rollout_step_latest/);
  assert.match(validationSql, /vw_video_date_phase8_release_closure/);
  assert.match(validationSql, /record_video_date_phase8_rollout_step_v2/);
  assert.match(validationSql, /record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(validationSql, /get_video_date_daily_performance_emission_health/);
  assert.match(validationSql, /get_video_date_phase8_release_closure/);
  assert.match(validationSql, /phase8_no_next_rollout_blockers/);
  assert.match(validationSql, /current_setting\('app\.video_date_phase8_event_id', true\)/);
  assert.match(
    validationSql,
    /FROM public\.video_date_phase8_certification_runs runs[\s\S]+runs\.event_id IS NOT DISTINCT FROM readiness\.event_id[\s\S]+OR runs\.event_id IS NULL/,
  );
  assert.match(validationSql, /current_rollout_bps < 1000 THEN 1000/);
  assert.match(validationSql, /phase8_legacy_deck_cleanup_ready/);
  assert.match(validationSql, /phase8_release_closure_has_no_blockers/);
  assert.match(runbook, /1% -> 10% -> 50% -> 100%/);
  assert.match(runbook, /get_video_date_phase8_rollout_readiness/);
  assert.match(runbook, /phase8:rollout[\s\S]+record_video_date_phase8_rollout_step_v2[\s\S]+both preflight/);
  assert.match(runbook, /Generic passed `rollout_step` and `legacy_cleanup` rows are rejected/);
  assert.match(runbook, /record_video_date_phase8_rollout_step_v2/);
  assert.match(runbook, /record_video_date_phase8_legacy_cleanup_v2/);
  assert.match(runbook, /get_video_date_phase8_release_closure/);
  assert.match(runbook, /vw_video_date_legacy_deck_cleanup_readiness/);
  assert.match(legacyChecklist, /vw_video_date_legacy_deck_cleanup_readiness/);
  assert.match(legacyChecklist, /get_video_date_phase8_release_closure/);
  assert.doesNotMatch(legacyChecklist, /acceptable duplicate-card prevention/);
});

test("Daily room-pool deferral has an explicit operator decision log", () => {
  assert.match(dailyRoomPoolDecisionLog, /video_date\.daily_pool_v2` remains disabled/);
  assert.match(dailyRoomPoolDecisionLog, /get_video_date_daily_performance_decision/);
  assert.match(dailyRoomPoolDecisionLog, /room_pool_recommended = true/);
  assert.match(dailyRoomPoolDecisionLog, /evaluate_daily_room_pool_room_create_is_bottleneck/);
  assert.match(runbook, /docs\/video-date-daily-room-pool-decision-log\.md/);
});

test("Phase 8 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase8CertificationContracts\.test\.ts/);
});
