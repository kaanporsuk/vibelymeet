import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function eventLobbyTrackEventCalls(source: string): string[] {
  return [...source.matchAll(/trackEvent\(([\s\S]*?)\);/g)].map((match) => match[0]);
}

test("batch 3 closure removes raw target profile identifiers from web Event Lobby analytics", () => {
  const eventLobby = read("src/pages/EventLobby.tsx");
  const trackEventCalls = eventLobbyTrackEventCalls(eventLobby);
  const legacySwipeCalls = trackEventCalls.filter((call) =>
    /lobby_profile_swiped|super_vibe_used/.test(call),
  );

  assert.ok(legacySwipeCalls.length >= 4, "legacy swipe analytics should remain present for dashboard continuity");

  for (const call of legacySwipeCalls) {
    assert.doesNotMatch(call, /\b(profile_id|target_id|actor_id|user_id)\s*:/);
    assert.doesNotMatch(call, /\btargetId\b/);
  }

  assert.match(eventLobby, /target_present:\s*true/);
});

test("batch 3 closure stays client-only and documents no cloud deploy requirement", () => {
  const branchDelta = read(
    "docs/branch-deltas/fix-event-lobby-investigation-batch-3-payload-observability-tests-closure.md",
  );
  const packageJson = read("apps/mobile/package.json");

  assert.match(branchDelta, /B3-001/);
  assert.match(branchDelta, /No Supabase migration/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /No production data-mutating smoke/);
  assert.doesNotMatch(branchDelta, /supabase functions deploy/);
  assert.doesNotMatch(branchDelta, /supabase db push[^-]/);
  assert.doesNotMatch(packageJson, /expo-av/);
});
