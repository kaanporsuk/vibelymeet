import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/event_lobby_ready_queue_contract.sql");
const stream8Migration = read("supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql");
const activeEventMigration = read("supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql");
const queuedBrowseRepairMigration = read("supabase/migrations/20260505220000_event_lobby_browse_while_queued_repair.sql");
const promotionLockOrderRepairMigration = read("supabase/migrations/20260505223000_ready_gate_promotion_lock_order_repair.sql");
const readyQueueDoc = read("docs/contracts/event-lobby-ready-queue-contract.md");
const verificationDoc = read("docs/audits/event-lobby-ready-queue-contract-verification.md");
const webLobbyCard = read("src/components/lobby/LobbyProfileCard.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function queuedBrowseSection(startMarker: string, endMarker: string): string {
  return sectionFrom(queuedBrowseRepairMigration, startMarker, endMarker);
}

function promotionLockOrderSection(startMarker: string, endMarker: string): string {
  return sectionFrom(promotionLockOrderRepairMigration, startMarker, endMarker);
}

function sectionFrom(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return source.slice(start, end);
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

  for (const version of ["20260501223000", "20260501224000", "20260501225000", "20260505220000", "20260505223000"]) {
    assert.ok(versions.includes(version), `${version} should be present`);
  }
  assert.ok(
    versions.indexOf("20260501225000") > versions.indexOf("20260501224000"),
    "Ready/queue contract migration must sort after swipe idempotency",
  );
  assert.ok(
    versions.indexOf("20260505220000") > versions.indexOf("20260505214500"),
    "Queued-browse repair must sort after the latest Ready Gate hardening",
  );
  assert.ok(
    versions.indexOf("20260505223000") > versions.indexOf("20260505220000"),
    "Promotion lock-order repair must sort after queued-browse repair",
  );
});

test("queued-browse repair defines queued sessions as non-blocking", () => {
  assert.match(queuedBrowseRepairMigration, /CREATE OR REPLACE FUNCTION public\.event_lobby_video_session_blocks_new_match/);
  assert.match(queuedBrowseRepairMigration, /COALESCE\(p_ready_gate_status, ''\) <> 'queued'/);
  assert.match(queuedBrowseRepairMigration, /p_ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(queuedBrowseRepairMigration, /p_state IN \('handshake', 'date'\)/);
  assert.match(queuedBrowseRepairMigration, /p_phase IN \('handshake', 'date'\)/);
  assert.doesNotMatch(queuedBrowseRepairMigration, /p_phase IN \('ready_gate'/);
  assert.match(queuedBrowseRepairMigration, /Queued sessions are browseable/);
});

test("queued-browse swipe path records while queued and defers additional mutuals", () => {
  const swipeStart = queuedBrowseRepairMigration.indexOf("CREATE OR REPLACE FUNCTION public.handle_swipe");
  const swipeEnd = queuedBrowseRepairMigration.indexOf("COMMENT ON FUNCTION public.handle_swipe", swipeStart);
  const swipe = queuedBrowseRepairMigration.slice(swipeStart, swipeEnd);

  assert.match(swipe, /event_lobby_video_session_blocks_new_match/);
  assert.match(swipe, /v_has_queued_session boolean := false/);
  assert.match(swipe, /v_create_queued := v_has_queued_session OR NOT \(v_actor_present AND v_target_present\)/);
  assert.match(swipe, /CASE WHEN v_create_queued THEN 'queued' ELSE 'ready' END/);
  assert.match(swipe, /'outcome', 'match_queued'[\s\S]*'ready_gate_status', 'queued'/);
  assert.match(swipe, /'outcome', 'pass_recorded'[\s\S]*'result', 'pass_recorded'/);
  assert.match(swipe, /'outcome', 'vibe_recorded'[\s\S]*'result', 'vibe_recorded'/);
  assert.match(swipe, /'outcome', 'pair_already_met_this_event'[\s\S]*'message', 'You already met this person in this event/);
});

test("queued-browse promotion ignores other queued rows but keeps true active conflicts", () => {
  const promoteStart = queuedBrowseRepairMigration.indexOf("CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible");
  const promoteEnd = queuedBrowseRepairMigration.indexOf("COMMENT ON FUNCTION public.promote_ready_gate_if_eligible", promoteStart);
  const promote = queuedBrowseRepairMigration.slice(promoteStart, promoteEnd);

  assert.match(promote, /ORDER BY vs\.started_at ASC NULLS LAST, vs\.id ASC/);
  assert.match(promote, /FOR UPDATE OF vs SKIP LOCKED/);
  assert.match(promote, /public\.video_date_pair_has_terminal_encounter\(p_event_id, p_uid, v_partner_id, v_match\.id\)/);
  assert.match(promote, /public\.event_lobby_video_session_blocks_new_match/);
  assert.match(promote, /z\.ended_at\s*\)/);
  assert.match(promote, /'step', 'pre_promotion_active_session_guard'/);
  assert.doesNotMatch(promote, /AND\s+z\.ended_at IS NULL[\s\S]{0,500}public\.event_lobby_video_session_blocks_new_match/);
});

test("promotion lock-order repair takes participant advisory locks before row locks", () => {
  const promote = promotionLockOrderSection(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );

  const candidateIndex = promote.indexOf("SELECT vs.id, vs.participant_1_id, vs.participant_2_id");
  const advisoryIndex = promote.indexOf("PERFORM pg_advisory_xact_lock", candidateIndex);
  const rowLockIndex = promote.indexOf("FOR UPDATE OF vs;", advisoryIndex);
  const delegateIndex = promote.indexOf("promote_ready_gate_if_eligible_20260505223000_lock_order_base", rowLockIndex);

  assert.ok(candidateIndex > 0, "FIFO candidate selection should be present");
  assert.ok(advisoryIndex > candidateIndex, "participant advisory locks should follow candidate selection");
  assert.ok(rowLockIndex > advisoryIndex, "video_sessions row lock must happen after advisory locks");
  assert.ok(delegateIndex > rowLockIndex, "delegated promotion body must run after lock-order revalidation");
  assert.doesNotMatch(promote.slice(candidateIndex, advisoryIndex), /FOR UPDATE OF vs/);
  assert.match(promote, /ORDER BY vs\.started_at ASC NULLS LAST, vs\.id ASC/);
  assert.match(promote, /\(vs\.participant_1_id = p_uid AND vs\.participant_2_id = v_partner_id\)/);
  assert.match(promote, /\(vs\.participant_1_id = v_partner_id AND vs\.participant_2_id = p_uid\)/);
  assert.match(promote, /'reason', 'session_not_promotable'/);
  assert.match(
    promotionLockOrderRepairMigration,
    /Promotes queued Ready Gate matches with participant advisory locks acquired before video_sessions row locks/,
  );
});

test("get_event_deck keeps active-event rejection and hides busy in-session candidates", () => {
  const deck = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );

  assert.match(deck, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(deck, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(deck, /RAISE EXCEPTION 'event_not_active'/);
  assert.match(deck, /public\.get_event_deck_20260501180000_active_base/);
  assert.match(deck, /COALESCE\(base\.queue_status, 'idle'\) IN \('browsing', 'idle'\)/);
  assert.match(deck, /AND NOT public\.video_date_pair_has_terminal_encounter\(p_event_id, p_user_id, base\.profile_id\)/);
  assert.match(deck, /public\.event_lobby_video_session_blocks_new_match\(\s*vs\.ready_gate_status,\s*vs\.state::text,\s*vs\.phase,\s*vs\.handshake_started_at,\s*vs\.date_started_at,\s*vs\.ended_at\s*\)/);
  assert.match(queuedBrowseRepairMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(queuedBrowseRepairMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO anon/);
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

test("handle_swipe rejects active-session conflicts before swipe persistence", () => {
  const swipe = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  const conflictIndex = swipe.indexOf("pre_swipe_active_session_guard");
  const idempotencyLockIndex = swipe.indexOf("handle_swipe_idempotency:");
  const existingSwipeIndex = swipe.indexOf("FROM public.event_swipes es");
  const insertSwipeIndex = swipe.indexOf("INSERT INTO public.event_swipes");

  assert.ok(conflictIndex > 0, "direct swipe conflict guard should be present");
  assert.ok(idempotencyLockIndex > conflictIndex, "conflict guard must run before swipe idempotency lock");
  assert.ok(existingSwipeIndex > conflictIndex, "conflict guard must run before reading/persisting swipe state");
  assert.ok(insertSwipeIndex > conflictIndex, "conflict guard must run before persisting swipe state");
  assert.match(swipe, /event_lobby_participant_session:/);
  assert.match(swipe, /public\.event_lobby_video_session_blocks_new_match/);
  assert.match(swipe, /NOT \(\s*z\.participant_1_id = LEAST\(p_actor_id, p_target_id\)/);
  assert.match(swipe, /z\.participant_1_id = p_actor_id OR z\.participant_2_id = p_actor_id/);
  assert.match(swipe, /z\.participant_1_id = p_target_id OR z\.participant_2_id = p_target_id/);
  assert.match(swipe, /'outcome', 'participant_has_active_session_conflict'/);
  assert.match(swipe, /'notification_suppressed', true/);
  assert.match(swipe, /'dedupe_reason', 'active_session_conflict'/);
});

test("handle_swipe preserves retry and first-time outcome compatibility", () => {
  const swipe = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  assert.match(swipe, /'outcome', 'already_swiped'[\s\S]*'result', 'already_swiped'/);
  assert.match(swipe, /'outcome', 'already_matched'[\s\S]*'result', 'already_matched'/);
  assert.match(swipe, /'outcome', 'swipe_already_recorded'[\s\S]*'result', 'swipe_already_recorded'/);
  assert.match(swipe, /'outcome', 'event_not_active'[\s\S]*'result', 'event_not_active'/);
  assert.match(swipe, /FOR UPDATE/);
  assert.match(swipe, /ON CONFLICT \(event_id, actor_id, target_id\) DO NOTHING/);
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
    assert.match(swipe, new RegExp(`'result', '${outcome}'`));
  }
  assert.match(stream8Migration, /'outcome', 'already_swiped'/);
});

test("participant advisory locks protect simultaneous cross-pair session creation", () => {
  const swipe = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  const promote = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );

  assert.match(swipe, /LEAST\(p_actor_id, p_target_id\)::text/);
  assert.match(swipe, /GREATEST\(p_actor_id, p_target_id\)::text/);
  assert.match(promote, /LEAST\(p_uid, v_partner_id\)::text/);
  assert.match(promote, /GREATEST\(p_uid, v_partner_id\)::text/);
  assert.match(swipe, /handle_swipe_mutual_pair:/);
  assert.match(swipe, /ON CONFLICT \(event_id, participant_1_id, participant_2_id\) DO NOTHING/);
});

test("queue promotion blocks inactive events and active-session collisions before promotion", () => {
  const promote = queuedBrowseSection(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );

  const activeIndex = promote.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const conflictIndex = promote.indexOf("pre_promotion_active_session_guard");
  const promotionIndex = promote.indexOf("ready_gate_status = 'ready'");

  assert.ok(activeIndex > 0, "active-event guard should be present");
  assert.ok(conflictIndex > activeIndex, "promotion conflict guard should run after active-event validation");
  assert.ok(promotionIndex > conflictIndex, "session promotion must be behind conflict guard");
  assert.match(promote, /vs\.ready_gate_status = 'queued'/);
  assert.match(promote, /z\.id <> v_match\.id/);
  assert.match(promote, /public\.event_lobby_video_session_blocks_new_match/);
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
