import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const stream7MigrationPath = "supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql";
const stream8MigrationPath = "supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql";
const stream7Migration = read(stream7MigrationPath);
const stream8Migration = read(stream8MigrationPath);
const mutualSessionBase = read("supabase/migrations/20260501092000_handle_swipe_presence_and_already_matched_session.sql");
const validation = read("supabase/validation/swipe_retry_idempotency_notification_dedupe.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");
const webSwipeHook = read("src/hooks/useSwipeAction.ts");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeActiveSessionRoutes = read("apps/mobile/lib/activeSessionRoutes.ts");

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

test("Stream 8 migration exists and sorts after active-event canonicalization", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501210000"), "Stream 7 retry migration should be present");
  assert.ok(versions.includes("20260501223000"), "canonical active-event migration should be present");
  assert.ok(versions.includes("20260501224000"), "Stream 8 already_swiped migration should be present");
  assert.ok(
    versions.indexOf("20260501224000") > versions.indexOf("20260501223000"),
    "Stream 8 migration must sort after active-event canonicalization",
  );
});

test("handle_swipe signature, SECURITY DEFINER, search path, grants, and active-event guard are preserved", () => {
  assert.match(stream8Migration, /CREATE OR REPLACE FUNCTION public\.handle_swipe\(\s*p_event_id uuid,\s*p_actor_id uuid,\s*p_target_id uuid,\s*p_swipe_type text\s*\) RETURNS jsonb/);
  assert.match(stream8Migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(stream8Migration, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(stream8Migration, /FOR SHARE OF ev/);
  assert.match(stream8Migration, /'result', 'event_not_active'/);
  assert.match(stream8Migration, /GRANT EXECUTE ON FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(stream8Migration, /GRANT EXECUTE ON FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)[\s\S]*TO anon/);
});

test("duplicate existing-swipe detection runs before delegated side effects", () => {
  const existingSwipeIndex = stream8Migration.indexOf("FROM public.event_swipes es");
  const delegateIndex = stream8Migration.lastIndexOf("public.handle_swipe_20260501210000_idempotency_base");
  assert.ok(existingSwipeIndex > 0, "migration should inspect the natural idempotency key");
  assert.ok(delegateIndex > existingSwipeIndex, "delegated mutation path should be after replay guard");
  assert.match(stream8Migration, /handle_swipe_idempotency:/);
  assert.match(stream8Migration, /FOR UPDATE/);
  assert.match(stream8Migration, /v_existing_swipe_type IS DISTINCT FROM p_swipe_type/);
});

test("same-type duplicate pass, vibe, and super-vibe return already_swiped without notification side effects", () => {
  assert.match(stream8Migration, /'success', true,[\s\S]*'outcome', 'already_swiped'[\s\S]*'result', 'already_swiped'/);
  assert.match(stream8Migration, /'duplicate', true/);
  assert.match(stream8Migration, /'idempotent', true/);
  assert.match(stream8Migration, /'replay', true/);
  assert.match(stream8Migration, /'notification_suppressed', true/);
  assert.match(stream8Migration, /'dedupe_reason', 'existing_swipe'/);
  assert.doesNotMatch(stream8Migration, /'result', v_existing_result/);
  assert.doesNotMatch(stream8Migration, /WHEN 'super_vibe' THEN 'super_vibe_sent'/);
  assert.doesNotMatch(stream8Migration, /WHEN 'pass' THEN 'pass_recorded'/);
});

test("duplicate retry after session creation returns already_matched recovery, not a new match notification", () => {
  assert.match(stream8Migration, /'outcome', 'already_matched'[\s\S]*'result', 'already_matched'/);
  assert.match(stream8Migration, /'video_session_id', v_session_id/);
  assert.match(stream8Migration, /'duplicate', true[\s\S]*'notification_suppressed', true[\s\S]*'dedupe_reason', 'existing_match'/);
});

test("different-type duplicate remains an explicit already-recorded conflict", () => {
  assert.match(stream8Migration, /'success', false/);
  assert.match(stream8Migration, /'outcome', 'swipe_already_recorded'/);
  assert.match(stream8Migration, /'result', 'swipe_already_recorded'/);
  assert.match(stream8Migration, /'error', 'swipe_already_recorded'/);
  assert.match(stream8Migration, /'existing_swipe_type', v_existing_swipe_type/);
  assert.match(stream8Migration, /'requested_swipe_type', p_swipe_type/);
  assert.match(stream8Migration, /'duplicate', true/);
  assert.match(stream8Migration, /'dedupe_reason', 'swipe_type_conflict'/);
});

test("first-time successful outcomes still come from the canonical mutation base", () => {
  assert.match(stream8Migration, /RETURN public\.handle_swipe_20260501210000_idempotency_base\(/);
  assert.match(mutualSessionBase, /'result', 'pass_recorded'/);
  assert.match(mutualSessionBase, /'result', 'vibe_recorded'/);
  assert.match(mutualSessionBase, /'result', 'super_vibe_sent'/);
  assert.match(mutualSessionBase, /'result', 'match'/);
  assert.match(mutualSessionBase, /'result', 'match_queued'/);
  assert.match(mutualSessionBase, /'result', 'already_matched'/);
  assert.match(mutualSessionBase, /'result', 'limit_reached'/);
  assert.match(mutualSessionBase, /'result', 'already_super_vibed_recently'/);
  assert.match(mutualSessionBase, /'result', 'participant_has_active_session_conflict'/);
});

test("simultaneous mutual swipes and duplicate client-session retries remain serialized", () => {
  assert.match(stream8Migration, /handle_swipe_idempotency:/);
  assert.match(mutualSessionBase, /handle_swipe_mutual_pair:/);
  assert.match(mutualSessionBase, /ON CONFLICT \(event_id, actor_id, target_id\) DO NOTHING/);
  assert.match(mutualSessionBase, /ON CONFLICT \(event_id, participant_1_id, participant_2_id\) DO NOTHING[\s\S]*RETURNING id INTO v_session_id/);
  assert.match(mutualSessionBase, /IF v_session_id IS NULL THEN[\s\S]*'result', 'already_matched'/);
});

test("super-vibe duplicate cannot reach cap or credit-like accounting twice", () => {
  const existingSwipeIndex = stream8Migration.indexOf("FROM public.event_swipes es");
  const delegateIndex = stream8Migration.lastIndexOf("public.handle_swipe_20260501210000_idempotency_base");
  assert.ok(delegateIndex > existingSwipeIndex, "super-vibe cap in delegated base is reached only after replay guard");
  assert.doesNotMatch(stream8Migration, /user_credits|credit_transactions|deduct_credit/);
});

test("swipe-actions suppresses duplicate, replay, blocked, conflict, and inactive-event notifications", () => {
  assert.match(swipeActions, /function shouldSuppressSwipeNotification/);
  assert.match(swipeActions, /result\.notification_suppressed === true/);
  assert.match(swipeActions, /result\.duplicate === true/);
  assert.match(swipeActions, /result\.idempotent === true/);
  assert.match(swipeActions, /result\.replay === true/);
  for (const outcome of [
    "already_swiped",
    "swipe_already_recorded",
    "event_not_active",
    "blocked",
    "reported",
    "account_paused",
    "target_unavailable",
    "pair_already_met_this_event",
    "participant_has_active_session_conflict",
  ]) {
    assert.match(swipeActions, new RegExp(`"${outcome}"`));
  }
  assert.match(swipeActions, /swipe_notification_dedupe/);
  assert.match(swipeActions, /notification_suppressed: true/);
  assert.match(swipeActions, /duplicate/);
});

test("new swipe notification paths remain present only for fresh side-effect-worthy outcomes", () => {
  assert.match(swipeActions, /result\.result === "match" && sessionId/);
  assert.match(swipeActions, /result\.result === "match_queued" && sessionId/);
  assert.match(swipeActions, /result\.result === "super_vibe_sent"/);
  assert.match(swipeActions, /result\.result === "vibe_recorded"/);
  assert.match(swipeActions, /video_date_outbox_enqueue_v2/);
  assert.match(swipeActions, /notification\.send/);
  assert.match(swipeActions, /someone_vibed_you/);
  assert.match(swipeActions, /ready_gate/);
  assert.match(swipeActions, /const path = `\/ready\/\$\{encodeURIComponent\(videoSessionId\)\}`/);
  assert.match(swipeActions, /session_id: videoSessionId/);
  assert.doesNotMatch(swipeActions, /pendingVideoSession|pendingMatch|open the event lobby/);
  assert.doesNotMatch(videoSessionFlow, /buildEventLobbyPendingSessionUrl/);
  assert.doesNotMatch(nativeActiveSessionRoutes, /eventLobbyHrefPendingVideoSession/);
});

test("shared and client swipe contracts tolerate already_swiped without deck advancement or noisy toasts", () => {
  for (const field of [
    "outcome",
    "duplicate",
    "idempotent",
    "replay",
    "notification_suppressed",
    "dedupe_reason",
    "existing_swipe_type",
    "requested_swipe_type",
  ]) {
    assert.match(videoSessionFlow, new RegExp(`${field}\\??:`));
  }
  assert.match(videoSessionFlow, /"already_swiped"/);
  assert.match(videoSessionFlow, /"swipe_already_recorded"/);
  assert.match(webSwipeHook, /case "already_swiped"/);
  assert.match(nativeLobby, /case ["']already_swiped["']/);
});

test("production validation is read-only catalog verification", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /has_function_privilege/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create)\b/i);
});

test("Stream 1-7 artifacts remain present and no unrelated native module/env changes are introduced", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql"), /get_event_lobby_active_state/);
  assert.match(stream7Migration, /swipe_already_recorded/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API calls `ready_gate_transition`|ready_gate_transition/);
  assert.doesNotMatch(swipeActions, /Deno\.env\.get\(["'](?!SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)/);
  assert.doesNotMatch(read("apps/mobile/lib/readyGateApi.ts"), /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/);
});
