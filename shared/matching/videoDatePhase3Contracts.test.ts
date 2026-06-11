import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260521223000_video_date_phase3_transition_rpcs.sql"),
  "utf8",
);
const forfeitReasonMigration = readFileSync(
  join(root, "supabase/migrations/20260522010000_video_date_phase3_forfeit_preserve_transition_reason.sql"),
  "utf8",
);
const transitionCommands = readFileSync(
  join(root, "shared/matching/videoDateTransitionCommands.ts"),
  "utf8",
);
const webReadyGate = readFileSync(join(root, "src/hooks/useReadyGate.ts"), "utf8");
const webDashboard = readFileSync(join(root, "src/pages/Dashboard.tsx"), "utf8");
const nativeReadyGate = readFileSync(join(root, "apps/mobile/lib/readyGateApi.ts"), "utf8");
const nativeDashboard = readFileSync(join(root, "apps/mobile/app/(tabs)/index.tsx"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const nativeVideoDateScreen = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?COMMENT ON FUNCTION public\\.${name}`,
    ),
  );
  assert.ok(match, `missing ${name} function block`);
  return match[0];
}

function declarationNames(block: string): string[] {
  const declareMatch = block.match(/\bDECLARE\b([\s\S]+?)\bBEGIN\b/);
  assert.ok(declareMatch, "missing DECLARE block");
  return declareMatch[1]
    .split("\n")
    .map((line) => line.match(/^\s+([a-z][a-z0-9_]*)\s+/)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
}

test("PR 3.1-3.3 transition RPCs wrap legacy state machines with v4 command idempotency", () => {
  for (const fn of [
    "video_session_mark_ready_v2",
    "video_session_forfeit_v2",
    "video_session_continue_handshake_v2",
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`COMMENT ON FUNCTION public\\.${fn}`));
  }

  assert.match(migration, /public\.video_session_command_begin_v2\(/);
  assert.match(migration, /public\.video_session_command_finish_v2\(/);
  assert.match(migration, /IF NOT COALESCE\(\(v_begin->>'ok'\)::boolean, false\) THEN/);
  assert.match(migration, /'status' IN \('replay', 'replay_rejected'\)/);
  assert.match(migration, /'error', 'command_in_progress'/);
  assert.match(migration, /'requestHash', v_begin->>'requestHash'/);
  assert.match(migration, /'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END/);
  assert.match(migration, /IF v_begin->>'status' IN \('replay', 'replay_rejected'\) THEN[\s\S]+FROM public\.video_sessions[\s\S]+WHERE id = p_session_id/);
  assert.match(migration, /'ready_gate_status', v_status/);
  assert.match(migration, /'state', COALESCE\(v_after\.state::text/);

  assert.match(migration, /public\.ready_gate_transition\(p_session_id, 'mark_ready', NULL\)/);
  assert.match(migration, /public\.ready_gate_transition\(p_session_id, 'forfeit', v_reason\)/);
  assert.match(migration, /public\.video_date_transition\(p_session_id, 'vibe', NULL\)/);
  assert.doesNotMatch(migration, /public\.video_date_transition\(p_session_id, 'vibe', 'continue_handshake_v2'\)/);

  const forfeit = functionBody("video_session_forfeit_v2");
  assert.match(forfeit, /v_result_reason text/);
  assert.match(forfeit, /NULLIF\(v_transition->>'reason', ''\)/);
  assert.match(forfeit, /NULLIF\(v_transition->>'error', ''\)/);
  assert.match(forfeit, /'reason', v_result_reason/);
  assert.doesNotMatch(forfeit, /'reason', v_reason,[\s\S]+session_seq/);
  assert.match(forfeitReasonMigration, /CREATE OR REPLACE FUNCTION public\.video_session_forfeit_v2/);
  assert.match(forfeitReasonMigration, /v_result_reason text/);
  assert.match(forfeitReasonMigration, /NULLIF\(v_transition->>'reason', ''\)/);
  assert.match(forfeitReasonMigration, /'reason', v_result_reason/);
});

test("Phase 3 SQL function blocks have one clean signature and declaration set each", () => {
  for (const fn of [
    "video_session_mark_ready_v2",
    "video_session_forfeit_v2",
    "video_session_continue_handshake_v2",
  ]) {
    const block = functionBody(fn);
    assert.equal(block.match(/RETURNS jsonb/g)?.length, 1, `${fn} must declare RETURNS once`);
    assert.equal(block.match(/\bDECLARE\b/g)?.length, 1, `${fn} must declare variables once`);
    assert.equal(block.match(/\bv_event jsonb := '\{\}'::jsonb;/g)?.length, 1, `${fn} must declare v_event once`);
    const names = declarationNames(block);
    assert.deepEqual(
      names.filter((name, index) => names.indexOf(name) !== index),
      [],
      `${fn} must not duplicate DECLARE variables`,
    );
    assert.doesNotMatch(block, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
  }
});

test("Phase 3 events are visibility-safe, sequence-aware, and token-free", () => {
  assert.match(migration, /public\.append_video_session_event_v2\(/);
  assert.match(migration, /'ready_gate_mark_ready'/);
  assert.match(migration, /'ready_gate_both_ready'/);
  assert.match(migration, /'ready_gate_forfeited'/);
  assert.match(migration, /'handshake_continue_recorded'/);
  assert.match(migration, /'handshake_continued_to_date'/);
  assert.match(migration, /'participants'/);
  assert.match(migration, /'actor_only'/);
  assert.match(migration, /ELSIF v_actor_decision_changed THEN[\s\S]+'actor_only'/);
  assert.match(migration, /v_advanced_to_date[\s\S]+'participants'/);
  assert.match(migration, /'ready_gate_both_ready'[\s\S]+true,\s+gen_random_uuid\(\)/);
  assert.match(migration, /'handshake_continue_recorded'[\s\S]+false,\s+gen_random_uuid\(\)/);

  assert.match(migration, /public\.video_date_outbox_enqueue_v2\(/);
  assert.match(migration, /'daily\.ensure_video_date_room'/);
  assert.match(migration, /'daily\.delete_video_date_room'/);
  assert.match(migration, /'date-' \|\| replace\(p_session_id::text, '-', ''\)/);
  assert.match(migration, /'phase3:ensure_room:' \|\| p_session_id::text/);
  assert.match(migration, /'phase3:delete_room:' \|\| p_session_id::text/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);

  assert.match(migration, /v_reason NOT IN \('ready_gate_forfeit', 'not_now', 'timeout', 'skip', 'user_exit', 'manual_exit'\)/);
  assert.match(migration, /v_reason := 'ready_gate_forfeit'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]+FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]+TO authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.video_session_forfeit_v2\(uuid, text, text, text\)[\s\S]+FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_session_forfeit_v2\(uuid, text, text, text\)[\s\S]+TO authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.video_session_continue_handshake_v2\(uuid, text, text\)[\s\S]+FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_session_continue_handshake_v2\(uuid, text, text\)[\s\S]+TO authenticated, service_role/);
});

test("web and native route Phase 3 transitions behind the same default-off flags", () => {
  assert.match(transitionCommands, /VideoDatePhase3TransitionAction = "mark_ready" \| "forfeit" \| "continue_entry"/);
  assert.match(transitionCommands, /VideoDatePhase3DeadlineAction = "entry_auto_promote" \| "date_timeout"/);
  assert.match(transitionCommands, /buildVideoDateSignalIdempotencyKey\(sessionId, `phase3:\$\{action\}`\)/);
  assert.match(migration, /p_session_id::text \|\| ':phase3:mark_ready'/);
  assert.match(migration, /p_session_id::text \|\| ':phase3:forfeit'/);
  assert.match(migration, /p_session_id::text \|\| ':phase3:continue_handshake'/);
  assert.doesNotMatch(migration, /'phase3:' \|\| p_session_id::text \|\| ':(?:mark_ready|forfeit|continue_handshake)'/);

  for (const source of [webReadyGate, nativeReadyGate]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.outbox_v2\.mark_ready["']\)/);
    assert.match(source, /useFeatureFlag\(["']video_date\.outbox_v2\.forfeit["']\)/);
    assert.match(source, /video_session_mark_ready_v2/);
    assert.match(source, /video_session_forfeit_v2/);
    assert.match(source, /buildVideoDateTransitionIdempotencyKey\(sessionId, ["']mark_ready["']\)/);
    assert.match(source, /buildVideoDateTransitionIdempotencyKey\(sessionId, ["']forfeit["']\)/);
    assert.match(source, /ready_gate_transition/);
  }

  for (const source of [webDashboard, nativeDashboard]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.outbox_v2\.forfeit["']\)/);
    assert.match(source, /video_session_forfeit_v2/);
    assert.match(source, /p_reason:\s*["']ready_gate_forfeit["']/);
    assert.match(source, /buildVideoDateTransitionIdempotencyKey\(activeSession\.sessionId, ["']forfeit["']\)/);
    assert.match(source, /ready_gate_transition/);
    assert.match(source, /p_reason:\s*["']dashboard_active_banner["']/);
  }

  assert.match(
    webVideoDate,
    /useFeatureFlag\(\s*["']video_date\.outbox_v2\.continue_entry["'],?\s*\)/,
  );
  assert.match(webVideoDate, /video_session_continue_entry_v2/);
  assert.match(webVideoDate, /buildVideoDateTransitionIdempotencyKey\([\s\S]+args\.p_session_id[\s\S]+["']continue_entry["']/);
  assert.match(webVideoDate, /supabase\.rpc\("video_date_transition", args\)/);

  assert.match(nativeVideoDateApi, /continueEntryV2\?: boolean/);
  assert.match(nativeVideoDateApi, /video_session_continue_entry_v2/);
  assert.match(nativeVideoDateApi, /buildVideoDateTransitionIdempotencyKey\([\s\S]+args\.p_session_id[\s\S]+['"]continue_entry['"]/);
  assert.match(nativeVideoDateApi, /supabase\.rpc\('video_date_transition', args\)/);
  assert.match(
    nativeVideoDateScreen,
    /useFeatureFlag\(\s*["']video_date\.outbox_v2\.continue_entry["'],?\s*\)/,
  );
  assert.match(nativeVideoDateScreen, /continueEntryV2: continueEntryV2\.enabled/);
});

test("Phase 3 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase3Contracts\.test\.ts/);
});
