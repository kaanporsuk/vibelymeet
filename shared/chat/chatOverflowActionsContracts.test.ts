import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("chat overflow actions use server-owned archive, mute, and unmatch contracts", () => {
  const migration = read("supabase/migrations/20260509235500_chat_overflow_actions_server_contract.sql");
  const webArchive = read("src/hooks/useArchiveMatch.ts");
  const webMute = read("src/hooks/useMuteMatch.ts");
  const webUnmatch = read("src/hooks/useUnmatch.ts");
  const nativeArchive = read("apps/mobile/lib/useArchiveMatch.ts");
  const nativeMute = read("apps/mobile/lib/useMuteMatch.ts");
  const nativeUnmatch = read("apps/mobile/lib/useUnmatch.ts");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.match_archives/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_match_archive_state/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_match_notification_mute/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.clear_match_notification_mute/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.unmatch_match/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can archive own matches"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can manage own match mutes"/);
  assert.match(migration, /v_uid NOT IN \(v_match\.profile_id_1, v_match\.profile_id_2\)/);

  for (const source of [webArchive, nativeArchive]) {
    assert.match(source, /set_match_archive_state/);
    assert.doesNotMatch(source, /\.from\(["']matches["']\)\s*[\s\S]*\.update\(\{\s*archived_at/);
  }

  for (const source of [webMute, nativeMute]) {
    assert.match(source, /set_match_notification_mute/);
    assert.match(source, /clear_match_notification_mute/);
    assert.match(source, /muted_until\.is\.null/);
    assert.doesNotMatch(source, /\.upsert\(/);
  }

  for (const source of [webUnmatch, nativeUnmatch]) {
    assert.match(source, /unmatch_match/);
    assert.doesNotMatch(source, /\.from\(["']messages["']\)\s*[\s\S]*\.delete\(\)/);
    assert.doesNotMatch(source, /\.from\(["']matches["']\)\s*[\s\S]*\.delete\(\)/);
  }
});

test("web and native chat action surfaces stay wired to shared UI contracts", () => {
  const sharedDurations = read("shared/chat/matchMuteDurations.ts");
  const webChatHeader = read("src/components/chat/ChatHeader.tsx");
  const webSheet = read("src/components/MuteOptionsSheet.tsx");
  const nativeSheet = read("apps/mobile/components/match/MatchActionsSheet.tsx");

  assert.match(sharedDurations, /"1hour", "1day", "1week", "forever"/);
  assert.match(webChatHeader, /MATCH_MUTE_DURATIONS\.map/);
  assert.match(webChatHeader, /open=\{showProfileDrawer\}/);
  assert.match(webChatHeader, /onOpenChange=\{setShowProfileDrawer\}/);
  assert.match(webSheet, /MATCH_MUTE_DURATIONS\.map/);
  assert.match(nativeSheet, /MATCH_MUTE_DURATIONS\.map/);
  assert.match(nativeSheet, /setMode\('mute'\)/);
});

test("archiving is private organization state and does not globally block match calls", () => {
  const dailyRoom = read("supabase/functions/daily-room/index.ts");
  const migration = read("supabase/migrations/20260509235500_chat_overflow_actions_server_contract.sql");

  assert.match(migration, /Archive is private organization state/);
  assert.doesNotMatch(dailyRoom, /ARCHIVED_MATCH/);
  assert.doesNotMatch(dailyRoom, /archivedAt/);
  assert.doesNotMatch(dailyRoom, /archived_at/);
});
