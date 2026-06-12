import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const followupMigration = read("supabase/migrations/20260603205319_review_comments_1174_1179_followups.sql");
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeVideoDate = readNativeVideoDateScreenFlowSource();
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const packageJson = read("package.json");

test("Ready Gate sync uses startup snapshots only for active unexpired gates", () => {
  assert.match(followupMigration, /CREATE OR REPLACE FUNCTION public\.ready_gate_transition\(/);
  assert.match(followupMigration, /public\.get_video_date_start_snapshot_v1\(p_session_id\)/);
  assert.match(followupMigration, /v_snapshot->>'inactive_reason'/);
  assert.match(followupMigration, /public\.ready_gate_transition_20260603150106_start_snapshot_base\(/);
  assert.ok(
    followupMigration.indexOf("public.get_video_date_start_snapshot_v1(p_session_id)") <
      followupMigration.indexOf("public.ready_gate_transition_20260603150106_start_snapshot_base("),
    "active sync should attempt the participant-safe startup snapshot before delegating terminal paths",
  );
});

test("queued vibe drain preserves warning readiness for Ready Gate recovery", () => {
  assert.match(followupMigration, /CREATE OR REPLACE FUNCTION public\.normalize_event_runtime_readiness_for_pairing\(\)/);
  assert.match(followupMigration, /IF NEW\.readiness_status = 'warning' THEN/);
  assert.match(followupMigration, /'server_preserved_readiness_status', 'warning'/);
  assert.match(followupMigration, /readiness_status = 'warning'[\s\S]+client_reported_readiness_status/);
  assert.doesNotMatch(followupMigration, /NEW\.readiness_status := 'unchecked'/);
});

test("reconnect-grace cron keeps survey eligibility aligned with remote-seen truth", () => {
  assert.match(followupMigration, /CREATE OR REPLACE FUNCTION public\.expire_video_date_reconnect_graces\(\)/);
  assert.match(followupMigration, /public\.video_date_session_is_post_date_survey_eligible_v2\(/);
  assert.match(followupMigration, /queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END/);
  assert.match(followupMigration, /current_room_id = CASE WHEN v_should_open_survey THEN r\.id ELSE NULL END/);
  assert.match(followupMigration, /terminal_confirmed_encounter_survey/);
  assert.match(followupMigration, /terminal_unconfirmed_encounter_no_survey/);
});

test("web Daily singleton reuse requires playable local tracks", () => {
  assert.match(webVideoCall, /function dailyTrackHasLiveMedia/);
  assert.match(webVideoCall, /track\?\.state !== "playable"/);
  assert.match(webVideoCall, /mediaTrack && mediaTrack\.readyState !== "ended"/);
});

test("native peer-missing abort treats truth query errors as terminalization failures", () => {
  assert.match(nativeVideoDateApi, /options\?: \{ throwOnError\?: boolean \}/);
  assert.match(nativeVideoDateApi, /if \(options\?\.throwOnError\)/);
  assert.match(
    nativeVideoDate,
    /fetchVideoSessionDateEntryTruth\(\s*sessionId,\s*\{[\s\S]{0,80}throwOnError: true[\s\S]{0,40}\}/,
  );
  assert.match(
    nativeVideoDate,
    /truthFetchFailed[\s\S]{0,80}\|\|[\s\S]{0,80}shouldTerminalizeNativePeerMissingAbort\(truth\)/,
  );
});

test("review follow-up contracts stay in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/reviewComments1174_1179Followups\.test\.ts/);
});
