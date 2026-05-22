import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DATE_PHASE8_PR_SLICES,
  VIDEO_DATE_PHASE8_ROLLOUT_STEPS,
  evaluateVideoDatePhase8Rollout,
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
const twoUserHarness = readFileSync(join(root, "e2e/video-date-two-user.staging.spec.ts"), "utf8");
const runtimeRlsTest = readFileSync(join(root, "shared/matching/videoDateRealtimeRlsRuntime.test.ts"), "utf8");
const runbook = readFileSync(join(root, "docs/video-date-v4-phase8-certification-rollout.md"), "utf8");
const legacyChecklist = readFileSync(join(root, "docs/video-date-v4-legacy-cleanup-checklist.md"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

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
  queueFairnessStatus: "healthy",
  coreFlagsEnabled: true,
  coreFlagsKilled: false,
  currentRolloutBps: 0,
  rollout1PctPassed: true,
  rollout10PctPassed: true,
  rollout50PctPassed: true,
  deckDeal100PctBaked: true,
};

test("PR 8.1-8.3 slices are explicit and cover web, native, backend, rollout, and cleanup", () => {
  assert.deepEqual(
    VIDEO_DATE_PHASE8_PR_SLICES.map((slice) => slice.pr),
    ["8.1", "8.2", "8.3"],
  );
  assert.deepEqual(
    VIDEO_DATE_PHASE8_PR_SLICES.flatMap((slice) => slice.requiredRunKinds),
    ["two_user_e2e", "native_smoke", "rls_negative", "chaos", "load", "rollout_step", "legacy_cleanup"],
  );
  assert.deepEqual(
    VIDEO_DATE_PHASE8_ROLLOUT_STEPS.map((step) => step.targetRolloutBps),
    [100, 1000, 5000, 10000],
  );
  assert.equal(VIDEO_DATE_PHASE8_ROLLOUT_STEPS.at(-1)?.requiresDeckBake, true);
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
    firstFrameSampleCount: 10,
    firstFrameP95Ms: 6100,
    queueFairnessStatus: "critical",
    deckDeal100PctBaked: false,
  });
  assert.equal(blocked[0].allowed, false);
  assert.ok(blocked[0].blockers.includes("queue_fairness_critical"));
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
  assert.doesNotMatch(migration, /vs\.created_at/);
  assert.doesNotMatch(migration, /DAILY_API_KEY|createMeetingToken|meeting_token|daily_token|Bearer/i);
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
  assert.match(runbook, /run_kind='rls_negative'/);
  assert.match(runbook, /run_kind='chaos'/);
  assert.match(runbook, /run_kind='load'/);
  assert.match(runbook, /Broadcast loss/);
  assert.match(runbook, /Daily webhook loss/);
  assert.match(runbook, /worker crash\/retry/);
  assert.match(runbook, /queue drain, deadline finalizer, outbox drainer, snapshot fetch, and Daily token paths/);
});

test("Phase 8 validation and legacy cleanup docs are wired to the rollout gate", () => {
  assert.match(validationSql, /phase8_certification_ledger_exists/);
  assert.match(validationSql, /COUNT\(\*\) = 4 AS ok/);
  assert.match(validationSql, /vw_video_date_phase8_rollout_step_latest/);
  assert.match(validationSql, /phase8_no_next_rollout_blockers/);
  assert.match(validationSql, /current_rollout_bps < 1000 THEN 1000/);
  assert.match(validationSql, /phase8_legacy_deck_cleanup_ready/);
  assert.match(runbook, /1% -> 10% -> 50% -> 100%/);
  assert.match(runbook, /get_video_date_phase8_rollout_readiness/);
  assert.match(runbook, /vw_video_date_legacy_deck_cleanup_readiness/);
  assert.match(legacyChecklist, /vw_video_date_legacy_deck_cleanup_readiness/);
});

test("Phase 8 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase8CertificationContracts\.test\.ts/);
});
