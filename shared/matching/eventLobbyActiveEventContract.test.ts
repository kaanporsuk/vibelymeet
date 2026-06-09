import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const activeEventMigration = read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql");
const mysteryMatchRemoval = read("supabase/migrations/20260609152000_remove_mystery_match.sql");
const autoNextRemoval = read("supabase/migrations/20260610000100_remove_post_date_instant_next.sql");
const validation = read("supabase/validation/event_lobby_active_event_contract.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");

function sectionFrom(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`);
  return source.slice(start, end);
}

test("event lobby active-event migration sorts after applied hardening tail", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501170000"));
  assert.ok(versions.includes("20260501180000"));
  assert.ok(versions.indexOf("20260501180000") > versions.indexOf("20260501170000"));
});

test("active-event helper encodes safe terminal and scheduled-window reasons", () => {
  assert.match(activeEventMigration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/);
  assert.match(activeEventMigration, /CREATE OR REPLACE FUNCTION public\.is_event_lobby_active/);
  assert.match(activeEventMigration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  for (const reason of [
    "event_archived",
    "event_cancelled",
    "event_ended",
    "event_not_live",
    "event_outside_live_window",
  ]) {
    assert.match(activeEventMigration, new RegExp(reason));
  }
});

test("deck and swipe active-event gates still precede delegated mutation paths", () => {
  const deck = sectionFrom(
    activeEventMigration,
    "CREATE OR REPLACE FUNCTION public.get_event_deck",
    "COMMENT ON FUNCTION public.get_event_deck",
  );
  const swipe = sectionFrom(
    activeEventMigration,
    "CREATE OR REPLACE FUNCTION public.handle_swipe",
    "COMMENT ON FUNCTION public.handle_swipe",
  );

  assert.ok(deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id") < deck.indexOf("get_event_lobby_inactive_reason"));
  assert.ok(deck.indexOf("get_event_lobby_inactive_reason") < deck.indexOf("get_event_deck_20260501180000_active_base"));
  assert.ok(swipe.indexOf("profile_id = p_actor_id") < swipe.indexOf("get_event_lobby_inactive_reason"));
  assert.ok(swipe.indexOf("get_event_lobby_inactive_reason") < swipe.indexOf("handle_swipe_20260501180000_active_base"));
  assert.match(swipe, /'result', 'event_not_active'[\s\S]*'reason', v_inactive_reason/);
});

test("Mystery Match no longer exists as an active-event session creation path", () => {
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match\(uuid, uuid\)/);
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match_20260501180000_active_base\(uuid, uuid\)/);
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match_20260607103000_session_source_base\(uuid, uuid\)/);
});

test("queued promotion and drain are now removed instead of active-event guarded", () => {
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue\(uuid\)/);
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue_v2\(uuid, text\)/);
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible\(uuid, uuid\)/);
  assert.match(autoNextRemoval, /CREATE OR REPLACE FUNCTION public\.mark_lobby_foreground/);
  assert.doesNotMatch(
    sectionFrom(
      autoNextRemoval,
      "CREATE OR REPLACE FUNCTION public.mark_lobby_foreground",
      "COMMENT ON FUNCTION public.mark_lobby_foreground",
    ),
    /promote_ready_gate_if_eligible|drain_match_queue/,
  );
});

test("inactive and queued-removed swipe outcomes do not trigger swipe-actions notifications", () => {
  assert.match(swipeActions, /if \(result\.result === "match" && sessionId\)/);
  assert.match(swipeActions, /result\.result === "super_vibe_sent"/);
  assert.match(swipeActions, /result\.result === "vibe_recorded"/);
  assert.doesNotMatch(swipeActions, /else if \(result\.result === "match_queued" && sessionId\)/);
  assert.doesNotMatch(swipeActions, /event_not_active[\s\S]{0,300}send-notification/);
});

test("production validation remains read-only active-state evidence", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /get_event_lobby_active_state/);
  assert.match(validation, /handle_swipe_v2/);
  assert.match(validation, /mystery_match_rpc_removed/);
  assert.doesNotMatch(validation.replace(/--.*$/gm, "").replace(/'(?:''|[^'])*'/g, "''"), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
});
