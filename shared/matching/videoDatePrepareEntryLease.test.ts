import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260503130000_video_date_prepare_entry_lease.sql");
const dailyRoom = read("supabase/functions/daily-room/index.ts");
const sharedPrepare = read("shared/matching/videoDatePrepareEntry.ts");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const validation = read("supabase/validation/video_date_prepare_entry_lease.sql");

test("prepare-entry lease migration is nullable-only and preserves public state enums", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prepare_entry_started_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prepare_entry_expires_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prepare_entry_attempt_id text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prepare_entry_actor_id uuid/);
  assert.doesNotMatch(migration, /CREATE TYPE public\.video_date_state/);
  assert.doesNotMatch(migration, /ALTER TYPE public\.video_date_state/);
  assert.doesNotMatch(migration, /ADD VALUE/);
});

test("prepare_entry creates a non-routeable lease and extends the both_ready handoff window", () => {
  assert.match(migration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260503130000_prepare_lease_base/s);
  assert.match(migration, /p_action IS DISTINCT FROM 'prepare_entry'/);
  assert.match(migration, /v_now \+ interval '90 seconds'/);
  assert.match(migration, /prepare_entry_started_at = COALESCE\(prepare_entry_started_at, v_now\)/);
  assert.match(migration, /prepare_entry_expires_at = v_lease_expires_at/);
  assert.match(migration, /ready_gate_expires_at = GREATEST\(/);
  assert.match(migration, /'routeable', false/);
  assert.match(migration, /public\.video_date_transition_20260503130000_prepare_lease_base\(/);
});

test("confirm clears the prepare-entry lease only after provider proof succeeds", () => {
  assert.match(migration, /ALTER FUNCTION public\.confirm_video_date_entry_prepared\(uuid, text, text, text\)\s+RENAME TO confirm_vde_prepared_202605031300_base/s);
  assert.match(migration, /v_success := COALESCE\(\(v_result ->> 'success'\)::boolean, false\)/);
  assert.match(migration, /IF v_success THEN[\s\S]*prepare_entry_started_at = NULL[\s\S]*prepare_entry_expires_at = NULL[\s\S]*prepare_entry_attempt_id = NULL[\s\S]*prepare_entry_actor_id = NULL/s);
});

test("stale cleanup preserves active leases and terminalizes expired unconfirmed leases", () => {
  assert.match(migration, /ALTER FUNCTION public\.expire_stale_video_sessions_bounded\(integer\)\s+RENAME TO expire_stale_video_sessions_bounded_202605031300_base/s);
  assert.match(migration, /prepare_entry_expires_at > v_now/);
  assert.match(migration, /ready_gate_expires_at = prepare_entry_expires_at/);
  assert.match(migration, /prepare_entry_expires_at <= v_now[\s\S]*ended_reason = 'prepare_entry_timeout'/s);
  assert.match(migration, /'active_prepare_entry_lease_preserved'/);
  assert.match(migration, /public\.expire_stale_video_sessions_bounded_202605031300_base\(v_limit\)/);
});

test("daily-room reclassifies metadata persistence failures with safe diagnostics", () => {
  assert.match(dailyRoom, /video_date_room_metadata_persist_failed/);
  assert.match(dailyRoom, /code: "DB_ROOM_PERSIST_FAILED" \| "SESSION_ENDED" \| "EVENT_NOT_ACTIVE" \| "SESSION_NOT_FOUND"/);
  assert.match(dailyRoom, /get_event_lobby_inactive_reason/);
  assert.match(dailyRoom, /code: "SESSION_ENDED"/);
  assert.match(dailyRoom, /code: "EVENT_NOT_ACTIVE"/);
  assert.match(dailyRoom, /db_error_code/);
  assert.match(dailyRoom, /db_error_message/);
  assert.match(dailyRoom, /details: params\.extra/);
  assert.match(dailyRoom, /if \(code === "EVENT_NOT_ACTIVE"\) return 409/);
});

test("client prepare single-flight and terminal retry cancellation are covered", () => {
  const forceIndex = sharedPrepare.indexOf("if (!options.force)");
  const inflightIndex = sharedPrepare.indexOf("const existing = prepareEntryInflight.get(key)");
  const taskIndex = sharedPrepare.indexOf("const task = (async ()");
  assert.ok(forceIndex > 0);
  assert.ok(inflightIndex > forceIndex);
  assert.ok(taskIndex > inflightIndex);
  assert.match(nativeReadyGateOverlay, /function isTerminalReadyGateTruth/);
  assert.match(nativeReadyGateOverlay, /prepare_entry_retry_cancelled_terminal/);
  assert.match(nativeReadyGateOverlay, /READY_GATE_STALE_OR_ENDED_USER_MESSAGE/);
});

test("production validation SQL checks the lease contract through catalog function defs", () => {
  assert.match(validation, /pg_get_functiondef\('public\.video_date_transition\(uuid,text,text\)'::regprocedure\)/);
  assert.match(validation, /prepare_entry_lease_started/);
  assert.match(validation, /prepare_entry_timeout/);
  assert.match(validation, /active_prepare_entry_lease_preserved/);
  assert.match(validation, /confirm_video_date_entry_prepared/);
});
