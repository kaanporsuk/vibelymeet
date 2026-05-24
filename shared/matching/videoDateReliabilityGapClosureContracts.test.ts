import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventDeckResponse } from "../../supabase/functions/_shared/eventProfileAdapters";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const closureMigration = read("supabase/migrations/20260523202000_reliability_gap_closure.sql");
const queueFairnessMigration = read("supabase/migrations/20260522011000_video_date_phase6_queue_fairness.sql");
const publicApiMigration = read("supabase/migrations/20260523123000_public_api_interface_changes.sql");
const eventProfileAdapters = read("supabase/functions/_shared/eventProfileAdapters.ts");
const packageJson = read("package.json");

function functionSection(source: string, functionName: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const revoke = source.indexOf(`REVOKE ALL ON FUNCTION public.${functionName}`, start);
  assert.notEqual(revoke, -1, `${functionName} revoke block should follow definition`);
  return source.slice(start, revoke);
}

const recoverySection = functionSection(closureMigration, "recover_ready_gate_missing_rooms_v1");
const expireWrapperSection = functionSection(closureMigration, "expire_stale_video_sessions_bounded");
const drainSection = functionSection(closureMigration, "drain_match_queue_v2");
const deckV3Section = functionSection(closureMigration, "get_event_deck_v3");
const authoritativeDrainSection = functionSection(queueFairnessMigration, "drain_match_queue_v2");
const authoritativeDeckV3Section = functionSection(publicApiMigration, "get_event_deck_v3");

test("Ready Gate missing-room recovery enqueues room repair before terminal cleanup", () => {
  assert.doesNotMatch(
    recoverySection,
    /auth\.role\(\)/,
    "recovery must work from pg_cron and internal SECURITY DEFINER callers that do not carry a Supabase JWT role",
  );
  assert.match(recoverySection, /ready_gate_status = 'both_ready'/);
  assert.match(recoverySection, /NULLIF\(vs\.daily_room_name, ''\) IS NULL/);
  assert.match(recoverySection, /NULLIF\(vs\.daily_room_url, ''\) IS NULL/);
  assert.match(recoverySection, /vs\.daily_room_url NOT LIKE \('%\/' \|\| vs\.daily_room_name\)/);
  assert.match(recoverySection, /public\.video_date_outbox_enqueue_v2\(/);
  assert.match(recoverySection, /'daily\.ensure_video_date_room'/);
  assert.match(recoverySection, /v_base_dedupe_key := 'phase3:ensure_room:' \|\| r\.id::text/);
  assert.match(recoverySection, /v_recovery_dedupe_key := 'phase3:ensure_room_recovery:' \|\| r\.id::text/);
  assert.match(recoverySection, /o\.dedupe_key IN \(v_base_dedupe_key, v_recovery_dedupe_key\)/);
  assert.match(recoverySection, /v_has_outbox := FOUND/);
  assert.match(recoverySection, /IF v_has_outbox THEN[\s\S]+v_latest_is_recovery := v_latest_outbox\.dedupe_key = v_recovery_dedupe_key[\s\S]+ELSE[\s\S]+v_latest_is_recovery := false/);
  assert.match(recoverySection, /pg_try_advisory_xact_lock\(v_outbox_lock_key\)/);
  assert.match(recoverySection, /'provider_room_recovery_lock_busy'/);
  assert.match(recoverySection, /'provider_room_recovery_enqueued'/);
  assert.match(recoverySection, /'provider_room_recovery_in_progress'/);
  assert.match(recoverySection, /'provider_room_recovery_done_waiting_room_metadata'/);
  assert.match(recoverySection, /'provider_room_recovered'/);
  assert.match(recoverySection, /'ready_gate_room_recovery_failed'/);
  assert.match(recoverySection, /v_latest_is_recovery[\s\S]+v_latest_outbox\.state IN \('failed', 'done'\)/);
  assert.match(recoverySection, /v_latest_outbox\.state = 'failed'/);
  assert.match(recoverySection, /COALESCE\(v_latest_outbox\.attempts, 0\) > 0/);
  assert.match(recoverySection, /COALESCE\(v_latest_outbox\.updated_at, v_latest_outbox\.created_at\) \+ v_terminal_after <= v_now/);
  assert.match(recoverySection, /'provider_room_recovery_failed_waiting_terminal_deadline'/);
  assert.doesNotMatch(recoverySection, /LIMIT 1\s+FOR UPDATE;/);
  assert.match(recoverySection, /v_recovery_dedupe_key,\s+v_now/);
  assert.match(recoverySection, /ready_gate_expires_at = GREATEST/);
  assert.match(recoverySection, /prepare_entry_expires_at = GREATEST/);
  assert.match(recoverySection, /record_event_loop_observability\(\s+'ready_gate_missing_room_recovery'/);
  assert.match(closureMigration, /GRANT EXECUTE ON FUNCTION public\.recover_ready_gate_missing_rooms_v1\(integer, integer, integer\)[\s\S]+TO service_role/);

  assert.ok(
    expireWrapperSection.indexOf("recover_ready_gate_missing_rooms_v1") <
      expireWrapperSection.indexOf("expire_stale_vsessions_bounded_202605232020_base"),
    "stale cleanup must attempt Ready Gate room recovery before delegating to terminal cleanup",
  );
});

test("drain_match_queue_v2 uses non-blocking advisory locks and exposes lock_busy", () => {
  assert.match(closureMigration, /Additive authoritative overlays for earlier queue\/deck migrations/);
  assert.match(drainSection, /pg_try_advisory_xact_lock\(\s+hashtextextended\('video_session_command:' \|\| v_actor::text \|\| ':' \|\| v_key/);
  assert.match(drainSection, /pg_try_advisory_xact_lock\(\s+hashtextextended\(\s+'event_lobby_participant_session:' \|\| p_event_id::text/);
  assert.match(drainSection, /'lock_busy'/);
  assert.match(drainSection, /'lock_scope', 'command'/);
  assert.match(drainSection, /'lock_scope', 'participant_session_low'/);
  assert.match(drainSection, /'lock_scope', 'participant_session_high'/);
  assert.doesNotMatch(drainSection, /pg_advisory_xact_lock\(\s+hashtextextended\('video_session_command:' \|\| v_actor::text \|\| ':' \|\| v_key/);
  assert.doesNotMatch(drainSection, /pg_advisory_xact_lock\(\s+hashtextextended\(\s+'event_lobby_participant_session:' \|\| p_event_id::text/);
  assert.equal(
    authoritativeDrainSection.includes("pg_try_advisory_xact_lock"),
    true,
    "the amended authoritative migration and additive overlay should agree on non-blocking lock semantics",
  );
});

test("deck v3 emits canonical deck states while adapters keep legacy aliases safe", () => {
  for (const reason of ["has_profiles", "event_not_active", "not_registered", "viewer_paused", "no_remaining_profiles"]) {
    assert.match(deckV3Section, new RegExp(reason));
  }
  for (const legacyReason of ["'ready'", "'no_confirmed_candidates'", "'scan_window_exhausted'"]) {
    assert.doesNotMatch(deckV3Section, new RegExp(legacyReason));
  }
  assert.match(deckV3Section, /public\.is_profile_hidden\(p_user_id\)/);
  assert.equal(
    authoritativeDeckV3Section.includes("'has_profiles'"),
    true,
    "the amended authoritative migration and additive overlay should agree on canonical success state",
  );
  assert.match(eventProfileAdapters, /"has_profiles"/);
  assert.match(eventProfileAdapters, /value === "ready"[\s\S]+return "has_profiles"/);
  assert.match(eventProfileAdapters, /value === "no_confirmed_candidates" \|\| value === "scan_window_exhausted"[\s\S]+return "no_remaining_profiles"/);

  assert.equal(
    parseEventDeckResponse({ ok: true, profiles: [], deck_state: { reason: "ready" } }).deckState.reason,
    "has_profiles",
  );
  assert.equal(
    parseEventDeckResponse({ ok: true, profiles: [], deck_state: { reason: "no_confirmed_candidates" } }).deckState.reason,
    "no_remaining_profiles",
  );
  assert.equal(
    parseEventDeckResponse({ ok: true, profiles: [], deck_state: { reason: "scan_window_exhausted" } }).deckState.reason,
    "no_remaining_profiles",
  );
  assert.equal(
    parseEventDeckResponse({ ok: true, profiles: [], deck_state: { reason: "viewer_paused" } }).deckState.reason,
    "viewer_paused",
  );
});

test("Reliability gap closure contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateReliabilityGapClosureContracts\.test\.ts/);
});
