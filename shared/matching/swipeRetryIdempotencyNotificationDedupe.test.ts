import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const stream8Migration = read("supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql");
const mutualSessionBase = read("supabase/migrations/20260501092000_handle_swipe_presence_and_already_matched_session.sql");
const mutualMatchHandoffClosure = read("supabase/migrations/20260607103000_video_date_mutual_match_handoff_closure.sql");
const autoNextRemoval = read("supabase/migrations/20260610000100_remove_post_date_instant_next.sql");
const sessionSourceRemoval = read("supabase/migrations/20260609171950_remove_video_sessions_session_source.sql");
const validation = read("supabase/validation/swipe_retry_idempotency_notification_dedupe.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");
const webSwipeHook = read("src/hooks/useSwipeAction.ts");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("Stream 8 migration exists and sorts after active-event canonicalization", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501210000"));
  assert.ok(versions.includes("20260501223000"));
  assert.ok(versions.includes("20260501224000"));
  assert.ok(versions.indexOf("20260501224000") > versions.indexOf("20260501223000"));
});

test("duplicate existing-swipe detection runs before delegated side effects", () => {
  const existingSwipeIndex = stream8Migration.indexOf("FROM public.event_swipes es");
  const delegateIndex = stream8Migration.lastIndexOf("public.handle_swipe_20260501210000_idempotency_base");
  assert.ok(existingSwipeIndex > 0);
  assert.ok(delegateIndex > existingSwipeIndex);
  assert.match(stream8Migration, /handle_swipe_idempotency:/);
  assert.match(stream8Migration, /v_existing_swipe_type IS DISTINCT FROM p_swipe_type/);
});

test("same-type duplicate pass, vibe, and super-vibe return already_swiped without notification side effects", () => {
  assert.match(stream8Migration, /'outcome', 'already_swiped'[\s\S]*'result', 'already_swiped'/);
  assert.match(stream8Migration, /'duplicate', true/);
  assert.match(stream8Migration, /'idempotent', true/);
  assert.match(stream8Migration, /'replay', true/);
  assert.match(stream8Migration, /'notification_suppressed', true/);
  assert.match(stream8Migration, /'dedupe_reason', 'existing_swipe'/);
});

test("first-time direct mutual outcomes still come from the canonical mutation base", () => {
  assert.match(stream8Migration, /RETURN public\.handle_swipe_20260501210000_idempotency_base\(/);
  assert.match(mutualSessionBase, /'result', 'pass_recorded'/);
  assert.match(mutualSessionBase, /'result', 'vibe_recorded'/);
  assert.match(mutualSessionBase, /'result', 'super_vibe_sent'/);
  assert.match(mutualSessionBase, /'result', 'match'/);
  assert.match(mutualSessionBase, /'result', 'already_matched'/);
  assert.match(mutualSessionBase, /'result', 'participant_has_active_session_conflict'/);
});

test("queued match side-effect paths are removed from current swipe actions", () => {
  assert.match(swipeActions, /result\.result === "match" && sessionId/);
  assert.match(swipeActions, /result\.result === "super_vibe_sent"/);
  assert.match(swipeActions, /result\.result === "vibe_recorded"/);
  assert.doesNotMatch(swipeActions, /queuedMatchNotificationData/);
  assert.doesNotMatch(swipeActions, /result\.result === "match_queued" && sessionId/);
  assert.doesNotMatch(swipeActions, /open_event_lobby[\s\S]{0,500}ready_gate_status: "queued"/);
});

test("queued SQL outcomes are converted to recorded swipes by the latest wrapper", () => {
  assert.match(autoNextRemoval, /v_outcome IS DISTINCT FROM 'match_queued'[\s\S]*RETURN v_result/);
  assert.match(autoNextRemoval, /ready_gate_status = 'expired'/);
  assert.match(autoNextRemoval, /queued_auto_promotion_removed/);
  assert.match(autoNextRemoval, /WHEN p_swipe_type = 'super_vibe' THEN 'super_vibe_sent'/);
  assert.match(autoNextRemoval, /ELSE 'vibe_recorded'/);
});

test("Super Vibe consumption remains while the session-source discriminator is removed", () => {
  assert.match(mutualMatchHandoffClosure, /'super_vibe_consumed', true/);
  assert.match(sessionSourceRemoval, /DROP COLUMN IF EXISTS session_source/);
  assert.match(videoSessionFlow, /super_vibe_consumed\?: boolean/);
  assert.doesNotMatch(videoSessionFlow, /session_source\?: string/);
  assert.match(nativeLobby, /normalizedEnvelope\.super_vibe_consumed === true/);
});

test("shared and client swipe contracts tolerate already_swiped without deck advancement or noisy toasts", () => {
  for (const field of ["outcome", "duplicate", "idempotent", "replay", "notification_suppressed", "dedupe_reason"]) {
    assert.match(videoSessionFlow, new RegExp(`${field}\\??:`));
  }
  assert.match(videoSessionFlow, /"already_swiped"/);
  assert.match(videoSessionFlow, /"swipe_already_recorded"/);
  assert.match(webSwipeHook, /case "already_swiped"/);
  assert.match(nativeLobby, /case ["']already_swiped["']/);
  assert.doesNotMatch(videoSessionFlow, /shouldTrackQueuedSwipeSession|DrainMatchQueueResult/);
});

test("production validation is read-only catalog verification", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /has_function_privilege/);
  assert.match(validation, /renamed_base_functions_are_not_client_executable/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create)\b/i);
});
