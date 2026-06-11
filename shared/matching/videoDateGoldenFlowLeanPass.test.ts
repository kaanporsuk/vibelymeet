import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Golden-flow lean pass (2026-06-11): the successful 2026-06-10 run showed
// three redundant client traffic patterns on the launch path — ~30 single
// launch-latency checkpoint RPCs, a 12-call feature-flag detail burst on
// /date mount, and ~15 duplicate partner-profile fetches. These contracts pin
// the lean shape so the redundancy does not silently return.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const checkpointModule = read(
  "shared/observability/videoDateLaunchLatencyCheckpointObservability.ts",
);
const batchMigration = read(
  "supabase/migrations/20260610235546_video_date_launch_latency_batch_checkpoints.sql",
);
const batchedFlagFetcher = read("shared/featureFlags/batchedFlagDetailFetcher.ts");
const webFlagWrapper = read("src/lib/clientFeatureFlags.ts");
const nativeFlagWrapper = read("apps/mobile/lib/clientFeatureFlags.ts");
const partnerProfileHelper = read("src/lib/videoDatePartnerProfile.ts");
const nativePartnerProfileHelper = read("apps/mobile/lib/videoDatePartnerProfile.ts");
const nativeVideoDateProfileCallers = [
  "apps/mobile/lib/useActiveSession.ts",
  "apps/mobile/lib/videoDateApi.ts",
  "apps/mobile/lib/readyGateSharedVibes.ts",
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/components/video-date/PostDateSurvey.tsx",
].map((path) => [path, read(path)] as const);
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webVideoDatePage = read("src/pages/VideoDate.tsx");

test("launch latency checkpoints are buffered and flushed through the batch RPC", () => {
  assert.match(checkpointModule, /record_video_date_launch_latency_checkpoints_v1/);
  assert.match(checkpointModule, /CHECKPOINT_FLUSH_DELAY_MS = 1_500/);
  assert.match(checkpointModule, /CHECKPOINT_FLUSH_MAX_BUFFER = 10/);
  // Failure forensics and the golden success milestone must not wait for the
  // buffer window.
  assert.match(checkpointModule, /checkpoint\.endsWith\("_failure"\) \|\| checkpoint === "first_remote_frame"/);
  // A failed batch flush must degrade to the original single-checkpoint RPC,
  // never drop silently.
  assert.match(
    checkpointModule,
    /await buffer\.client\.rpc\("record_video_date_launch_latency_checkpoint"/,
  );
});

test("batch checkpoint RPC delegates each item to the existing fail-soft single shell", () => {
  assert.match(
    batchMigration,
    /CREATE OR REPLACE FUNCTION public\.record_video_date_launch_latency_checkpoints_v1/,
  );
  assert.match(batchMigration, /public\.record_video_date_launch_latency_checkpoint\(/);
  assert.match(batchMigration, /LIMIT 40/);
  assert.match(
    batchMigration,
    /REVOKE ALL ON FUNCTION public\.record_video_date_launch_latency_checkpoints_v1\(uuid, jsonb\) FROM PUBLIC, anon/,
  );
  assert.match(
    batchMigration,
    /GRANT EXECUTE ON FUNCTION public\.record_video_date_launch_latency_checkpoints_v1\(uuid, jsonb\) TO authenticated, service_role/,
  );
});

test("concurrent flag cache misses coalesce into one batch evaluation on web and native", () => {
  assert.match(batchedFlagFetcher, /createBatchedFlagDetailFetcher/);
  // Batch failure must fall back to the original per-flag detail fetch so
  // flag behavior never depends on the batch RPC.
  assert.match(batchedFlagFetcher, /fetchDetail\(flag, userId\)\.catch/);
  for (const [label, source] of [
    ["web", webFlagWrapper],
    ["native", nativeFlagWrapper],
  ] as const) {
    assert.match(source, /createBatchedFlagDetailFetcher/, `${label} wrapper should batch detail fetches`);
    assert.match(source, /fetchDetail: fetchFlagDetailBatched/, `${label} single-flag path should use the batched fetcher`);
  }
});

test("video-date partner profile is fetched through the memoized helper only", () => {
  assert.match(partnerProfileHelper, /get_profile_for_viewer/);
  assert.match(partnerProfileHelper, /PARTNER_PROFILE_TTL_MS = 5 \* 60_000/);
  assert.match(partnerProfileHelper, /inFlight/);

  for (const [label, source] of [
    ["useReadyGate", webReadyGateHook],
    ["ReadyGateOverlay", webReadyGateOverlay],
    ["VideoDate", webVideoDatePage],
  ] as const) {
    assert.match(source, /fetchVideoDatePartnerProfile/, `${label} should use the memoized helper`);
    assert.doesNotMatch(
      source,
      /rpc\(\s*"get_profile_for_viewer"/,
      `${label} must not call get_profile_for_viewer directly`,
    );
  }
});

test("native video-date partner profile parity uses the memoized helper only", () => {
  assert.match(nativePartnerProfileHelper, /get_profile_for_viewer/);
  assert.match(nativePartnerProfileHelper, /PARTNER_PROFILE_TTL_MS = 5 \* 60_000/);
  for (const [path, source] of nativeVideoDateProfileCallers) {
    assert.match(source, /fetchVideoDatePartnerProfile/, `${path} should use the memoized helper`);
    assert.doesNotMatch(
      source,
      /rpc\('get_profile_for_viewer'/,
      `${path} must not call get_profile_for_viewer directly`,
    );
  }
});

test("date-path session row reads go through the single-owner coalescing reader", () => {
  const reader = read("src/lib/videoDateSessionRow.ts");
  assert.match(reader, /VIDEO_DATE_SESSION_ROW_COLUMNS/);
  assert.match(reader, /SESSION_ROW_REUSE_MS = 300/);
  for (const path of [
    "src/components/session/SessionRouteHydration.tsx",
    "src/components/video-date/IceBreakerCard.tsx",
    "src/hooks/useVideoCall.ts",
    "src/pages/VideoDate.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /fetchVideoDateSessionRow/, `${path} should use the canonical session-row reader`);
  }
  // The wired mount-path surfaces must not regrow bespoke by-id select shapes
  // (VideoDate.tsx keeps non-mount writes/reads; the guard is on the two
  // single-owner components).
  for (const path of [
    "src/components/session/SessionRouteHydration.tsx",
    "src/components/video-date/IceBreakerCard.tsx",
  ]) {
    assert.doesNotMatch(read(path), /from\("video_sessions"\)/, `${path} must not query video_sessions directly`);
  }
});

test("start-snapshot pollers share in-flight requests on web and native", () => {
  for (const path of ["src/lib/videoDateStartSnapshot.ts", "apps/mobile/lib/videoDateStartSnapshot.ts"]) {
    const source = read(path);
    assert.match(source, /SNAPSHOT_REUSE_MS = 300/, `${path} should micro-memo ok snapshots`);
    assert.match(source, /snapshotInFlight/, `${path} should share in-flight requests`);
  }
});
