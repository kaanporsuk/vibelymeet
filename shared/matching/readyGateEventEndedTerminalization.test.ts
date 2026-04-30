import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const validationPath = "supabase/validation/ready_gate_event_ended_terminalization.sql";
const validation = readFileSync(join(root, validationPath), "utf8");
const stream1Path = "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql";
const stream1Migration = readFileSync(join(root, stream1Path), "utf8");
const stream2Path = "supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql";
const stream2Migration = readFileSync(join(root, stream2Path), "utf8");
const dailyRoom = readFileSync(join(root, "supabase/functions/daily-room/index.ts"), "utf8");

const section = (startMarker: string, endMarker: string): string => {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
};

test("Stream 3 migration sorts after Stream 2", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501190000"), "test assumes Stream 2 migration is present");
  assert.ok(versions.includes("20260501200000"), "Stream 3 migration must exist");
  assert.ok(
    versions.indexOf("20260501200000") > versions.indexOf("20260501190000"),
    "Stream 3 migration must sort strictly after Stream 2",
  );
});

test("new and wrapped SQL functions preserve signatures and security hygiene", () => {
  for (const signature of [
    /CREATE OR REPLACE FUNCTION public\.terminalize_event_ready_gates\(\s*p_event_id uuid,\s*p_reason text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
    /CREATE OR REPLACE FUNCTION public\.handle_event_ready_gate_terminalization\(\)\s*RETURNS trigger\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
    /CREATE OR REPLACE FUNCTION public\.ready_gate_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
    /CREATE OR REPLACE FUNCTION public\.video_date_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
    /CREATE OR REPLACE FUNCTION public\.confirm_video_date_entry_prepared\(\s*p_session_id uuid,\s*p_room_name text,\s*p_room_url text,\s*p_entry_attempt_id text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
  ]) {
    assert.match(migration, signature);
  }

  assert.match(migration, /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260501200000_event_inactive_base/s);
  assert.match(migration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260501200000_event_inactive_base/s);
  assert.match(migration, /ALTER FUNCTION public\.confirm_video_date_entry_prepared\(uuid, text, text, text\)\s+RENAME TO confirm_video_date_entry_prepared_20260501200000_event_inactive_base/s);
});

test("cleanup function terminalizes only pre-date Ready Gate states", () => {
  const cleanup = section(
    "CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates",
    "COMMENT ON FUNCTION public.terminalize_event_ready_gates",
  );

  assert.match(cleanup, /ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready'\)/);
  assert.match(cleanup, /state = 'ready_gate'::public\.video_date_state/);
  assert.match(cleanup, /ready_gate_status = 'expired'/);
  assert.match(cleanup, /state = 'ended'::public\.video_date_state/);
  assert.match(cleanup, /ended_reason = v_terminal_reason/);
  assert.match(cleanup, /queue_status = 'idle'/);
  assert.match(cleanup, /current_room_id = NULL/);
  assert.match(cleanup, /current_partner_id = NULL/);
});

test("cleanup function excludes provider-prepared and date-capable sessions", () => {
  const cleanup = section(
    "CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates",
    "COMMENT ON FUNCTION public.terminalize_event_ready_gates",
  );

  for (const marker of [
    "handshake_started_at IS NULL",
    "date_started_at IS NULL",
    "daily_room_name IS NULL",
    "daily_room_url IS NULL",
    "participant_1_joined_at IS NULL",
    "participant_2_joined_at IS NULL",
    "COALESCE(vs.phase, 'ready_gate') NOT IN ('handshake', 'date')",
  ]) {
    assert.ok(cleanup.includes(marker), `cleanup must include provider/date exclusion: ${marker}`);
  }
});

test("event lifecycle trigger invokes cleanup on inactive transitions", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.handle_event_ready_gate_terminalization\(\)/);
  assert.match(migration, /v_inactive_reason := public\.get_event_lobby_inactive_reason\(NEW\.id\)/);
  assert.match(migration, /PERFORM public\.terminalize_event_ready_gates\(NEW\.id, v_inactive_reason\)/);
  assert.match(migration, /CREATE TRIGGER events_terminalize_ready_gates_on_inactive\s*AFTER UPDATE OF status, ended_at, archived_at ON public\.events/s);
});

test("Ready Gate actions detect event inactivity under the locked session row", () => {
  const readyGate = section(
    "CREATE OR REPLACE FUNCTION public.ready_gate_transition",
    "COMMENT ON FUNCTION public.ready_gate_transition",
  );
  const lockIndex = readyGate.indexOf("FOR UPDATE");
  const inactiveIndex = readyGate.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id)");

  assert.ok(lockIndex > 0);
  assert.ok(inactiveIndex > lockIndex, "event inactive check must happen after locking the session row");
  assert.match(readyGate, /p_action NOT IN \('sync', 'mark_ready', 'snooze'\)/);
  assert.match(readyGate, /public\.terminalize_event_ready_gates\(v_session\.event_id, v_inactive_reason\)/);
  assert.match(readyGate, /'READY_GATE_EVENT_ENDED'/);
  assert.match(readyGate, /'inactive_reason', v_inactive_reason/);
  assert.match(readyGate, /ready_gate_transition_20260501200000_event_inactive_base/);
});

test("Daily prepare-entry SQL path rejects inactive unprepared events", () => {
  const videoDate = section(
    "CREATE OR REPLACE FUNCTION public.video_date_transition",
    "COMMENT ON FUNCTION public.video_date_transition",
  );
  const confirm = section(
    "CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared",
    "COMMENT ON FUNCTION public.confirm_video_date_entry_prepared",
  );

  for (const fn of [videoDate, confirm]) {
    assert.match(fn, /v_already_entry := \(/);
    assert.match(fn, /public\.get_event_lobby_inactive_reason\(v_session\.event_id\)/);
    assert.match(fn, /public\.terminalize_event_ready_gates\(v_session\.event_id, v_inactive_reason\)/);
    assert.match(fn, /'code', 'READY_GATE_NOT_READY'/);
    assert.match(fn, /'error_code', 'EVENT_NOT_ACTIVE'/);
    assert.match(fn, /'inactive_reason', v_inactive_reason/);
  }

  assert.match(videoDate, /p_action IS DISTINCT FROM 'prepare_entry'/);
  assert.match(videoDate, /'prepare_entry_event_inactive'/);
  assert.match(confirm, /'confirm_prepare_entry_event_inactive'/);
});

test("observability marker and internal helper grants are present", () => {
  assert.match(migration, /record_event_loop_observability\(\s*'ready_gate_transition',\s*'success',\s*'READY_GATE_EVENT_ENDED'/s);
  assert.match(migration, /record_event_loop_observability\(\s*'video_date_transition',\s*'blocked',\s*'prepare_entry_event_inactive'/s);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.terminalize_event_ready_gates\(uuid, text\)\s*FROM PUBLIC, anon, authenticated/s);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.terminalize_event_ready_gates\(uuid, text\)\s*TO service_role/s);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.handle_event_ready_gate_terminalization\(\)\s*FROM PUBLIC, anon, authenticated/s);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.video_date_transition\(uuid, text, text\)\s*FROM PUBLIC, anon, authenticated/s);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_date_transition\(uuid, text, text\)\s*TO authenticated, service_role/s);
});

test("daily-room already uses SQL prepare-entry and confirm surfaces", () => {
  const actionStart = dailyRoom.indexOf('if (action === "prepare_date_entry")');
  assert.ok(actionStart > 0, "daily-room must implement prepare_date_entry");
  const actionBody = dailyRoom.slice(actionStart);
  const prepareIndex = actionBody.indexOf('p_action: "prepare_entry"');
  const providerIndex = actionBody.indexOf("ensureVideoDateProviderRoomForToken");
  const confirmIndex = actionBody.indexOf("confirmVideoDateEntryPrepared");

  assert.ok(prepareIndex > 0, "daily-room prepare_date_entry must call video_date_transition('prepare_entry')");
  assert.ok(providerIndex > prepareIndex, "provider room work should occur after SQL prepare-entry");
  assert.ok(confirmIndex > 0, "daily-room must confirm provider-prepared state through SQL");
  assert.ok(confirmIndex > providerIndex, "SQL confirm should occur after provider room proof");
});

test("production validation SQL is catalog-only and checks Stream 3 contract", () => {
  assert.doesNotMatch(validation, /^\s*(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
  assert.match(validation, /pg_get_functiondef\('public\.terminalize_event_ready_gates\(uuid,text\)'::regprocedure\)/);
  assert.match(validation, /events_terminalize_ready_gates_on_inactive/);
  assert.match(validation, /pg_get_functiondef\('public\.ready_gate_transition\(uuid,text,text\)'::regprocedure\)/);
  assert.match(validation, /pg_get_functiondef\('public\.video_date_transition\(uuid,text,text\)'::regprocedure\)/);
  assert.match(validation, /pg_get_functiondef\('public\.confirm_video_date_entry_prepared\(uuid,text,text,text\)'::regprocedure\)/);
  assert.match(validation, /has_function_privilege\('service_role', helper\.oid, 'EXECUTE'\)/);
});

test("Stream 1 and Stream 2 migrations remain untouched by Stream 3", () => {
  assert.match(stream1Migration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.match(stream2Migration, /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.doesNotMatch(stream1Migration, /terminalize_event_ready_gates/);
  assert.doesNotMatch(stream2Migration, /terminalize_event_ready_gates/);
});
