import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522015000_video_date_phase7_daily_performance_decision.sql"),
  "utf8",
);
const operatorMetrics = readFileSync(
  join(root, "shared/observability/videoDateOperatorMetrics.ts"),
  "utf8",
);
const launchObservability = readFileSync(
  join(root, "shared/observability/videoDateLaunchLatencyCheckpointObservability.ts"),
  "utf8",
);
const webPrepareEntry = readFileSync(join(root, "src/lib/videoDatePrepareEntry.ts"), "utf8");
const nativePrepareEntry = readFileSync(join(root, "apps/mobile/lib/videoDatePrepareEntry.ts"), "utf8");
const sharedPrepareEntry = readFileSync(join(root, "shared/matching/videoDatePrepareEntry.ts"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const adminOps = readFileSync(join(root, "supabase/functions/admin-video-date-ops/index.ts"), "utf8");
const adminLiveMetrics = readFileSync(join(root, "src/components/admin/AdminLiveEventMetrics.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("PR 7.1 stores token-free Daily performance samples and service-role decision views", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_launch_latency_checkpoint/);
  assert.match(migration, /daily_room_create_started/);
  assert.match(migration, /daily_token_mint_success/);
  assert.match(migration, /daily_reconnect_failure/);
  assert.match(migration, /extension_refresh_success/);
  assert.match(migration, /public\.record_vd_launch_latency_202605061020_base/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_daily_performance_samples/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_daily_performance_segment_health/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_daily_pool_decision/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_daily_performance_decision/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.vw_video_date_daily_performance_samples TO service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.vw_video_date_daily_performance_segment_health TO service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.vw_video_date_daily_pool_decision TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_daily_performance_decision\(uuid\)\s+TO service_role/);
  assert.doesNotMatch(migration, /DAILY_API_KEY|createMeetingToken|meeting_token|meeting-token|token\s+(text|jsonb)|room\.token/i);
});

test("Daily pool decision remains a measured P95/P99 gate, not a feature toggle shortcut", () => {
  assert.match(migration, /first_frame_p95_ms/);
  assert.match(migration, /first_frame_p99_ms/);
  assert.ok(
    migration.indexOf("eo.detail->>'both_ready_to_first_remote_frame_ms'") <
      migration.indexOf("eo.detail->>'ready_tap_to_first_remote_frame_ms'"),
    "Phase 7 pool decision must prefer both-ready -> first-frame latency over older ready-tap latency",
  );
  assert.match(migration, /room_p95_ms/);
  assert.match(migration, /room_p99_ms/);
  assert.match(migration, /room_pool_recommended/);
  assert.match(
    migration,
    /eo\.operation = 'create_date_room_provider_error'\s+AND eo\.detail->>'provider_operation' = 'create_token' THEN 'token_mint'/,
  );
  assert.match(
    migration,
    /eo\.reason_code IN \('daily_room_create_success', 'daily_room_create_failure'\) THEN 'room_create_or_verify'/,
  );
  assert.match(
    migration,
    /eo\.reason_code IN \('daily_token_mint_success', 'daily_token_mint_failure'\) THEN 'token_mint'/,
  );
  assert.match(migration, /eo\.detail->>'daily_room_create_ms'/);
  assert.match(migration, /eo\.detail->>'daily_token_mint_ms'/);
  assert.match(migration, /COALESCE\(r\.first_frame_sample_count, 0\) < 20/);
  assert.match(migration, /COALESCE\(r\.room_sample_count, 0\) < 10/);
  assert.match(migration, /evaluate_daily_room_pool_room_create_is_bottleneck/);
  assert.match(migration, /pool_not_recommended_investigate_join_client_or_network_segments/);
});

test("shared telemetry allowlists Phase 7 checkpoints and safe segment payloads", () => {
  for (const checkpoint of [
    "daily_room_create_started",
    "daily_room_create_success",
    "daily_room_create_failure",
    "daily_token_mint_started",
    "daily_token_mint_success",
    "daily_token_mint_failure",
    "daily_reconnect_started",
    "daily_reconnect_success",
    "daily_reconnect_failure",
    "extension_refresh_started",
    "extension_refresh_success",
    "extension_refresh_failure",
  ]) {
    assert.match(operatorMetrics, new RegExp(`\\| "${checkpoint}"`));
    assert.match(launchObservability, new RegExp(`"${checkpoint}"`));
  }

  for (const payloadKey of [
    "daily_performance_segment",
    "daily_room_create_ms",
    "daily_token_mint_ms",
    "daily_reconnect_ms",
    "extension_refresh_ms",
    "extension_mode",
    "credit_type",
    "extension_mutual",
    "extension_awaiting_partner",
    "extension_applied",
    "reconnect_source",
  ]) {
    assert.match(launchObservability, new RegExp(`"${payloadKey}"`));
  }

  assert.match(launchObservability, /checkpoint === "daily_token_mint_success"/);
  assert.match(launchObservability, /payload\.daily_token_mint_ms/);
  assert.match(launchObservability, /checkpoint === "extension_refresh_failure"/);
  assert.match(launchObservability, /payload\.extension_refresh_ms/);
});

test("PR 7.2 web and native emit provider, reconnect, and extension performance checkpoints", () => {
  for (const prepareEntry of [webPrepareEntry, nativePrepareEntry]) {
    assert.match(prepareEntry, /daily_room_create_started/);
    assert.match(prepareEntry, /daily_room_create_success/);
    assert.match(prepareEntry, /daily_token_mint_started/);
    assert.match(prepareEntry, /daily_token_mint_success/);
    assert.match(prepareEntry, /providerOperation === ['"]create_token['"]/);
    assert.match(prepareEntry, /providerOperation === ['"]create_room['"]/);
    assert.match(prepareEntry, /providerOperation === ['"]lookup_room['"]/);
    assert.match(prepareEntry, /room_create_or_verify_ms/);
    assert.match(prepareEntry, /token_ms/);
    assert.match(prepareEntry, /daily_performance_segment: ['"]room_create_or_verify['"]/);
    assert.match(prepareEntry, /daily_performance_segment: ['"]token_mint['"]/);
  }

  assert.match(sharedPrepareEntry, /providerOperation\?: string \| null/);
  assert.match(sharedPrepareEntry, /async function readFailureProviderOperation/);
  assert.match(sharedPrepareEntry, /maybeResponse\.clone/);

  for (const dateSurface of [webVideoDate, nativeVideoDate]) {
    assert.match(dateSurface, /trackDailyPerformanceCheckpoint/);
    assert.match(dateSurface, /daily_reconnect_started/);
    assert.match(dateSurface, /daily_reconnect_success/);
    assert.match(dateSurface, /daily_reconnect_failure/);
    assert.match(dateSurface, /extension_refresh_started/);
    assert.match(dateSurface, /extension_refresh_success/);
    assert.match(dateSurface, /extension_refresh_failure/);
    assert.match(dateSurface, /daily_performance_segment: ['"]daily_reconnect['"]/);
    assert.match(dateSurface, /daily_performance_segment: ['"]extension_refresh['"]/);
  }
});

test("PR 7.3 exposes the Daily room-pool decision in operator tooling", () => {
  assert.match(adminOps, /type DailyPerformanceDecisionRow/);
  assert.match(adminOps, /from\("vw_video_date_daily_pool_decision"\)/);
  assert.match(adminOps, /\.order\("event_id", \{ ascending: true, nullsFirst: true \}\)[\s\S]+\.limit\(1\)/);
  assert.match(adminOps, /daily_performance_decision: dailyPerformanceDecision/);
  assert.match(adminLiveMetrics, /daily_performance_decision:/);
  assert.match(adminLiveMetrics, /label="Daily pool decision"/);
  assert.match(adminLiveMetrics, /room_pool_recommended \? "Evaluate pool" : "No pool"/);
});

test("Phase 7 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase7DailyPerformanceContracts\.test\.ts/);
});
