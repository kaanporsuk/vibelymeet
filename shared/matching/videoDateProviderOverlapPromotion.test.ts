import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260607194546_video_date_definitive_provider_overlap_promotion.sql",
);
const snapshotFunction = read("supabase/functions/video-date-snapshot/index.ts");
const packageJson = read("package.json");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
  return source.slice(start, end);
}

test("stable copresence accepts provider-backed overlap despite small join/heartbeat skew", () => {
  const stable = functionBody(migration, "video_date_stable_copresence_v1");

  assert.match(stable, /v_skew_grace interval := interval '2 seconds'/);
  assert.match(stable, /v_freshness_grace interval := interval '25 seconds'/);
  assert.match(stable, /v_heartbeat_floor_at := v_latest_joined_at - v_skew_grace/);
  assert.match(stable, /vpe\.occurred_at >= v_heartbeat_floor_at/);
  assert.match(stable, /one_remote_seen_provider_current/);
  assert.match(stable, /stable_provider_owner_heartbeat_overlap/);
  assert.match(stable, /heartbeat_floor_at/);
});

test("provider overlap promoter is the shared date-start authority for hot path RPCs", () => {
  const promoter = functionBody(migration, "video_date_promote_provider_overlap_v1");
  const alive = functionBody(migration, "mark_video_date_daily_alive");
  const joined = functionBody(migration, "mark_video_date_daily_joined");
  const remoteSeen = functionBody(migration, "mark_video_date_remote_seen");
  const autoPromote = functionBody(migration, "video_session_handshake_auto_promote_v2");

  assert.match(promoter, /public\.video_date_stable_copresence_v1\(p_session_id\)/);
  assert.match(promoter, /state = 'date'::public\.video_date_state/);
  assert.match(promoter, /date_started_at = v_date_started_at/);
  assert.match(promoter, /queue_status = 'in_date'/);
  assert.match(promoter, /provider_overlap_promoted_to_date/);
  assert.match(promoter, /public\.append_video_session_event_v2/);

  for (const [label, body] of [
    ["daily alive", alive],
    ["daily joined", joined],
    ["remote seen", remoteSeen],
    ["auto promote", autoPromote],
  ] as const) {
    assert.match(
      body,
      /public\.video_date_promote_provider_overlap_v1/,
      `${label} should invoke the shared provider-overlap promoter`,
    );
  }
});

test("server-started provider-backed dates count as confirmed encounters for survey continuity", () => {
  const confirmed = functionBody(migration, "video_date_session_has_confirmed_encounter");

  assert.match(confirmed, /p_participant_1_remote_seen_at IS NOT NULL/);
  assert.match(confirmed, /p_participant_2_remote_seen_at IS NOT NULL/);
  assert.match(confirmed, /p_date_started_at IS NOT NULL/);
  assert.match(confirmed, /p_participant_1_joined_at IS NOT NULL/);
  assert.match(confirmed, /p_participant_2_joined_at IS NOT NULL/);
  assert.match(confirmed, /COALESCE\(p_state, ''\) IN \('date', 'ended'\)/);
  assert.match(confirmed, /COALESCE\(p_phase, ''\) IN \('date', 'ended', 'verdict'\)/);
});

test("startup snapshot keeps both_ready routeable instead of terminal", () => {
  const snapshot = functionBody(migration, "get_video_date_start_snapshot_v1");
  const terminalAssignment = snapshot.match(/v_terminal :=[\s\S]*?;/);

  assert.ok(terminalAssignment, "terminal assignment should exist");
  assert.doesNotMatch(
    terminalAssignment[0],
    /both_ready/,
    "both_ready must not be terminal startup truth",
  );
  assert.match(snapshot, /v_ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(snapshot, /'can_enter_date', v_can_enter_date/);
});

test("video-date snapshot returns a retryable tokenless snapshot on token/provider failure", () => {
  assert.match(snapshotFunction, /function retryableSnapshotWithoutToken/);
  assert.match(snapshotFunction, /tokenRetryable: true/);
  assert.match(snapshotFunction, /token_error: error/);
  assert.match(snapshotFunction, /tokenError: error/);
  assert.match(snapshotFunction, /if \(status !== 429\) status = 200/);
  assert.match(snapshotFunction, /jsonResponse\(corsHeaders, fallback, status, retryAfterSeconds\)/);
});

test("provider-overlap contracts are part of the v4 suite", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateProviderOverlapPromotion\.test\.ts/,
  );
});
