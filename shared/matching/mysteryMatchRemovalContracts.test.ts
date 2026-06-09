import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const removedHookPaths = [
  "src/hooks/useMysteryMatch.ts",
  "apps/mobile/lib/useMysteryMatch.ts",
];

const activeProductSources = [
  "src/pages/EventLobby.tsx",
  "src/components/lobby/LobbyEmptyState.tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "shared/matching/videoDatePhase4Ux.ts",
  "shared/analytics/lobbyToPostDateJourney.ts",
  "supabase/functions/_shared/matching/videoSessionFlow.ts",
];

const removalMigration = read("supabase/migrations/20260609152000_remove_mystery_match.sql");
const validation = read("supabase/validation/event_lobby_active_event_contract.sql");
const generatedTypes = read("src/integrations/supabase/types.ts");

test("Mystery Match product entry points are removed from web, native, shared UX, and analytics", () => {
  for (const path of removedHookPaths) {
    assert.equal(existsSync(join(root, path)), false, `${path} should stay deleted`);
  }

  for (const path of activeProductSources) {
    const source = read(path);
    assert.doesNotMatch(source, /useMysteryMatch|findMysteryMatch|find_mystery_match/);
    assert.doesNotMatch(source, /MYSTERY_MATCH|Mystery Match|showMysteryMatch/);
    assert.doesNotMatch(source, /mystery_match/);
  }
});

test("forward migration drops the Mystery Match RPC chain and test sessions only", () => {
  assert.match(removalMigration, /CREATE TEMP TABLE mystery_match_sessions_to_delete/);
  assert.match(removalMigration, /WHERE session_source = 'mystery_match'/);
  assert.match(removalMigration, /DELETE FROM public\.video_sessions[\s\S]*mystery_match_sessions_to_delete/);
  assert.match(removalMigration, /ALTER COLUMN session_source SET DEFAULT 'reciprocal_swipe'/);
  assert.match(removalMigration, /video_sessions_session_source_rec_swipe_only/);

  for (const fn of [
    "find_mystery_match",
    "find_mystery_match_20260501180000_active_base",
    "find_mystery_match_20260502083000_active_base",
    "find_mystery_match_20260607103000_session_source_base",
  ]) {
    assert.match(
      removalMigration,
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(uuid, uuid\\)`),
      `${fn} must be dropped by the forward migration`,
    );
  }
});

test("validation and generated types encode the removed RPC contract", () => {
  assert.match(validation, /mystery_match_rpc_removed/);
  assert.match(validation, /to_regprocedure\('public\.find_mystery_match\(uuid,uuid\)'\) is null/);
  assert.doesNotMatch(validation, /has_function_privilege\('authenticated', 'public\.find_mystery_match/);
  assert.doesNotMatch(generatedTypes, /find_mystery_match/);
});
