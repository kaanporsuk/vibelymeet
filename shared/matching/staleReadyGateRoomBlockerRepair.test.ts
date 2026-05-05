import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const migrationPath = "supabase/migrations/20260506090000_stale_ready_gate_room_blocker_repair.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/stale_ready_gate_room_blocker_repair.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
}

test("global active-session helper distinguishes real sessions from stale Ready Gates", () => {
  const helper = section(
    "CREATE OR REPLACE FUNCTION public.video_session_blocks_global_active_conflict",
    "COMMENT ON FUNCTION public.video_session_blocks_global_active_conflict",
  );

  assert.match(helper, /p_handshake_started_at IS NOT NULL/);
  assert.match(helper, /p_date_started_at IS NOT NULL/);
  assert.match(helper, /p_participant_1_joined_at IS NOT NULL/);
  assert.match(helper, /p_participant_2_joined_at IS NOT NULL/);
  assert.match(helper, /v_state IN \('handshake', 'date'\)/);
  assert.match(helper, /v_status = 'queued'[\s\S]*RETURN false/);
  assert.match(helper, /public\.get_event_lobby_inactive_reason\(p_event_id\)/);
  assert.match(helper, /p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now/);
  assert.match(helper, /p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now/);
});

test("one-active-session trigger delegates conflict semantics to the global helper", () => {
  const trigger = section(
    "CREATE OR REPLACE FUNCTION public.enforce_one_active_video_session",
    "COMMENT ON FUNCTION public.enforce_one_active_video_session",
  );

  assert.match(trigger, /public\.video_session_blocks_global_active_conflict\(/);
  assert.match(trigger, /vs\.prepare_entry_expires_at/);
  assert.match(trigger, /vs\.participant_1_joined_at/);
  assert.match(trigger, /vs\.participant_2_joined_at/);
  assert.match(trigger, /RAISE EXCEPTION 'participant_has_active_session_conflict'/);
  assert.doesNotMatch(trigger, /vs\.ended_at IS NULL\s+AND vs\.state IS DISTINCT FROM 'ended'/);
});

test("cleanup terminalizes expired or event-inactive pre-date room metadata blockers", () => {
  const repair = section(
    "CREATE OR REPLACE FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers",
    "COMMENT ON FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers",
  );

  for (const marker of [
    "vs.daily_room_name IS NOT NULL",
    "vs.daily_room_url IS NOT NULL",
    "public.get_event_lobby_inactive_reason(vs.event_id) IS NOT NULL",
    "vs.ready_gate_expires_at <= v_now",
    "vs.prepare_entry_expires_at IS NULL OR vs.prepare_entry_expires_at <= v_now",
    "handshake_started_at IS NULL",
    "date_started_at IS NULL",
    "participant_1_joined_at IS NULL",
    "participant_2_joined_at IS NULL",
    "daily_room_name = NULL",
    "daily_room_url = NULL",
    "prepare_entry_expires_at = NULL",
    "stale_pre_date_ready_gate_room_metadata_terminalized",
  ]) {
    assert.ok(repair.includes(marker), `repair should include ${marker}`);
  }

  assert.match(migration, /public\.terminalize_stale_pre_date_ready_gate_blockers\(\s*500,\s*'migration_backfill'\s*\)/);
  assert.match(migration, /ALTER FUNCTION public\.expire_stale_video_sessions_bounded\(integer\)\s+RENAME TO expire_stale_video_sessions_bounded_20260506090000_stale_room_base/s);
  assert.match(migration, /v_repaired := public\.terminalize_stale_pre_date_ready_gate_blockers/);
});

test("event-ended terminalization no longer treats room metadata alone as provider proof", () => {
  const eventCleanup = section(
    "CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates",
    "COMMENT ON FUNCTION public.terminalize_event_ready_gates",
  );

  assert.match(eventCleanup, /daily_room_name = NULL/);
  assert.match(eventCleanup, /daily_room_url = NULL/);
  assert.match(eventCleanup, /stale_room_metadata_cleared/);
  assert.match(eventCleanup, /handshake_started_at IS NULL/);
  assert.match(eventCleanup, /date_started_at IS NULL/);
  assert.match(eventCleanup, /participant_1_joined_at IS NULL/);
  assert.match(eventCleanup, /participant_2_joined_at IS NULL/);
  assert.doesNotMatch(eventCleanup, /vs\.daily_room_name IS NULL/);
  assert.doesNotMatch(eventCleanup, /vs\.daily_room_url IS NULL/);
});

test("handle_swipe wrapper returns a structured conflict before the base swipe mutates", () => {
  const swipe = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  const conflictIndex = swipe.indexOf("pre_swipe_global_active_session_guard");
  const baseIndex = swipe.lastIndexOf("public.handle_swipe_20260506090000_stale_room_base");

  assert.ok(conflictIndex > 0, "global conflict guard should be present");
  assert.ok(baseIndex > conflictIndex, "base handle_swipe should be delegated after the guard");
  assert.match(swipe, /public\.video_session_blocks_global_active_conflict\(/);
  assert.match(swipe, /'outcome', 'participant_has_active_session_conflict'/);
  assert.match(swipe, /'dedupe_reason', 'active_session_conflict'/);
  assert.match(swipe, /NOT \(\s*z\.event_id = p_event_id/);
});

test("Edge fallback maps trigger conflicts to friendly swipe conflict payloads", () => {
  assert.match(swipeActions, /function isActiveSessionConflictRpcError/);
  assert.match(swipeActions, /participant_has_active_session_conflict/);
  assert.match(swipeActions, /error\.code === "23505"/);
  assert.match(swipeActions, /const activeSessionConflict = isActiveSessionConflictRpcError\(error\)/);
  assert.match(swipeActions, /result: "participant_has_active_session_conflict"/);
  assert.match(swipeActions, /dedupe_reason: "active_session_conflict"/);
});

test("production validation remains read-only and covers the repaired root causes", () => {
  assert.doesNotMatch(validation, /^\s*(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
  assert.match(validation, /global_active_conflict_helper_ignores_stale_ready_gates/);
  assert.match(validation, /one_active_session_trigger_uses_global_helper/);
  assert.match(validation, /expire_cleanup_wraps_stale_room_metadata_repair/);
  assert.match(validation, /event_ended_terminalization_allows_stale_room_metadata_cleanup/);
  assert.match(validation, /handle_swipe_global_preflight_returns_structured_conflict/);
  assert.match(validation, /no_nonended_expired_pre_date_room_metadata_blockers/);
});
