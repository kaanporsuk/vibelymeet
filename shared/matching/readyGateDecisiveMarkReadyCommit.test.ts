import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql",
);
const lintCleanupMigration = read(
  "supabase/migrations/20260606100511_video_date_mark_ready_lint_cleanup.sql",
);
const webReadyGate = read("src/hooks/useReadyGate.ts");
const nativeReadyGate = read("apps/mobile/lib/readyGateApi.ts");
const packageJson = read("package.json");

test("decisive mark-ready migration replaces the wrapper chain with one direct hot path", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2/);
  assert.doesNotMatch(migration, /ALTER FUNCTION public\.video_session_mark_ready_v2/);
  assert.doesNotMatch(migration, /RETURN public\.video_session_mark_ready_v2_202606/);
  assert.doesNotMatch(migration, /video_session_mark_ready_v2_202606\d+_[a-z0-9_]+_base/);
  assert.doesNotMatch(migration, /event_active_preflight_failed/);

  const commandBeginIndex = migration.indexOf("v_begin := public.video_session_command_begin_v2");
  const rowLockIndex = migration.indexOf("FOR UPDATE;");
  assert.ok(commandBeginIndex > 0, "command begin must be present");
  assert.ok(rowLockIndex > commandBeginIndex, "session row lock must happen after command begin");
});

test("decisive mark-ready commits readiness before observability and provider work", () => {
  const readyUpdateIndex = migration.indexOf("ready_participant_1_at = v_new_p1_ready_at");
  const commandFinishIndex = migration.indexOf(
    "public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result)",
    readyUpdateIndex,
  );
  const observabilityIndex = migration.indexOf("public.record_event_loop_observability(", commandFinishIndex);
  const eventAppendIndex = migration.indexOf("public.append_video_session_event_v2(", commandFinishIndex);
  const outboxIndex = migration.indexOf("public.video_date_outbox_enqueue_v2(", commandFinishIndex);

  assert.ok(readyUpdateIndex > 0, "ready timestamp update must exist");
  assert.ok(commandFinishIndex > readyUpdateIndex, "command finish should happen after the ready write");
  assert.ok(observabilityIndex > commandFinishIndex, "observability must be post-commit auxiliary work");
  assert.ok(eventAppendIndex > commandFinishIndex, "event append must be post-commit auxiliary work");
  assert.ok(outboxIndex > commandFinishIndex, "Daily room outbox must be post-commit auxiliary work");

  assert.match(migration, /v_expires_at := GREATEST\([\s\S]*v_now \+ interval '45 seconds'/);
  assert.match(migration, /WHEN v_new_status = 'both_ready' THEN v_expected_room_name/);
  assert.match(migration, /WHEN v_new_status = 'both_ready' THEN v_url/);
  assert.match(migration, /'decisive_mark_ready_commit', true/);
});

test("decisive mark-ready preserves deployed client idempotency and retry recovery", () => {
  assert.match(migration, /v_command_status = 'replay_rejected'/);
  assert.match(migration, /v_replay_retryable AND NOT v_replay_terminal/);
  assert.match(migration, /status = 'processing'[\s\S]*committed_at = NULL[\s\S]*result_payload = NULL/);
  assert.match(migration, /v_command_status = 'in_progress'/);
  assert.match(migration, /v_command_created_at < v_now - interval '6 seconds'/);
  assert.match(migration, /'reclaimed_processing_command', v_reclaimed_processing_command/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*TO authenticated, service_role/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("lint cleanup preserves the decisive function while removing the unused event variable", () => {
  assert.match(lintCleanupMigration, /pg_get_functiondef\('public\.video_session_mark_ready_v2\(uuid,text,text\)'::regprocedure\)/);
  assert.match(lintCleanupMigration, /Expected v_event declaration was not found/);
  assert.match(lintCleanupMigration, /v_event jsonb := ''\{\}''::jsonb/);
  assert.match(lintCleanupMigration, /PERFORM public\.append_video_session_event_v2\(/);
  assert.match(lintCleanupMigration, /position\('v_event' in v_def\) > 0/);
  assert.match(lintCleanupMigration, /GRANT EXECUTE ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*TO authenticated, service_role/);
});

test("web and native retry mark-ready RPC errors with the deterministic idempotency key", () => {
  for (const [label, source] of [
    ["web", webReadyGate],
    ["native", nativeReadyGate],
  ] as const) {
    assert.match(source, /const retryRpcError = Boolean\(transitionResult\.error\)/, `${label} should detect RPC errors`);
    assert.match(source, /if \(!retryRpcError && !retryPayload\) break/, `${label} should keep bounded retry exits`);
    assert.match(source, /retryPayload[\s\S]*readReadyGateMarkReadyRetryDelayMs\(transitionResult\.data, fallbackDelayMs\)[\s\S]*fallbackDelayMs/, `${label} should use backend delay only for payload retries`);
    assert.doesNotMatch(source, /if \(action === ['"]mark_ready['"] && !transitionResult\.error\)/, `${label} must not skip RPC-error retries`);
    assert.doesNotMatch(source, /if \(transitionResult\.error\) break/, `${label} must not stop after the first retry RPC error`);
    assert.match(source, /buildVideoDateTransitionIdempotencyKey\(sessionId, ['"]mark_ready['"]\)/, `${label} should keep deterministic mark-ready idempotency`);
  }
});

test("decisive mark-ready contract is part of the Video Date v4 suite", () => {
  assert.match(packageJson, /shared\/matching\/readyGateDecisiveMarkReadyCommit\.test\.ts/);
});
