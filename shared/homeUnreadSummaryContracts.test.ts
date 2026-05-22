import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260513003000_last6_codex_review_followups.sql");
const webDashboard = read("src/pages/Dashboard.tsx");
const nativeDashboard = read("apps/mobile/app/(tabs)/index.tsx");
const webApp = read("src/App.tsx");
const nativeChatApi = read("apps/mobile/lib/chatApi.ts");

test("Home unread summary counts visible unarchived matches server-side", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_home_unread_summary\(\)/);
  assert.match(migration, /RETURNS TABLE\(message_count integer, match_count integer\)/);
  assert.match(migration, /count\(\*\)::integer AS message_count/);
  assert.match(migration, /count\(DISTINCT visible_unread\.match_id\)::integer AS match_count/);
  assert.match(migration, /NOT EXISTS \([\s\S]*public\.match_archives[\s\S]*archive\.user_id = viewer\.user_id/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_home_unread_summary\(\) TO authenticated/);
});

test("Home dashboards use aggregate unread summary instead of raw row paging", () => {
  assert.match(webDashboard, /\.rpc\("get_home_unread_summary"\)/);
  assert.match(nativeDashboard, /\.rpc\('get_home_unread_summary'\)/);
  assert.doesNotMatch(webDashboard, /\.select\("id, match_id"\)/);
  assert.doesNotMatch(nativeDashboard, /\.select\('id, match_id'\)/);
  assert.doesNotMatch(webDashboard, /unread conversations archive filter error/);
  assert.doesNotMatch(nativeDashboard, /unread conversations archive filter error/);
});

test("Home unread realtime invalidation avoids unscoped message deletes", () => {
  assert.doesNotMatch(webApp, /\{\s*event: "\*", schema: "public", table: "messages"\s*\}/);
  assert.doesNotMatch(webApp, /\{\s*event: "DELETE", schema: "public", table: "messages"\s*\}/);
  assert.match(webApp, /\{\s*event: "INSERT", schema: "public", table: "messages"\s*\}/);
  assert.match(webApp, /\{\s*event: "UPDATE", schema: "public", table: "messages"\s*\}/);
  assert.match(webApp, /table: "match_archives", filter: `user_id=eq\.\$\{userId\}`/);
  assert.doesNotMatch(nativeChatApi, /\{\s*event: '\*', schema: 'public', table: 'messages'\s*\}/);
  assert.match(nativeChatApi, /\{\s*event: 'INSERT', schema: 'public', table: 'messages'\s*\}/);
  assert.match(nativeChatApi, /\{\s*event: 'UPDATE', schema: 'public', table: 'messages'\s*\}/);
  assert.match(nativeChatApi, /\{\s*event: '\*', schema: 'public', table: 'match_archives', filter: `user_id=eq\.\$\{userId\}`\s*\}/);
});
