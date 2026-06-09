import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const sharedPrepareEntry = read("shared/matching/videoDatePrepareEntry.ts");
const dailyRoom = read("supabase/functions/daily-room/index.ts");
const migration = read("supabase/migrations/20260505140000_ready_gate_pre_ready_room_metadata_repair.sql");
const prepareEntryMetadataMigration = read("supabase/migrations/20260505153000_video_date_prepare_entry_payload_metadata.sql");
const preserveAfterReadyWarmupMigration = read("supabase/migrations/20260505154500_ready_gate_preserve_after_ready_room_warmup.sql");
const validation = read("supabase/validation/ready_gate_pre_ready_room_metadata_repair.sql");

test("web Ready Gate overlay does not warm provider rooms before prepare-date-entry", () => {
  assert.doesNotMatch(webOverlay, /startRoomWarmupAfterReady/);
  assert.doesNotMatch(webOverlay, /videoDateRoomWarmupAfterReadyEnabled\(\)/);
  assert.doesNotMatch(webOverlay, /roomWarmupStartedRef/);
  assert.doesNotMatch(webOverlay, /ensureVideoDateRoomWarmup/);
  assert.match(webOverlay, /const readyGateKey = activeReadyGateKey/);
  assert.match(webOverlay, /activeReadyGateKeyRef\.current !== readyGateKey/);
  assert.doesNotMatch(webOverlay, /addVideoDatePreconnect|SUPABASE_URL/);
  assert.match(webOverlay, /startWebVideoDateDailyPrewarm/);
  assert.match(webOverlay, /void runPermissionPrewarm\("ready_gate_open"\)/);
  assert.match(webOverlay, /void runPermissionPrewarm\("ready_tap"\)/);
  assert.match(webOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(webOverlay, /preAuthWebVideoDateDailyPrewarm/);
});

test("native Ready Gate overlay does not warm provider rooms before prepare-date-entry", () => {
  assert.doesNotMatch(nativeOverlay, /startRoomWarmupAfterReady/);
  assert.doesNotMatch(nativeOverlay, /videoDateRoomWarmupAfterReadyEnabled\(\)/);
  assert.doesNotMatch(nativeOverlay, /roomWarmupStartedRef/);
  assert.doesNotMatch(nativeOverlay, /ensureVideoDateRoomWarmup/);
  assert.match(nativeOverlay, /const activeReadyGateKey = `\$\{sessionId\}:\$\{eventId\}`/);
  assert.match(nativeOverlay, /const readyGateKey = activeReadyGateKey/);
  assert.match(nativeOverlay, /activeReadyGateKeyRef\.current !== readyGateKey/);
  assert.match(nativeOverlay, /startNativeVideoDateDailyPrewarm/);
  assert.match(nativeOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeOverlay, /preAuthNativeVideoDateDailyPrewarm/);
});

test("after-ready provider room warmup helpers and action branch are removed", () => {
  assert.equal(exists("src/lib/videoDatePreconnect.ts"), false);
  assert.equal(exists("src/lib/videoDateRoomWarmup.ts"), false);
  assert.equal(exists("apps/mobile/lib/videoDateRoomWarmup.ts"), false);
  assert.equal(exists("shared/matching/videoDateRoomWarmup.ts"), false);
  assert.doesNotMatch(dailyRoom, /if \(action === "ensure_date_room"\)/);
  assert.doesNotMatch(dailyRoom, /ENSURE_VIDEO_DATE_ROOM_ACTION/);
  assert.doesNotMatch(webPrepareEntry, /ensureVideoDateRoom|ENSURE_VIDEO_DATE_ROOM_ACTION|EnsureVideoDateRoom/);
  assert.doesNotMatch(nativePrepareEntry, /ensureVideoDateRoom|ENSURE_VIDEO_DATE_ROOM_ACTION|EnsureVideoDateRoom/);
  assert.doesNotMatch(sharedPrepareEntry, /ENSURE_VIDEO_DATE_ROOM_ACTION|EnsureVideoDateRoom/);
});

test("Ready Gate repair wrapper preserves the public RPC and delegates to the hardened base", () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260505140000_pre_ready_room_metadata_base/s,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.ready_gate_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'public'/s,
  );
  assert.match(
    migration,
    /v_result := public\.ready_gate_transition_20260505140000_pre_ready_room_metadata_base\(\s*p_session_id,\s*p_action,\s*p_reason\s*\)/s,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+TO anon, authenticated, service_role/);
});

test("Ready Gate repair wrapper clears only stale pre-date room metadata", () => {
  assert.match(migration, /p_action IN \('mark_ready', 'snooze'\)/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_session\.participant_1_id = v_actor OR v_session\.participant_2_id = v_actor/);
  assert.match(migration, /v_session\.ended_at IS NULL/);
  assert.match(migration, /v_session\.state = 'ready_gate'::public\.video_date_state/);
  assert.match(migration, /v_session\.ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'snoozed'\)/);
  assert.match(migration, /v_session\.handshake_started_at IS NULL/);
  assert.match(migration, /v_session\.date_started_at IS NULL/);
  assert.match(migration, /v_session\.participant_1_joined_at IS NULL/);
  assert.match(migration, /v_session\.participant_2_joined_at IS NULL/);
  assert.match(migration, /daily_room_name = NULL/);
  assert.match(migration, /daily_room_url = NULL/);
  assert.match(migration, /daily_room_verified_at = NULL/);
  assert.match(migration, /daily_room_expires_at = NULL/);
  assert.match(migration, /daily_room_provider_verify_reason = NULL/);
  assert.doesNotMatch(migration, /ready_participant_1_at = NULL|ready_participant_2_at = NULL/);
});

test("Ready Gate repair wrapper returns participant-safe backend truth additively", () => {
  for (const field of [
    "participant_1_id",
    "participant_2_id",
    "ready_participant_1_at",
    "ready_participant_2_at",
    "ready_gate_status",
    "ready_gate_expires_at",
    "snoozed_by",
    "snooze_expires_at",
  ]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /COALESCE\(v_result, '\{\}'::jsonb\) \|\| jsonb_build_object/);
});

test("prepare_entry transition returns Daily room metadata for the Edge fast path", () => {
  assert.match(
    prepareEntryMetadataMigration,
    /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260505153000_prepare_payload_base/s,
  );
  assert.match(prepareEntryMetadataMigration, /p_action IS DISTINCT FROM 'prepare_entry'/);
  assert.match(prepareEntryMetadataMigration, /jsonb_typeof\(v_result->'success'\) = 'boolean'/);
  assert.match(prepareEntryMetadataMigration, /v_session\.participant_1_id IS DISTINCT FROM v_actor/);
  for (const field of [
    "daily_room_name",
    "daily_room_url",
    "daily_room_verified_at",
    "daily_room_expires_at",
    "daily_room_provider_verify_reason",
    "date_started_at",
  ]) {
    assert.match(prepareEntryMetadataMigration, new RegExp(`'${field}'`));
  }
});

test("after-ready room warmup proof survives the second ready transition only when fresh and canonical", () => {
  assert.match(
    preserveAfterReadyWarmupMigration,
    /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260505154500_preserve_after_ready_room_base/s,
  );
  assert.match(preserveAfterReadyWarmupMigration, /p_action = 'mark_ready'/);
  assert.match(preserveAfterReadyWarmupMigration, /v_before\.ready_gate_status IN \('ready_a', 'ready_b'\)/);
  assert.match(preserveAfterReadyWarmupMigration, /v_before\.daily_room_name = v_expected_room_name/);
  assert.match(preserveAfterReadyWarmupMigration, /v_before\.daily_room_url LIKE \('%\/' \|\| v_expected_room_name\)/);
  assert.match(preserveAfterReadyWarmupMigration, /v_before\.daily_room_verified_at >= v_now - interval '90 seconds'/);
  assert.match(preserveAfterReadyWarmupMigration, /v_before\.daily_room_expires_at > v_now \+ interval '60 seconds'/);
  assert.match(preserveAfterReadyWarmupMigration, /v_status = 'both_ready'/);
  assert.match(preserveAfterReadyWarmupMigration, /daily_room_name IS NULL/);
  assert.match(preserveAfterReadyWarmupMigration, /after_ready_room_metadata_preserved_for_both_ready/);
  assert.doesNotMatch(preserveAfterReadyWarmupMigration, /ready_gate_status IN \('ready', 'ready_a', 'ready_b'\)/);
});

test("web Ready Gate diagnostics include Supabase and backend rejection details", () => {
  assert.match(webReadyGateHook, /Sentry\.captureMessage\("ready_gate_transition_failed"/);
  assert.match(webReadyGateHook, /if \(diagnostic\.outcome === "rpc_error"\)/);
  for (const field of [
    "sessionId",
    "eventId",
    "action",
    "code",
    "message",
    "details",
    "hint",
    "reason",
    "error_code",
    "ready_gate_status",
    "terminal",
  ]) {
    assert.match(webReadyGateHook, new RegExp(field));
  }
  assert.match(webReadyGateHook, /details: error\.details \?\? null/);
  assert.match(webReadyGateHook, /hint: error\.hint \?\? null/);
  assert.match(webReadyGateHook, /details: payload\.details \?\? null/);
  assert.match(webReadyGateHook, /hint: payload\.hint \?\? null/);
});

test("web Ready Gate refetches backend truth when mark_ready success omits ready timestamps", () => {
  assert.match(webReadyGateHook, /Object\.prototype\.hasOwnProperty\.call\(payload, "ready_participant_1_at"\)/);
  assert.match(webReadyGateHook, /Object\.prototype\.hasOwnProperty\.call\(payload, "ready_participant_2_at"\)/);
  assert.match(webReadyGateHook, /action === "mark_ready"[\s\S]*const refreshed = await fetchSession\(\)/);
});

test("native Ready Gate refetches backend truth when mark_ready success omits ready timestamps", () => {
  assert.match(nativeReadyGateApi, /Object\.prototype\.hasOwnProperty\.call\(payload, 'ready_participant_1_at'\)/);
  assert.match(nativeReadyGateApi, /Object\.prototype\.hasOwnProperty\.call\(payload, 'ready_participant_2_at'\)/);
  assert.match(nativeReadyGateApi, /action === 'mark_ready'[\s\S]*const refreshed = await fetchSession\(\)/);
});

test("validation SQL covers the repair wrapper contract", () => {
  for (const marker of [
    "ready_gate_transition_repair_signature_security",
    "ready_gate_transition_repair_delegates_to_base",
    "ready_gate_transition_repairs_only_participant_pre_date_ready_gate",
    "ready_gate_transition_clears_stale_room_metadata_only",
    "ready_gate_transition_enriches_participant_safe_truth",
  ]) {
    assert.match(validation, new RegExp(marker));
  }
  assert.match(validation, /has_function_privilege\('anon', 'public\.ready_gate_transition\(uuid,text,text\)', 'EXECUTE'\)/);
});
