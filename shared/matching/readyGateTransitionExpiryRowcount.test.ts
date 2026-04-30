import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const validationPath = "supabase/validation/ready_gate_transition_expiry_rowcount.sql";
const validation = readFileSync(join(root, validationPath), "utf8");
const stream1Path = "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql";
const stream1Migration = readFileSync(join(root, stream1Path), "utf8");

test("Stream 2 migration sorts after Stream 1 active-event contract", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501180000"), "test assumes Stream 1 migration is present");
  assert.ok(versions.includes("20260501190000"), "Stream 2 migration must exist");
  assert.ok(
    versions.indexOf("20260501190000") > versions.indexOf("20260501180000"),
    "Stream 2 migration must sort strictly after Stream 1",
  );
});

test("ready_gate_transition public signature and security hygiene are preserved", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.ready_gate_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ready_gate_transition\(uuid, text, text\) FROM PUBLIC/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\) TO anon, authenticated, service_role/,
  );
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
});

test("public RPC owns transition behavior instead of delegating unsafe ready or snooze paths", () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260501190000_expiry_rowcount_prior/s,
  );
  assert.doesNotMatch(
    migration,
    /ready_gate_transition_20260501190000_expiry_rowcount_prior\(\s*p_session_id,\s*p_action,\s*p_reason\s*\)/s,
    "new public function must not delegate mark_ready/snooze behavior to the prior wrapper chain",
  );
});

test("mark_ready and snooze re-check expiry after locking the session row", () => {
  const lockIndex = migration.indexOf("FOR UPDATE");
  const expiryActionIndex = migration.indexOf("IF p_action IN ('mark_ready', 'snooze')");
  const expiryPredicateIndex = migration.indexOf("ready_gate_expires_at <= v_now", expiryActionIndex);
  const expireUpdateIndex = migration.indexOf("ready_gate_status = 'expired'", expiryPredicateIndex);

  assert.ok(lockIndex > 0, "ready_gate_transition must lock the video_sessions row");
  assert.ok(expiryActionIndex > lockIndex, "mark_ready/snooze expiry branch must run under the row lock");
  assert.ok(expiryPredicateIndex > expiryActionIndex, "expiry predicate must be inside the action branch");
  assert.ok(expireUpdateIndex > expiryPredicateIndex, "elapsed gates must terminalize before late ready/snooze can succeed");
  assert.match(migration, /'reason', 'ready_gate_expired'/);
  assert.match(migration, /'error_code', 'ready_gate_expired'/);
});

test("guarded Ready Gate updates check rowcount and return explicit stale/conflict truth", () => {
  const diagnosticsMatches = migration.match(/GET DIAGNOSTICS v_row_count = ROW_COUNT/g) ?? [];
  assert.ok(diagnosticsMatches.length >= 4, "expiry, mark_ready, snooze, and forfeit updates should check rowcount");
  assert.match(migration, /IF v_row_count > 0 THEN[\s\S]*ELSE[\s\S]*'stale_transition'/);
  assert.match(migration, /IF v_row_count = 0 THEN[\s\S]*'guarded_update_zero_rows'/);
  assert.match(migration, /IF v_row_count = 0 THEN[\s\S]*'session_no_longer_ready_gate_mutable'/);
  assert.match(migration, /SELECT \*\s+INTO v_session\s+FROM public\.video_sessions\s+WHERE id = p_session_id/s);
});

test("terminal idempotency and existing response fields remain present", () => {
  assert.match(migration, /v_session\.ready_gate_status IN \('forfeited', 'expired', 'both_ready'\)/);
  assert.match(migration, /'success', true,\s*'status', v_session\.ready_gate_status/s);
  assert.match(migration, /'ready_gate_expires_at', v_session\.ready_gate_expires_at/);
  assert.match(migration, /'ready_participant_1_at', v_session\.ready_participant_1_at/);
  assert.match(migration, /'ready_participant_2_at', v_session\.ready_participant_2_at/);
  assert.match(migration, /'snoozed_by', v_session\.snoozed_by/);
  assert.match(migration, /'snooze_expires_at', v_session\.snooze_expires_at/);
});

test("both-ready grace and Ready Gate observability are preserved", () => {
  assert.match(migration, /v_now \+ interval '45 seconds'/);
  assert.match(migration, /both_ready_provider_prepare_grace_extended/);
  assert.match(migration, /record_event_loop_observability\(\s*'ready_gate_transition'/s);
  assert.match(migration, /'status_before', v_before\.ready_gate_status/);
  assert.match(migration, /'status_after', v_status_after/);
  assert.match(migration, /'row_count_checked', true/);
});

test("Stream 2 does not introduce event-ended cleanup or Daily prepare-entry guards", () => {
  assert.doesNotMatch(migration, /video_date_transition/);
  assert.doesNotMatch(migration, /prepare_date_entry/);
  assert.doesNotMatch(migration, /prepare_entry/);
  assert.doesNotMatch(migration, /event_ended|event_cancelled|event_archived/);
});

test("production validation SQL is catalog-only and checks the Stream 2 contract", () => {
  assert.doesNotMatch(validation, /^\s*(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
  assert.match(validation, /pg_get_functiondef\('public\.ready_gate_transition\(uuid,text,text\)'::regprocedure\)/);
  assert.match(validation, /prosecdef/);
  assert.match(validation, /search_path=public/);
  assert.match(validation, /ready_gate_expires_at <= v_now/);
  assert.match(validation, /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(validation, /guarded_update_zero_rows/);
});

test("Stream 1 active-event migration remains untouched by Stream 2", () => {
  assert.match(stream1Migration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.doesNotMatch(stream1Migration, /ready_gate_transition_20260501190000_expiry_rowcount_prior/);
});
