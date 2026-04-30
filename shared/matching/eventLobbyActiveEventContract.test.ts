import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const swipeActions = readFileSync(join(root, "supabase/functions/swipe-actions/index.ts"), "utf8");

const migrationSection = (startMarker: string, endMarker: string): string => {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
};

type EventLobbyFixture = {
  exists?: boolean;
  status?: string | null;
  ended_at?: string | null;
  archived_at?: string | null;
  event_date?: string | null;
  duration_minutes?: number | null;
};

const inactiveReasonForFixture = (
  event: EventLobbyFixture,
  nowMs: number,
): string | null => {
  if (event.exists === false) return "event_not_found";
  if (event.archived_at != null) return "event_archived";
  if ((event.status ?? "") === "cancelled") return "event_cancelled";
  if (event.ended_at != null || ["ended", "completed"].includes(event.status ?? "")) {
    return "event_ended";
  }
  if ((event.status ?? "") !== "live") return "event_not_live";
  if (event.event_date == null) return "event_outside_live_window";

  const startMs = Date.parse(event.event_date);
  const durationMinutes = event.duration_minutes ?? 60;
  const endMs = startMs + durationMinutes * 60 * 1000;
  return nowMs < startMs || nowMs >= endMs ? "event_outside_live_window" : null;
};

test("event lobby active-event migration sorts after applied hardening tail", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501170000"), "test assumes the applied hardening tail is present");
  assert.ok(versions.includes("20260501180000"), "new active-event migration must exist");
  assert.ok(
    versions.indexOf("20260501180000") > versions.indexOf("20260501170000"),
    "new migration must sort strictly after 20260501170000",
  );
});

test("shared helper encodes canonical active event rule and safe reason codes", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_event_lobby_active/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(migration, /v_event\.archived_at IS NOT NULL[\s\S]*RETURN 'event_archived'/);
  assert.match(migration, /v_event\.status[\s\S]*'cancelled'[\s\S]*RETURN 'event_cancelled'/);
  assert.match(migration, /v_event\.ended_at IS NOT NULL[\s\S]*'ended'[\s\S]*'completed'[\s\S]*RETURN 'event_ended'/);
  assert.match(migration, /v_event\.status[\s\S]*<> 'live'[\s\S]*RETURN 'event_not_live'/);
  assert.match(migration, /v_scheduled_end :=[\s\S]*event_date[\s\S]*COALESCE\(v_event\.duration_minutes, 60\) \* interval '1 minute'/);
  assert.match(migration, /v_now < v_event\.event_date OR v_now >= v_scheduled_end[\s\S]*RETURN 'event_outside_live_window'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_event_lobby_inactive_reason\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test("new security definer functions pin a safe search path", () => {
  const functionBlocks = migration.match(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$function\$;/g) ?? [];
  const securityDefinerBlocks = functionBlocks.filter((block) => block.includes("SECURITY DEFINER"));
  assert.ok(securityDefinerBlocks.length >= 7, "expected helper and wrapper SECURITY DEFINER functions");
  for (const block of securityDefinerBlocks) {
    assert.match(block, /SET search_path TO 'public'/);
  }
});

test("active-event taxonomy covers active, pre-start, expired, terminal, archived, cancelled, and null duration cases", () => {
  const nowMs = Date.parse("2026-04-30T20:30:00.000Z");
  const activeBase = {
    status: "live",
    event_date: "2026-04-30T20:00:00.000Z",
    ended_at: null,
    archived_at: null,
  } satisfies EventLobbyFixture;

  assert.equal(
    inactiveReasonForFixture({ ...activeBase, duration_minutes: 60 }, nowMs),
    null,
    "active live-window event should be allowed",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, event_date: "2026-04-30T21:00:00.000Z", duration_minutes: 60 }, nowMs),
    "event_outside_live_window",
    "pre-start live-status event should be blocked",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, event_date: "2026-04-30T19:00:00.000Z", duration_minutes: 60 }, nowMs),
    "event_outside_live_window",
    "expired scheduled window should be blocked",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, ended_at: "2026-04-30T20:10:00.000Z" }, nowMs),
    "event_ended",
    "ended_at should terminally block even during scheduled window",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, archived_at: "2026-04-30T20:10:00.000Z" }, nowMs),
    "event_archived",
    "archived events should be blocked before other lifecycle checks",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, status: "cancelled" }, nowMs),
    "event_cancelled",
    "cancelled events should be blocked",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, duration_minutes: null }, nowMs),
    null,
    "null duration should default to 60 minutes and stay active inside that window",
  );
  assert.equal(
    inactiveReasonForFixture({ ...activeBase, event_date: "2026-04-30T19:00:00.000Z", duration_minutes: null }, nowMs),
    "event_outside_live_window",
    "null duration should default to 60 minutes when computing expiry",
  );
  assert.equal(
    inactiveReasonForFixture({ exists: false }, nowMs),
    "event_not_found",
    "missing event should not be treated as active",
  );
});

test("get_event_deck is gated before candidate query delegation", () => {
  assert.match(migration, /ALTER FUNCTION public\.get_event_deck\(uuid, uuid, integer\)\s+RENAME TO get_event_deck_20260501180000_active_base/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_event_deck_20260501180000_active_base\(uuid, uuid, integer\)[\s\S]*FROM PUBLIC, anon, authenticated/);

  const deck = migrationSection(
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );
  const authIndex = deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id");
  const activeIndex = deck.indexOf("public.get_event_lobby_inactive_reason(p_event_id) IS NOT NULL");
  const delegateIndex = deck.indexOf("public.get_event_deck_20260501180000_active_base");
  assert.ok(authIndex > 0);
  assert.ok(activeIndex > authIndex, "deck auth check should precede active-event gate");
  assert.ok(delegateIndex > activeIndex, "deck active-event gate should precede base delegation");
});

test("handle_swipe rejects inactive events before delegated swipe/session mutation", () => {
  assert.match(migration, /ALTER FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)\s+RENAME TO handle_swipe_20260501180000_active_base/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.handle_swipe_20260501180000_active_base\(uuid, uuid, uuid, text\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /'success', false,[\s\S]*'result', 'event_not_active'[\s\S]*'reason', v_inactive_reason/);
  assert.match(migration, /FOR SHARE OF ev/);

  const swipe = migrationSection(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  const actorAuthIndex = swipe.indexOf("auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id");
  const actorRegIndex = swipe.indexOf("profile_id = p_actor_id");
  const activeIndex = swipe.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);");
  const targetRegIndex = swipe.indexOf("profile_id = p_target_id");
  const delegateIndex = swipe.indexOf("public.handle_swipe_20260501180000_active_base");
  assert.ok(actorAuthIndex > 0);
  assert.ok(actorRegIndex > actorAuthIndex);
  assert.ok(activeIndex > actorRegIndex, "swipe registration checks should be preserved before active-event gate");
  assert.ok(targetRegIndex > activeIndex, "swipe target lookup should not happen before the inactive-event response");
  assert.ok(delegateIndex > activeIndex, "swipe active-event gate should precede base delegation");
});

test("find_mystery_match rejects inactive events before Ready Gate session creation", () => {
  assert.match(migration, /ALTER FUNCTION public\.find_mystery_match\(uuid, uuid\)\s+RENAME TO find_mystery_match_20260501180000_active_base/);
  assert.match(migration, /'error', 'event_not_active'[\s\S]*'terminal', true/);

  const mystery = migrationSection(
    "CREATE OR REPLACE FUNCTION public.find_mystery_match",
    "COMMENT ON FUNCTION public.find_mystery_match",
  );
  const activeIndex = mystery.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);");
  const delegateIndex = mystery.indexOf("public.find_mystery_match_20260501180000_active_base");
  assert.ok(activeIndex > 0);
  assert.ok(delegateIndex > activeIndex, "mystery active-event gate should precede base delegation");
});

test("queue promotion and drain preserve event_not_valid reason while blocking inactive promotion", () => {
  assert.match(migration, /ALTER FUNCTION public\.promote_ready_gate_if_eligible\(uuid, uuid\)\s+RENAME TO promote_ready_gate_if_eligible_20260501180000_active_base/);
  assert.match(migration, /ALTER FUNCTION public\.drain_match_queue\(uuid\)\s+RENAME TO drain_match_queue_20260501180000_active_base/);
  assert.match(migration, /'promote_ready_gate_if_eligible'[\s\S]*'blocked'[\s\S]*'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
  assert.match(migration, /'drain_match_queue'[\s\S]*'blocked'[\s\S]*'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
  assert.match(migration, /RETURN jsonb_build_object\([\s\S]*'found', false,[\s\S]*'reason', 'event_not_valid'/);

  const promote = migrationSection(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );
  const promoteServiceRoleIndex = promote.indexOf("v_is_service_role boolean := auth.role() = 'service_role'");
  const promoteAuthIndex = promote.indexOf("IF NOT v_is_service_role");
  const promoteRegistrationIndex = promote.indexOf("actor_registration_guard");
  const promoteActiveIndex = promote.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);");
  const promoteDelegateIndex = promote.indexOf("public.promote_ready_gate_if_eligible_20260501180000_active_base");
  assert.ok(promoteServiceRoleIndex > 0);
  assert.ok(promoteAuthIndex > 0);
  assert.match(promote, /'promoted', false,[\s\S]*'reason', 'unauthorized'/);
  assert.ok(promoteRegistrationIndex > promoteAuthIndex);
  assert.ok(promoteActiveIndex > 0);
  assert.ok(promoteActiveIndex > promoteRegistrationIndex, "promotion eligibility check should precede inactive reason details");
  assert.ok(promoteDelegateIndex > promoteActiveIndex);

  const drain = migrationSection(
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "COMMENT ON FUNCTION public.drain_match_queue",
  );
  const drainActiveIndex = drain.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);");
  const drainRegistrationIndex = drain.indexOf("actor_registration_guard");
  const drainDelegateIndex = drain.indexOf("public.drain_match_queue_20260501180000_active_base");
  assert.ok(drainRegistrationIndex > 0);
  assert.ok(drainActiveIndex > 0);
  assert.ok(drainActiveIndex > drainRegistrationIndex, "drain participant check should precede inactive reason details");
  assert.ok(drainDelegateIndex > drainActiveIndex);
});

test("nonparticipants do not receive detailed inactive reason before auth or eligibility checks", () => {
  const deck = migrationSection(
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );
  assert.ok(
    deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id") <
      deck.indexOf("public.get_event_lobby_inactive_reason(p_event_id) IS NOT NULL"),
    "deck should authenticate the requested viewer before inactive lookup",
  );

  const swipe = migrationSection(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  assert.ok(
    swipe.indexOf("profile_id = p_actor_id") <
      swipe.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);"),
    "swipe should establish actor registration before inactive reason details",
  );

  const mystery = migrationSection(
    "CREATE OR REPLACE FUNCTION public.find_mystery_match",
    "COMMENT ON FUNCTION public.find_mystery_match",
  );
  assert.ok(
    mystery.indexOf("profile_id = p_user_id") <
      mystery.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);"),
    "mystery match should establish registration before inactive reason details",
  );

  const promote = migrationSection(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );
  assert.ok(
    promote.indexOf("actor_registration_guard") <
      promote.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);"),
    "direct promotion should establish registration before inactive reason details",
  );

  const drain = migrationSection(
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "COMMENT ON FUNCTION public.drain_match_queue",
  );
  assert.ok(
    drain.indexOf("actor_registration_guard") <
      drain.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);"),
    "drain should establish registration before inactive reason details",
  );
});

test("happy drain path remains a direct delegation after active-event checks", () => {
  const drain = migrationSection(
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "COMMENT ON FUNCTION public.drain_match_queue",
  );
  const unauthorizedIndex = drain.indexOf("v_uid IS NULL");
  const registrationIndex = drain.indexOf("actor_registration_guard");
  const activeIndex = drain.indexOf("v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);");
  const lockIndex = drain.indexOf("FOR SHARE OF ev");
  const delegateIndex = drain.indexOf("RETURN public.drain_match_queue_20260501180000_active_base(p_event_id);");

  assert.ok(unauthorizedIndex > 0);
  assert.ok(registrationIndex > unauthorizedIndex);
  assert.ok(activeIndex > registrationIndex);
  assert.ok(lockIndex > activeIndex);
  assert.ok(delegateIndex > lockIndex);
  assert.doesNotMatch(
    drain.slice(delegateIndex),
    /jsonb_build_object\(/,
    "successful drain result should come from the preserved base implementation unchanged",
  );
});

test("inactive swipe outcomes do not trigger swipe-actions notifications", () => {
  assert.match(swipeActions, /if \(result\.result === "match" && sessionId\)/);
  assert.match(swipeActions, /else if \(result\.result === "match_queued" && sessionId\)/);
  assert.match(swipeActions, /result\.result === "super_vibe_sent"/);
  assert.match(swipeActions, /result\.result === "vibe_recorded"/);
  assert.doesNotMatch(swipeActions, /event_not_active[\s\S]{0,300}send-notification/);
});
