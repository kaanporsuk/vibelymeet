import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function functionSection(source: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} definition should be dollar-quoted`);
  return source.slice(start, end);
}

function videoSessionsTableBlock(typesSource: string): string {
  const start = typesSource.indexOf("      video_sessions: {");
  const relationships = typesSource.indexOf("        Relationships:", start);
  assert.ok(start >= 0 && relationships > start, "video_sessions table block should exist");
  return typesSource.slice(start, relationships);
}

const removalMigration = read("supabase/migrations/20260609171950_remove_video_sessions_session_source.sql");
const validation = read("supabase/validation/event_lobby_active_event_contract.sql");
const generatedTypes = read("src/integrations/supabase/types.ts");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");

test("forward migration removes the temporary video_sessions session-source discriminator only", () => {
  const swipeBase = functionSection(removalMigration, "handle_swipe_20260601183000_deck_authority_base");

  assert.match(removalMigration, /DROP CONSTRAINT IF EXISTS video_sessions_session_source_rec_swipe_only/);
  assert.match(removalMigration, /DROP COLUMN IF EXISTS session_source/);
  assert.match(swipeBase, /public\.handle_swipe_20260607103000_mutual_match_source_base/);
  assert.match(swipeBase, /'super_vibe_consumed', true/);
  assert.doesNotMatch(swipeBase, /\bsession_source\b/);
  assert.doesNotMatch(removalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue/);
  assert.doesNotMatch(removalMigration, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible/);
  assert.doesNotMatch(removalMigration, /DROP COLUMN IF EXISTS (?!session_source)/);
});

test("active Edge and shared swipe payload contracts no longer expose session_source", () => {
  assert.doesNotMatch(swipeActions, /session_source\??:/);
  assert.doesNotMatch(videoSessionFlow, /session_source\??:/);
  assert.match(videoSessionFlow, /super_vibe_consumed\?: boolean/);
});

test("generated Supabase video_sessions table types omit session_source", () => {
  const tableBlock = videoSessionsTableBlock(generatedTypes);

  assert.doesNotMatch(tableBlock, /session_source/);
});

test("active validation proves the column and one-value constraint are absent", () => {
  assert.match(validation, /video_sessions_session_source_removed/);
  assert.match(validation, /c\.column_name = 'session_source'/);
  assert.match(validation, /con\.conname = 'video_sessions_session_source_rec_swipe_only'/);
  assert.match(validation, /not like '%session_source%'/);
  assert.match(validation, /mystery_match_rpc_removed/);
  assert.match(validation, /legacy_direct_session_rpcs_removed/);
  assert.match(validation, /event_lobby_public_rpcs_client_executable/);
});
