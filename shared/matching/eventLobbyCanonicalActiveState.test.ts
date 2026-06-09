import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const canonicalMigrationPath = "supabase/migrations/20260601143000_event_creation_status_bulletproofing.sql";
const canonicalMigration = read(canonicalMigrationPath);
const deckV3Migration = read("supabase/migrations/20260602231752_ready_gate_57014_reliability_fix.sql");
const legacyQueueSessionRpcRemoval = read("supabase/migrations/20260609163130_remove_legacy_queue_session_rpcs.sql");
const legacyQueueCleanupRpcRemoval = read("supabase/migrations/20260609165218_remove_leave_matching_queue.sql");
const sessionSourceRemoval = read("supabase/migrations/20260609171950_remove_video_sessions_session_source.sql");
const autoNextRemoval = read("supabase/migrations/20260610000100_remove_post_date_instant_next.sql");
const validation = read("supabase/validation/event_lobby_active_event_contract.sql");

function sectionFrom(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("canonical active-state assertions target the latest effective helper definition", () => {
  const helperDefinitionMigrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .filter((name) => read(join("supabase/migrations", name)).includes("CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state"))
    .sort();

  assert.equal(helperDefinitionMigrations.at(-1), canonicalMigrationPath.replace("supabase/migrations/", ""));
});

test("canonical helper exposes active boolean, reason, and event status with safe grants", () => {
  const helper = sectionFrom(
    canonicalMigration,
    "CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state",
    "COMMENT ON FUNCTION public.get_event_lobby_active_state",
  );

  assert.match(helper, /RETURNS TABLE\(\s*is_active boolean,\s*reason text,\s*event_status text\s*\)/);
  assert.match(helper, /p_now timestamptz DEFAULT now\(\)/);
  assert.match(helper, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
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
  assert.match(canonicalMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_lobby_active_state\(uuid, timestamptz\)[\s\S]*TO service_role/);
});

test("get_event_deck_v3 returns terminal inactive deck state with server reason", () => {
  const deck = sectionFrom(
    deckV3Migration,
    "CREATE OR REPLACE FUNCTION public.get_event_deck_v3",
    "REVOKE ALL ON FUNCTION public.get_event_deck_v3",
  );

  assert.ok(deck.indexOf("v_viewer IS NULL OR v_viewer <> p_user_id") < deck.indexOf("get_event_lobby_active_state"));
  assert.ok(deck.indexOf("get_event_lobby_active_state") < deck.indexOf("'reason', 'event_not_active'"));
  assert.match(deck, /'inactive_reason', COALESCE\(v_active\.reason, 'event_not_active'\)/);
});

test("legacy direct session creation and leave-queue RPCs are removed", () => {
  assert.match(legacyQueueSessionRpcRemoval, /DROP FUNCTION IF EXISTS public\.find_video_date_match\(uuid, uuid\)/);
  assert.match(legacyQueueSessionRpcRemoval, /DROP FUNCTION IF EXISTS public\.join_matching_queue\(uuid, uuid\)/);
  assert.match(legacyQueueCleanupRpcRemoval, /DROP FUNCTION IF EXISTS public\.leave_matching_queue\(uuid\)/);
  assert.match(sessionSourceRemoval, /DROP COLUMN IF EXISTS session_source/);
});

test("post-date queued drain, queue hint, and promotion RPCs are now removed", () => {
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue\(uuid\)/);
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.drain_match_queue_v2\(uuid, text\)/);
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_hint_v1\(uuid, uuid\)/);
  assert.match(autoNextRemoval, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible\(uuid, uuid\)/);
});

test("production validation is read-only catalog verification", () => {
  assert.match(validation, /pg_get_functiondef/);
  assert.match(validation, /get_event_lobby_active_state/);
  assert.match(validation, /mystery_match_rpc_removed/);
  assert.match(validation, /legacy_direct_session_rpcs_removed/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
});
