import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/event_lobby_ready_queue_contract.sql");
const stream8Migration = read("supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql");
const mutualSessionBase = read("supabase/migrations/20260501092000_handle_swipe_presence_and_already_matched_session.sql");
const activeEventMigration = read("supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql");
const encounterSurveyMigration = read("supabase/migrations/20260503090000_video_date_encounter_survey_and_pair_guard.sql");
const readyQueueDoc = read("docs/contracts/event-lobby-ready-queue-contract.md");
const verificationDoc = read("docs/audits/event-lobby-ready-queue-contract-verification.md");
const webLobbyCard = read("src/components/lobby/LobbyProfileCard.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
}

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

test("Ready/queue migration exists after prior Event Lobby streams", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  for (const version of ["20260501223000", "20260501224000", "20260501225000"]) {
    assert.ok(versions.includes(version), `${version} should be present`);
  }
  assert.ok(
    versions.indexOf("20260501225000") > versions.indexOf("20260501224000"),
    "Ready/queue contract migration must sort after swipe idempotency",
  );
});

test("get_event_deck keeps active-event rejection and hides busy in-session candidates", () => {
  const deck = section(
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );

  assert.match(deck, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(deck, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(deck, /RAISE EXCEPTION 'event_not_active'/);
  assert.match(deck, /public\.get_event_deck_20260501180000_active_base/);
  assert.match(deck, /COALESCE\(deck\.queue_status, 'idle'\) IN \('browsing', 'idle'\)/);
  assert.match(deck, /vs\.ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(deck, /vs\.state IN \('handshake', 'date'\)/);
  assert.match(deck, /vs\.phase IN \('handshake', 'date'\)/);
  assert.match(deck, /vs\.handshake_started_at IS NOT NULL/);
  assert.match(deck, /vs\.date_started_at IS NOT NULL/);
  assert.match(encounterSurveyMigration, /AND NOT public\.video_date_pair_has_terminal_encounter\(p_event_id, p_user_id, base\.profile_id\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO anon/);
});

test("busy queue statuses are not normal swipeable deck states", () => {
  const allowedDeckStatuses = new Set(["browsing", "idle"]);
  for (const status of ["in_ready_gate", "in_handshake", "in_date", "in_survey", "offline", "searching"]) {
    assert.equal(allowedDeckStatuses.has(status), false, `${status} should not be a normal deck state`);
  }
  assert.match(readyQueueDoc, /\| `in_ready_gate` \| Hide from backend deck/);
  assert.match(readyQueueDoc, /\| `in_handshake` \| Hide from backend deck/);
  assert.match(readyQueueDoc, /\| `in_date` \| Hide from backend deck/);
  assert.match(readyQueueDoc, /\| `in_survey` \| Hide from backend deck/);
  assert.match(readyQueueDoc, /\| `offline` \| Hide from backend deck/);
});

test("handle_swipe rejects active-session conflicts before swipes or delegated side effects", () => {
  const swipe = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  const conflictIndex = swipe.indexOf("pre_swipe_active_session_guard");
  const existingSwipeIndex = swipe.indexOf("FROM public.event_swipes es");
  const delegateIndex = swipe.indexOf("public.handle_swipe_20260501210000_idempotency_base");

  assert.ok(conflictIndex > 0, "direct swipe conflict guard should be present");
  assert.ok(existingSwipeIndex > conflictIndex, "conflict guard must run before reading/persisting swipe state");
  assert.ok(delegateIndex > conflictIndex, "conflict guard must run before delegated mutation");
  assert.match(swipe, /event_lobby_participant_session:/);
  assert.match(swipe, /z\.ended_at IS NULL/);
  assert.match(swipe, /NOT \(\s*z\.participant_1_id = LEAST\(p_actor_id, p_target_id\)/);
  assert.match(swipe, /z\.participant_1_id IN \(p_actor_id, p_target_id\)/);
  assert.match(swipe, /'outcome', 'participant_has_active_session_conflict'/);
  assert.match(swipe, /'notification_suppressed', true/);
  assert.match(swipe, /'dedupe_reason', 'active_session_conflict'/);
});

test("handle_swipe preserves retry and first-time outcome compatibility", () => {
  const swipe = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  assert.match(swipe, /'outcome', 'already_swiped'[\s\S]*'result', 'already_swiped'/);
  assert.match(swipe, /'outcome', 'already_matched'[\s\S]*'result', 'already_matched'/);
  assert.match(swipe, /'outcome', 'swipe_already_recorded'[\s\S]*'result', 'swipe_already_recorded'/);
  assert.match(swipe, /'outcome', 'event_not_active'[\s\S]*'result', 'event_not_active'/);
  assert.match(swipe, /RETURN public\.handle_swipe_20260501210000_idempotency_base\(/);
  for (const outcome of [
    "pass_recorded",
    "vibe_recorded",
    "super_vibe_sent",
    "match",
    "match_queued",
    "already_matched",
    "limit_reached",
    "already_super_vibed_recently",
    "participant_has_active_session_conflict",
  ]) {
    assert.match(mutualSessionBase, new RegExp(`'result', '${outcome}'`));
  }
  assert.match(stream8Migration, /'outcome', 'already_swiped'/);
});

test("participant advisory locks protect simultaneous cross-pair session creation", () => {
  const swipe = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  const promote = section(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );

  assert.match(swipe, /LEAST\(p_actor_id, p_target_id\)::text/);
  assert.match(swipe, /GREATEST\(p_actor_id, p_target_id\)::text/);
  assert.match(promote, /LEAST\(p_uid, v_partner_id\)::text/);
  assert.match(promote, /GREATEST\(p_uid, v_partner_id\)::text/);
  assert.match(mutualSessionBase, /handle_swipe_mutual_pair:/);
  assert.match(mutualSessionBase, /ON CONFLICT \(event_id, participant_1_id, participant_2_id\) DO NOTHING/);
});

test("queue promotion blocks inactive events and active-session collisions before promotion", () => {
  const promote = section(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );

  const activeIndex = promote.indexOf("public.get_event_lobby_active_state(p_event_id, now())");
  const conflictIndex = promote.indexOf("pre_promotion_active_session_guard");
  const delegateIndex = promote.indexOf("public.promote_ready_gate_if_eligible_20260501180000_active_base");

  assert.ok(activeIndex > 0, "active-event guard should be present");
  assert.ok(conflictIndex > activeIndex, "promotion conflict guard should run after active-event validation");
  assert.ok(delegateIndex > conflictIndex, "delegated promotion should be behind conflict guard");
  assert.match(promote, /vs\.ready_gate_status = 'queued'/);
  assert.match(promote, /z\.id <> v_match_id/);
  assert.match(promote, /z\.ended_at IS NULL/);
  assert.match(promote, /'reason', 'participant_has_active_session_conflict'/);
  assert.match(activeEventMigration, /'reason', 'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
});

test("drain_match_queue remains backend-owned and routes through public promotion guard", () => {
  assert.match(migration, /COMMENT ON FUNCTION public\.drain_match_queue\(uuid\) IS[\s\S]*delegates promotion through promote_ready_gate_if_eligible participant-lock and conflict guards/);
  assert.match(activeEventMigration, /RETURN public\.drain_match_queue_20260501180000_active_base\(p_event_id\)/);
  assert.match(read("supabase/migrations/20260417120300_drain_match_queue_promotion.sql"), /public\.promote_ready_gate_if_eligible\(p_event_id, v_uid\)/);
});

test("web and native card badges are now informational because backend deck hides busy normal targets", () => {
  assert.match(webLobbyCard, /queue_status/);
  assert.match(webLobbyCard, /In session/);
  assert.match(nativeLobby, /queue_status/);
  assert.match(nativeLobby, /In session/);
  assert.match(readyQueueDoc, /Clients may keep informational busy badges/);
});

test("contract docs cover Ready Gate, queued-match, and one-active-session expectations", () => {
  for (const phrase of [
    "immediate match",
    "queued match",
    "already matched",
    "active-session conflict",
    "partner unavailable",
    "ready gate ready",
    "skip",
    "snooze",
    "expire",
    "both-ready",
    "return-from-date",
    "queue drain",
    "one-active-session invariant",
    "web/native ui expectations",
  ]) {
    assert.match(readyQueueDoc.toLowerCase(), new RegExp(phrase));
  }
  assert.match(verificationDoc, /Supabase project ref: `schdyxcunwcvddlcshwd`/);
  assert.match(verificationDoc, /Remote migration parity: local and remote were in parity through `20260501224000`/);
  assert.match(verificationDoc, /Rebuild Delta/);
});

test("production validation is read-only catalog verification", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /event_lobby_participant_session:/);
  assert.match(validation, /pre_swipe_active_session_guard/);
  assert.match(validation, /pre_promotion_active_session_guard/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
});
