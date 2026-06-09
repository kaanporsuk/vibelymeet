import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260601143000_event_creation_status_bulletproofing.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const scheduledActivationMigration = readFileSync(
  join(root, "supabase/migrations/20260502083000_event_lobby_scheduled_activation.sql"),
  "utf8",
);
const compatibilityMigration = readFileSync(
  join(root, "supabase/migrations/20260502130000_event_lifecycle_consistency.sql"),
  "utf8",
);
const deckPayloadMigration = readFileSync(
  join(root, "supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql"),
  "utf8",
);
const deckV3Migration = readFileSync(
  join(root, "supabase/migrations/20260602231752_ready_gate_57014_reliability_fix.sql"),
  "utf8",
);
const readyQueueMigration = readFileSync(
  join(root, "supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql"),
  "utf8",
);
const deckAuthorityMigration = readFileSync(
  join(root, "supabase/migrations/20260601183000_event_deck_authority_contract.sql"),
  "utf8",
);
const promotionLockOrderMigration = readFileSync(
  join(root, "supabase/migrations/20260505223000_ready_gate_promotion_lock_order_repair.sql"),
  "utf8",
);
const queuedBrowseMigration = readFileSync(
  join(root, "supabase/migrations/20260505220000_event_lobby_browse_while_queued_repair.sql"),
  "utf8",
);
const singleOwnerDrainMigration = readFileSync(
  join(root, "supabase/migrations/20260605232304_video_date_single_owner_runtime_hardening.sql"),
  "utf8",
);
const validation = readFileSync(join(root, "supabase/validation/event_lobby_active_event_contract.sql"), "utf8");
const swipeActions = readFileSync(join(root, "supabase/functions/swipe-actions/index.ts"), "utf8");
const mysteryMatchRemoval = readFileSync(
  join(root, "supabase/migrations/20260609152000_remove_mystery_match.sql"),
  "utf8",
);
const legacyQueueSessionRpcRemoval = readFileSync(
  join(root, "supabase/migrations/20260609163130_remove_legacy_queue_session_rpcs.sql"),
  "utf8",
);
const legacyQueueCleanupRpcRemoval = readFileSync(
  join(root, "supabase/migrations/20260609165218_remove_leave_matching_queue.sql"),
  "utf8",
);
const sessionSourceRemoval = readFileSync(
  join(root, "supabase/migrations/20260609171950_remove_video_sessions_session_source.sql"),
  "utf8",
);

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
  const status = event.status && event.status.length > 0 ? event.status.toLowerCase() : "upcoming";
  if (status === "draft") return { is_active: false, reason: "event_draft" };
  if (status === "cancelled") return { is_active: false, reason: "event_cancelled" };
  if (event.archived_at != null || status === "archived") return { is_active: false, reason: "event_archived" };
  if (event.ended_at != null || status === "ended" || status === "completed") {
    return { is_active: false, reason: "event_ended" };
  }
  if (!["upcoming", "scheduled", "live"].includes(status)) {
    return { is_active: false, reason: "event_not_live" };
  }
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

test("canonical active-state assertions target the latest effective helper definition", () => {
  const helperDefinitionMigrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .filter((name) =>
      readFileSync(join(root, "supabase/migrations", name), "utf8").includes(
        "CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state",
      ),
    )
    .sort();

  assert.equal(
    helperDefinitionMigrations.at(-1),
    migrationPath.replace("supabase/migrations/", ""),
    "test must follow the latest get_event_lobby_active_state override",
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
  assert.match(helper, /v_event\.ended_at IS NOT NULL OR v_status IN \('ended', 'completed'\)/);
  assert.match(helper, /v_status NOT IN \('upcoming', 'scheduled', 'live'\)/);
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
  assert.deepEqual(activeStateForFixture({ ...live, status: "scheduled" }, nowMs), {
    is_active: true,
    reason: null,
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: "ended", ended_at: null }, nowMs), {
    is_active: false,
    reason: "event_ended",
  });
  assert.deepEqual(activeStateForFixture({ ...live, status: "completed", ended_at: null }, nowMs), {
    is_active: false,
    reason: "event_ended",
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

test("visible events computed status derives live before trusting stale raw ended", () => {
  const visible = section(
    "CREATE OR REPLACE FUNCTION public.get_visible_events",
    "COMMENT ON FUNCTION public.get_visible_events",
  );
  const endedAtIndex = visible.indexOf("WHEN e.ended_at IS NOT NULL THEN 'ended'");
  const liveWindowIndex = visible.indexOf("WHEN now() >= e.event_date");
  const computedEndIndex = visible.indexOf("WHEN now() >= (e.event_date");

  assert.ok(endedAtIndex > 0, "ended_at must remain terminal");
  assert.ok(liveWindowIndex > endedAtIndex, "scheduled live window should be checked after ended_at");
  assert.ok(computedEndIndex > liveWindowIndex, "computed end should be checked after live window");
  assert.doesNotMatch(visible, /e\.status = 'ended' OR e\.ended_at IS NOT NULL/);
});

test("compatibility helpers delegate to canonical active state", () => {
  assert.match(compatibilityMigration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.match(compatibilityMigration, /SELECT state\.reason[\s\S]*public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(compatibilityMigration, /CREATE OR REPLACE FUNCTION public\.is_event_lobby_active/);
  assert.match(compatibilityMigration, /SELECT COALESCE\(state\.is_active, false\)[\s\S]*public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
});

test("legacy get_event_deck authenticates first and rejects inactive events explicitly", () => {
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

test("get_event_deck_v3 returns terminal inactive deck state with server reason", () => {
  const deck = sectionFrom(
    deckV3Migration,
    "CREATE OR REPLACE FUNCTION public.get_event_deck_v3",
    "REVOKE ALL ON FUNCTION public.get_event_deck_v3",
  );
  const authIndex = deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id");
  const activeIndex = deck.indexOf("public.get_event_lobby_active_state(p_event_id, now())");
  const inactiveIndex = deck.indexOf("'reason', 'event_not_active'");
  const registrationIndex = deck.indexOf("FROM public.event_registrations er");

  assert.ok(authIndex > 0);
  assert.ok(activeIndex > authIndex, "deck v3 auth must precede active-state lookup");
  assert.ok(inactiveIndex > activeIndex, "deck v3 must return inactive state before eligibility work");
  assert.ok(registrationIndex > inactiveIndex, "deck v3 registration checks must be behind active guard");
  assert.match(deck, /'inactive_reason', COALESCE\(v_active\.reason, 'event_not_active'\)/);
});

test("handle_swipe rejects inactive events before every mutation or notification-triggering branch", () => {
  const currentSwipe = sectionFrom(
    deckAuthorityMigration,
    "CREATE OR REPLACE FUNCTION public.handle_swipe(",
    "REVOKE ALL ON FUNCTION public.handle_swipe",
  );
  const swipeV2 = sectionFrom(
    deckAuthorityMigration,
    "CREATE OR REPLACE FUNCTION public.handle_swipe_v2",
    "REVOKE ALL ON FUNCTION public.handle_swipe_v2",
  );
  const readyQueueBase = sectionFrom(
    readyQueueMigration,
    "CREATE OR REPLACE FUNCTION public.handle_swipe(",
    "COMMENT ON FUNCTION public.handle_swipe",
  );
  const idempotencyBase = sectionFrom(
    scheduledActivationMigration,
    "CREATE OR REPLACE FUNCTION public.handle_swipe_20260501210000_idempotency_base",
    "REVOKE ALL ON FUNCTION public.handle_swipe_20260501210000_idempotency_base",
  );
  const v2ValidationIndex = swipeV2.indexOf("public.event_deck_validate_presented_card");
  const v2SuccessDelegateIndex = swipeV2.indexOf(
    "v_result := public.handle_swipe_20260601183000_deck_authority_base",
  );
  const actorRegIndex = readyQueueBase.indexOf("profile_id = p_actor_id");
  const activeIndex = readyQueueBase.indexOf("public.get_event_lobby_active_state(p_event_id, now())");
  const swipeMutationIndex = readyQueueBase.indexOf("FROM public.event_swipes es");
  const sessionMutationIndex = readyQueueBase.indexOf("FROM public.video_sessions vs");

  assert.match(currentSwipe, /RETURN public\.handle_swipe_v2/);
  assert.doesNotMatch(currentSwipe, /\bINSERT INTO public\.(event_swipes|video_sessions)\b/);
  assert.ok(v2ValidationIndex > 0);
  assert.ok(v2SuccessDelegateIndex > v2ValidationIndex, "v2 must validate deck presentation before success-path base delegation");
  assert.ok(actorRegIndex > 0);
  assert.ok(activeIndex > actorRegIndex, "inactive reason details require actor registration first");
  assert.ok(swipeMutationIndex > activeIndex, "swipe mutation path must be behind active guard");
  assert.ok(sessionMutationIndex > activeIndex, "session mutation path must be behind active guard");
  assert.match(readyQueueBase, /'success', false,[\s\S]*'outcome', 'event_not_active'[\s\S]*'reason', v_inactive_reason/);
  assert.doesNotMatch(readyQueueBase.slice(0, activeIndex), /\bevent_swipes\b|\bvideo_sessions\b|current_room_id|current_partner_id/);
  assert.match(idempotencyBase, /public\.lock_event_lobby_scheduled_active_state\(p_event_id, now\(\)\)/);
  assert.match(idempotencyBase, /FROM public\.event_swipes es/);
  assert.match(idempotencyBase, /FROM public\.video_sessions vs/);
  assert.doesNotMatch(idempotencyBase, /ev\.status = 'live'/);
});

test("Mystery Match is removed instead of guarded as a session creation path", () => {
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match\(uuid, uuid\)/);
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match_20260502083000_active_base\(uuid, uuid\)/);
  assert.match(mysteryMatchRemoval, /video_sessions_session_source_rec_swipe_only/);
});

test("queue promotion and drain block inactive events before promotion delegation", () => {
  const promote = sectionFrom(
    promotionLockOrderMigration,
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "COMMENT ON FUNCTION public.promote_ready_gate_if_eligible",
  );
  const promoteBase = sectionFrom(
    queuedBrowseMigration,
    "CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible",
    "REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible",
  );
  const drain = sectionFrom(
    singleOwnerDrainMigration,
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "CREATE OR REPLACE FUNCTION public.claim_video_date_surface",
  );
  const drainBase = sectionFrom(
    scheduledActivationMigration,
    "CREATE OR REPLACE FUNCTION public.drain_match_queue",
    "COMMENT ON FUNCTION public.drain_match_queue",
  );

  const promoteRegistrationIndex = promoteBase.indexOf("auth_guard");
  const promoteActiveIndex = promoteBase.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const promoteDelegateIndex = promote.indexOf("public.promote_ready_gate_if_eligible_20260505223000_lock_order_base");
  assert.ok(promoteActiveIndex > promoteRegistrationIndex);
  assert.ok(promoteDelegateIndex > 0);
  assert.match(promoteBase, /'reason', 'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
  assert.match(promoteBase, /public\.lock_event_lobby_scheduled_active_state\(p_event_id, now\(\)\)/);
  assert.doesNotMatch(promoteBase, /\be\.status = 'live'/);

  const drainRegistrationIndex = drainBase.indexOf("actor_registration_guard");
  const drainActiveIndex = drainBase.indexOf("public.lock_event_lobby_scheduled_active_state(p_event_id, now())");
  const drainDelegateIndex = drain.indexOf("public.drain_match_queue_v2_20260605232304_single_owner_base");
  assert.match(drain, /RETURN public\.drain_match_queue_v2_20260605232304_single_owner_base/);
  assert.ok(drainActiveIndex > drainRegistrationIndex);
  assert.ok(drainDelegateIndex > 0);
  assert.match(drainBase, /'found', false,[\s\S]*'reason', 'event_not_valid'[\s\S]*'inactive_reason', v_inactive_reason/);
});

test("legacy direct session creation RPCs are removed rather than preserved as callable shims", () => {
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
  assert.match(legacyQueueSessionRpcRemoval, /DROP FUNCTION IF EXISTS public\.find_video_date_match\(uuid, uuid\)/);
  assert.match(legacyQueueSessionRpcRemoval, /DROP FUNCTION IF EXISTS public\.join_matching_queue\(uuid, uuid\)/);
  assert.doesNotMatch(legacyQueueSessionRpcRemoval, /DROP FUNCTION IF EXISTS public\.leave_matching_queue/i);
  assert.match(legacyQueueCleanupRpcRemoval, /DROP FUNCTION IF EXISTS public\.leave_matching_queue\(uuid\)/);
  assert.doesNotMatch(legacyQueueCleanupRpcRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemoval, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemoval, /ALTER TABLE[\s\S]*session_source/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemoval, /DROP COLUMN[\s\S]*session_source/i);
  assert.match(sessionSourceRemoval, /DROP CONSTRAINT IF EXISTS video_sessions_session_source_rec_swipe_only/);
  assert.match(sessionSourceRemoval, /DROP COLUMN IF EXISTS session_source/);
  assert.doesNotMatch(sessionSourceRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue/i);
  assert.doesNotMatch(sessionSourceRemoval, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible/i);
});

test("swipe-actions suppresses inactive-event notification side effects", () => {
  assert.match(swipeActions, /"event_not_active"/);
  assert.match(swipeActions, /result\.notification_suppressed === true/);
  assert.doesNotMatch(swipeActions, /event_not_active[\s\S]{0,300}send-notification/);
});

test("production validation is read-only and checks canonical active-state markers", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /get_event_lobby_active_state/);
  assert.match(validation, /v_status NOT IN \(''upcoming'', ''scheduled'', ''live''\)/);
  assert.match(validation, /v_status IN \(''ended'', ''completed''\)/);
  assert.match(validation, /lock_event_lobby_scheduled_active_state/);
  assert.match(validation, /get_event_deck_v3/);
  assert.match(validation, /inactive_reason/);
  assert.match(validation, /get_visible_events/);
  assert.match(validation, /e\.ended_at IS NOT NULL/);
  assert.doesNotMatch(
    sqlWithoutCommentsOrStringLiterals(validation),
    /e\.status = ''ended'' OR e\.ended_at IS NOT NULL/,
  );
  assert.match(validation, /handle_swipe_v2/);
  assert.match(validation, /handle_swipe_20260502083000_ready_queue_base/);
  assert.match(validation, /promote_ready_gate_if_eligible_20260505223000_lock_order_base/);
  assert.match(validation, /drain_match_queue_v2_20260605232304_single_owner_base/);
  assert.match(validation, /mystery_match_rpc_removed/);
  assert.match(validation, /legacy_direct_session_rpcs_removed/);
  assert.match(validation, /to_regprocedure\('public\.find_video_date_match\(uuid,uuid\)'\) is null/);
  assert.match(validation, /to_regprocedure\('public\.join_matching_queue\(uuid,uuid\)'\) is null/);
  assert.match(validation, /to_regprocedure\('public\.leave_matching_queue\(uuid\)'\) is null/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
});
