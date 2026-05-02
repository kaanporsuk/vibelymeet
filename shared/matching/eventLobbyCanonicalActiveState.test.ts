import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260502083000_event_lobby_scheduled_activation.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const deckPayloadMigration = readFileSync(
  join(root, "supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql"),
  "utf8",
);
const validation = readFileSync(join(root, "supabase/validation/event_lobby_active_event_contract.sql"), "utf8");
const swipeActions = readFileSync(join(root, "supabase/functions/swipe-actions/index.ts"), "utf8");

type EventFixture = {
  exists?: boolean;
  status?: string | null;
  ended_at?: string | null;
  archived_at?: string | null;
  event_date?: string | null;
  duration_minutes?: number | null;
};

function activeStateForFixture(event: EventFixture, nowMs: number) {
  if (event.exists === false) return { is_active: false, reason: "event_not_found" };
  const status = event.status && event.status.length > 0 ? event.status : "upcoming";
  if (status === "draft") return { is_active: false, reason: "event_draft" };
  if (status === "cancelled") return { is_active: false, reason: "event_cancelled" };
  if (event.archived_at != null || status === "archived") return { is_active: false, reason: "event_archived" };
  if (event.ended_at != null || ["ended", "completed"].includes(status)) {
    return { is_active: false, reason: "event_ended" };
  }
  if (!["upcoming", "live"].includes(status)) return { is_active: false, reason: "event_not_live" };
  if (event.event_date == null) return { is_active: false, reason: "event_outside_live_window" };

  const startMs = Date.parse(event.event_date);
  if (nowMs < startMs) return { is_active: false, reason: "event_not_started" };

  const endMs = startMs + (event.duration_minutes ?? 60) * 60 * 1000;
  if (nowMs >= endMs) return { is_active: false, reason: "event_outside_live_window" };
  return { is_active: true, reason: null };
}

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
}

function sectionFrom(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`);
  const end = content.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`);
  return content.slice(start, end);
}

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

test("canonical active-state migration sorts after the latest applied local migration", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501230000"), "test assumes Event Lobby deck payload tail is present");
  assert.ok(versions.includes("20260502083000"), "scheduled activation migration must exist");
  assert.ok(
    versions.indexOf("20260502083000") > versions.indexOf("20260501230000"),
    "new migration must sort strictly after the current local/remote tail",
  );
});

test("canonical helper exposes active boolean, reason, and event status with safe grants", () => {
  const helper = section(
    "CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state",
    "COMMENT ON FUNCTION public.get_event_lobby_active_state",
  );

  assert.match(helper, /RETURNS TABLE\(\s*is_active boolean,\s*reason text,\s*event_status text\s*\)/);
  assert.match(helper, /p_now timestamptz DEFAULT now\(\)/);
  assert.match(helper, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(helper, /v_status NOT IN \('upcoming', 'live'\)/);
  assert.doesNotMatch(helper, /v_status <> 'live'/);
  for (const reason of [
    "event_not_found",
    "event_draft",
    "event_cancelled",
    "event_archived",
    "event_ended",
    "event_not_live",
    "event_not_started",
    "event_outside_live_window",
  ]) {
    assert.match(helper, new RegExp(reason));
  }
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_event_lobby_active_state\(uuid, timestamptz\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_event_lobby_active_state\(uuid, timestamptz\)[\s\S]*TO service_role/);
});

test("active-state taxonomy covers required live, missing, scheduled, terminal, and non-live cases", () => {
  const nowMs = Date.parse("2026-05-01T21:00:00.000Z");
  const live = {
    status: "live",
    event_date: "2026-05-01T20:30:00.000Z",
    duration_minutes: 60,
    ended_at: null,
    archived_at: null,
  } satisfies EventFixture;

  assert.deepEqual(activeStateForFixture({ exists: false }, nowMs), {
    is_active: false,
    reason: "event_not_found",
  });
  assert.deepEqual(activeStateForFixture({ ...live }, nowMs), { is_active: true, reason: null });
  assert.deepEqual(activeStateForFixture({ ...live, status: "upcoming" }, nowMs), {
    is_active: true,
    reason: null,
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: null }, nowMs), {
    is_active: true,
    reason: null,
  });
  assert.deepEqual(activeStateForFixture({ ...live, event_date: "2026-05-01T21:30:00.000Z" }, nowMs), {
    is_active: false,
    reason: "event_not_started",
  });
  assert.deepEqual(activeStateForFixture({ ...live, event_date: "2026-05-01T19:30:00.000Z" }, nowMs), {
    is_active: false,
    reason: "event_outside_live_window",
  });
  assert.deepEqual(activeStateForFixture({ ...live, ended_at: "2026-05-01T20:45:00.000Z" }, nowMs), {
    is_active: false,
    reason: "event_ended",
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: "cancelled" }, nowMs), {
    is_active: false,
    reason: "event_cancelled",
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: "draft" }, nowMs), {
    is_active: false,
    reason: "event_draft",
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: "paused" }, nowMs), {
    is_active: false,
    reason: "event_not_live",
  });
  assert.deepEqual(activeStateForFixture({ ...live, archived_at: "2026-05-01T20:45:00.000Z" }, nowMs), {
    is_active: false,
    reason: "event_archived",
  });
});

test("compatibility helpers delegate to canonical active state", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.match(migration, /SELECT state\.reason[\s\S]*public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_event_lobby_active/);
  assert.match(migration, /SELECT COALESCE\(state\.is_active, false\)[\s\S]*public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
});

test("get_event_deck authenticates first and rejects inactive events explicitly", () => {
  const deck = sectionFrom(
    deckPayloadMigration,
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );
  const authIndex = deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id");
  const activeIndex = deck.indexOf("public.get_event_lobby_active_state(p_event_id, now())");
  const raiseIndex = deck.indexOf("RAISE EXCEPTION 'event_not_active'");
  const delegateIndex = deck.indexOf("public.get_event_deck_20260501180000_active_base");

  assert.ok(authIndex > 0);
  assert.ok(activeIndex > authIndex, "deck auth must precede active-state lookup");
  assert.ok(raiseIndex > activeIndex, "deck must explicitly reject inactive events");
  assert.ok(delegateIndex > raiseIndex, "deck must not delegate before active rejection");
});

test("handle_swipe rejects inactive events before every mutation or notification-triggering branch", () => {
  const swipe = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  const idempotencyBase = section(
    "CREATE OR REPLACE FUNCTION public.handle_swipe_20260501210000_idempotency_base",
    "REVOKE ALL ON FUNCTION public.handle_swipe_20260501210000_idempotency_base",
  );
  const actorAuthIndex = swipe.indexOf("auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id");
  const actorRegIndex = swipe.indexOf("profile_id = p_actor_id");
  const activeIndex = swipe.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const delegateIndex = swipe.indexOf("public.handle_swipe_20260502083000_ready_queue_base");

  assert.ok(actorAuthIndex > 0);
  assert.ok(actorRegIndex > actorAuthIndex);
  assert.ok(activeIndex > actorRegIndex, "inactive reason details require actor registration first");
  assert.ok(delegateIndex > activeIndex, "delegated mutation path must be behind active guard");
  assert.match(swipe, /'success', false,[\s\S]*'outcome', 'event_not_active'[\s\S]*'reason', v_inactive_reason/);
  assert.doesNotMatch(swipe.slice(0, activeIndex), /\bevent_swipes\b|\bvideo_sessions\b|current_room_id|current_partner_id/);
  assert.match(idempotencyBase, /public\.lock_event_lobby_scheduled_active_state\(p_event_id, now\(\)\)/);
  assert.match(idempotencyBase, /FROM public\.event_swipes es/);
  assert.match(idempotencyBase, /FROM public\.video_sessions vs/);
  assert.doesNotMatch(idempotencyBase, /ev\.status = 'live'/);
});

test("find_mystery_match rejects inactive events before session creation", () => {
  const mystery = section(
    "CREATE OR REPLACE FUNCTION public.find_mystery_match",
    "COMMENT ON FUNCTION public.find_mystery_match",
  );
  const registrationIndex = mystery.indexOf("profile_id = p_user_id");
  const activeIndex = mystery.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const delegateIndex = mystery.indexOf("public.find_mystery_match_20260502083000_active_base");

  assert.ok(activeIndex > registrationIndex);
  assert.ok(delegateIndex > activeIndex, "mystery base session creation must be behind active guard");
  assert.match(mystery, /'error', 'event_not_active'[\s\S]*'terminal', true/);
});

test("queue promotion and drain block inactive events before promotion delegation", () => {
  const promote = section(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );
  const drain = section(
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "COMMENT ON FUNCTION public.drain_match_queue",
  );

  const promoteRegistrationIndex = promote.indexOf("actor_registration_guard");
  const promoteActiveIndex = promote.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const promoteDelegateIndex = promote.indexOf("public.promote_ready_gate_if_eligible_20260502083000_ready_queue_base");
  const promoteBase = section(
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible_20260501180000_active_base",
    "REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible_20260501180000_active_base",
  );
  assert.ok(promoteActiveIndex > promoteRegistrationIndex);
  assert.ok(promoteDelegateIndex > promoteActiveIndex);
  assert.match(promote, /'reason', 'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
  assert.match(promoteBase, /public\.lock_event_lobby_scheduled_active_state\(p_event_id, now\(\)\)/);
  assert.doesNotMatch(promoteBase, /\be\.status = 'live'/);

  const drainRegistrationIndex = drain.indexOf("actor_registration_guard");
  const drainActiveIndex = drain.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const drainDelegateIndex = drain.indexOf("public.drain_match_queue_20260502083000_active_base");
  assert.ok(drainActiveIndex > drainRegistrationIndex);
  assert.ok(drainDelegateIndex > drainActiveIndex);
  assert.match(drain, /'found', false,[\s\S]*'reason', 'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
});

test("legacy direct session creation surfaces are deprecated rather than bypasses", () => {
  const legacyMigration = readFileSync(
    join(root, "supabase/migrations/20260412143000_phase3_legacy_queue_contract_cleanup.sql"),
    "utf8",
  );
  const joinQueue = sectionFrom(
    legacyMigration,
    "CREATE OR REPLACE FUNCTION public.join_matching_queue",
    "CREATE OR REPLACE FUNCTION public.find_video_date_match",
  );
  const findMatch = sectionFrom(
    legacyMigration,
    "CREATE OR REPLACE FUNCTION public.find_video_date_match",
    "-- 4) Keep leave_matching_queue",
  );

  assert.match(joinQueue, /deprecated_legacy_queue_surface/);
  assert.match(findMatch, /deprecated_legacy_queue_surface/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(joinQueue), /INSERT\s+INTO\s+public\.video_sessions/i);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(findMatch), /INSERT\s+INTO\s+public\.video_sessions/i);
});

test("swipe-actions suppresses inactive-event notification side effects", () => {
  assert.match(swipeActions, /"event_not_active"/);
  assert.match(swipeActions, /result\.notification_suppressed === true/);
  assert.doesNotMatch(swipeActions, /event_not_active[\s\S]{0,300}send-notification/);
});

test("production validation is read-only and checks canonical active-state markers", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /get_event_lobby_active_state/);
  assert.match(validation, /v_status NOT IN \(''upcoming'', ''live''\)/);
  assert.match(validation, /lock_event_lobby_scheduled_active_state/);
  assert.match(validation, /handle_swipe_20260502083000_ready_queue_base/);
  assert.match(validation, /find_mystery_match_20260502083000_active_base/);
  assert.match(validation, /RAISE EXCEPTION ''event_not_active''/);
  assert.match(validation, /legacy_direct_session_paths_deprecated/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
});
