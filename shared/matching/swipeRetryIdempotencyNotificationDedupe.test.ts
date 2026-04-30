import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const migrationPath = "supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/swipe_retry_idempotency_notification_dedupe.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

test("Stream 7 migration exists and sorts after Stream 3 backend hardening", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501200000"), "Stream 3 migration should be present");
  assert.ok(versions.includes("20260501210000"), "Stream 7 migration should be present");
  assert.ok(
    versions.indexOf("20260501210000") > versions.indexOf("20260501200000"),
    "Stream 7 migration must sort after Stream 3",
  );
});

test("handle_swipe signature, SECURITY DEFINER, search path, and active-event guard are preserved", () => {
  assert.match(migration, /ALTER FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)\s+RENAME TO handle_swipe_20260501210000_idempotency_base/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.handle_swipe\(\s*p_event_id uuid,\s*p_actor_id uuid,\s*p_target_id uuid,\s*p_swipe_type text\s*\) RETURNS jsonb/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(migration, /public\.get_event_lobby_inactive_reason\(p_event_id\)/);
  assert.match(migration, /FOR SHARE OF ev/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)[\s\S]*TO authenticated, service_role/);
});

test("duplicate existing-swipe detection runs before delegated side effects", () => {
  const existingSwipeIndex = migration.indexOf("FROM public.event_swipes es");
  const delegateIndex = migration.lastIndexOf("public.handle_swipe_20260501210000_idempotency_base");
  assert.ok(existingSwipeIndex > 0, "migration should inspect the natural idempotency key");
  assert.ok(delegateIndex > existingSwipeIndex, "delegated mutation path should be after replay guard");
  assert.match(migration, /handle_swipe_idempotency:/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_existing_swipe_type IS DISTINCT FROM p_swipe_type/);
});

test("same-type duplicate returns stable replay markers without notification side effects", () => {
  assert.match(migration, /'idempotent', true/);
  assert.match(migration, /'replay', true/);
  assert.match(migration, /'notification_suppressed', true/);
  assert.match(migration, /'dedupe_reason', 'existing_swipe'/);
  assert.match(migration, /'dedupe_reason', 'existing_match'/);
  assert.match(migration, /WHEN 'pass' THEN 'pass_recorded'/);
  assert.match(migration, /WHEN 'super_vibe' THEN 'super_vibe_sent'/);
  assert.match(migration, /ELSE 'vibe_recorded'/);
});

test("different-type duplicate returns explicit already-recorded conflict markers", () => {
  assert.match(migration, /'success', false/);
  assert.match(migration, /'result', 'swipe_already_recorded'/);
  assert.match(migration, /'error', 'swipe_already_recorded'/);
  assert.match(migration, /'existing_swipe_type', v_existing_swipe_type/);
  assert.match(migration, /'requested_swipe_type', p_swipe_type/);
  assert.match(migration, /'dedupe_reason', 'swipe_type_conflict'/);
});

test("super-vibe duplicate cannot reach cap or credit-like accounting twice", () => {
  const existingSwipeIndex = migration.indexOf("FROM public.event_swipes es");
  const delegateIndex = migration.lastIndexOf("public.handle_swipe_20260501210000_idempotency_base");
  assert.ok(delegateIndex > existingSwipeIndex, "super-vibe cap in delegated base is reached only after replay guard");
  assert.match(migration, /WHEN 'super_vibe' THEN 'super_vibe_sent'/);
  assert.doesNotMatch(migration, /user_credits|credit_transactions|deduct_credit/);
});

test("swipe-actions suppresses replay, conflict, and inactive-event notifications", () => {
  assert.match(swipeActions, /function shouldSuppressSwipeNotification/);
  assert.match(swipeActions, /result\.notification_suppressed === true/);
  assert.match(swipeActions, /result\.idempotent === true/);
  assert.match(swipeActions, /result\.replay === true/);
  assert.match(swipeActions, /outcome === "swipe_already_recorded"/);
  assert.match(swipeActions, /outcome === "event_not_active"/);
  assert.match(swipeActions, /swipe_notification_dedupe/);
  assert.match(swipeActions, /notification_suppressed/);
});

test("shared swipe payload type tolerates additive replay fields and conflict no-advance result", () => {
  for (const field of [
    "idempotent",
    "replay",
    "notification_suppressed",
    "dedupe_reason",
    "existing_swipe_type",
    "requested_swipe_type",
  ]) {
    assert.match(videoSessionFlow, new RegExp(`${field}\\??:`));
  }
  assert.match(videoSessionFlow, /"swipe_already_recorded"/);
});

test("new swipe notification paths remain present for fresh outcomes", () => {
  assert.match(swipeActions, /result\.result === "match" && sessionId/);
  assert.match(swipeActions, /result\.result === "match_queued" && sessionId/);
  assert.match(swipeActions, /result\.result === "super_vibe_sent"/);
  assert.match(swipeActions, /result\.result === "vibe_recorded"/);
  assert.match(swipeActions, /send-notification/);
  assert.match(swipeActions, /someone_vibed_you/);
  assert.match(swipeActions, /ready_gate/);
});

test("production validation is read-only catalog verification", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /has_function_privilege/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create)\b/i);
});

test("Stream 1-6 artifacts remain present and no unrelated native module/env changes are introduced", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API calls `ready_gate_transition`|ready_gate_transition/);
  assert.doesNotMatch(swipeActions, /Deno\.env\.get\(["'](?!SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)/);
  assert.doesNotMatch(read("apps/mobile/lib/readyGateApi.ts"), /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/);
});
