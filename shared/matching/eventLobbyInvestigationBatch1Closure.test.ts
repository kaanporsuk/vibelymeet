import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

function listFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];

  return readdirSync(abs).flatMap((entry) => {
    const path = join(dir, entry);
    const fullPath = join(root, path);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", ".expo", "dist", "build", "coverage"].includes(entry)) return [];
      return listFiles(path);
    }
    return [path];
  });
}

const reportPath = "docs/audits/event-lobby-investigation-batch-1-backend-contracts.md";
const branchDeltaPath = "docs/branch-deltas/fix-event-lobby-investigation-batch-1-backend-contracts-closure.md";
const report = read(reportPath);
const branchDelta = read(branchDeltaPath);

const auditedArtifacts = [
  "docs/audits/event-lobby-deck-deep-dive.md",
  "docs/audits/event-lobby-closure-report.md",
  "docs/audits/event-lobby-active-event-contract-verification.md",
  "docs/audits/event-lobby-swipe-idempotency-verification.md",
  "docs/audits/event-lobby-production-contract-verification.md",
  "supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql",
  "supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql",
  "supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql",
  "supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql",
  "supabase/functions/swipe-actions/index.ts",
  "supabase/functions/_shared/matching/videoSessionFlow.ts",
  "src/hooks/useSwipeAction.ts",
  "apps/mobile/lib/eventsApi.ts",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "shared/matching/eventLobbyCanonicalActiveState.test.ts",
  "shared/matching/eventLobbyActiveEventContract.test.ts",
  "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
];

test("investigation report records PASS verdict and no implementation defect", () => {
  assert.match(report, /Verdict: pass\./);
  assert.match(report, /No implementation defect was found in this investigation batch\./);
  assert.match(report, /No FAIL or WARN findings were identified/);
  assert.match(report, /No deployment was performed/);
  assert.match(report, /No local Supabase was used/);
  assert.match(report, /No Docker command was run/);
  assert.match(report, /No secrets, tokens, service-role keys, provider keys, webhook secrets, or private payloads were printed or committed/);
});

test("closure branch delta documents Mode C docs-test-only scope and no cloud deploy", () => {
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C/i);
  assert.match(branchDelta, /docs\/test-only/i);
  assert.match(branchDelta, /Supabase migration requirement:\s*not required/i);
  assert.match(branchDelta, /Edge Function deploy requirement:\s*not required/i);
  assert.match(branchDelta, /Web\/static deploy requirement:\s*not required/i);
  assert.match(branchDelta, /Env vars added\/changed:\s*none/i);
  assert.match(branchDelta, /Native module changes:\s*none/i);
  assert.match(branchDelta, /`expo-av`:\s*not used/i);
  assert.match(branchDelta, /Production data-mutating smoke:\s*not run/i);
});

test("audited Event Lobby batch artifacts remain present", () => {
  for (const path of auditedArtifacts) {
    assert.equal(exists(path), true, `${path} should exist`);
  }
});

test("active-event and swipe idempotency contracts remain visible in source artifacts", () => {
  const activeMigration = read("supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql");
  const swipeMigration = read("supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql");
  const readyQueueMigration = read("supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql");
  const swipeActions = read("supabase/functions/swipe-actions/index.ts");
  const flow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");

  assert.match(activeMigration, /CREATE OR REPLACE FUNCTION public\.get_event_lobby_active_state/);
  assert.match(activeMigration, /SET search_path TO 'public'/);
  assert.match(activeMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_lobby_active_state\(uuid, timestamptz\)[\s\S]*TO service_role/);
  assert.match(activeMigration, /event_not_started/);
  assert.match(activeMigration, /event_outside_live_window/);

  assert.match(swipeMigration, /already_swiped/);
  assert.match(swipeMigration, /swipe_already_recorded/);
  assert.match(readyQueueMigration, /participant_has_active_session_conflict/);
  assert.match(swipeActions, /shouldSuppressSwipeNotification/);
  assert.match(swipeActions, /notification_suppressed/);
  assert.match(flow, /"already_swiped"/);
  assert.match(flow, /"swipe_already_recorded"/);
});

test("web and native clients remain authenticated swipe-actions consumers without direct handle_swipe calls", () => {
  const webSwipe = read("src/hooks/useSwipeAction.ts");
  const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

  assert.match(webSwipe, /functions\/v1\/swipe-actions/);
  assert.match(webSwipe, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(webSwipe, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(webSwipe, /functions\.invoke\(["']swipe-actions["']/);
  assert.doesNotMatch(webSwipe, /\.rpc\(["']handle_swipe["']/);
  assert.match(webSwipe, /case "already_swiped"/);
  assert.match(webSwipe, /case "participant_has_active_session_conflict"/);

  assert.match(nativeEventsApi, /functions\/v1\/swipe-actions/);
  assert.match(nativeEventsApi, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(nativeEventsApi, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(nativeEventsApi, /functions\.invoke\(['"]swipe-actions['"]/);
  assert.doesNotMatch(nativeEventsApi, /\.rpc\(['"]handle_swipe['"]/);
  assert.match(nativeLobby, /case 'already_swiped'/);
  assert.match(nativeLobby, /case 'swipe_already_recorded'/);
  assert.match(nativeLobby, /event_not_active/);
  assert.match(nativeLobby, /participant_has_active_session_conflict/);
});

test("closure introduces no Supabase artifact, env var, native module, or expo-av usage", () => {
  const closureArtifacts = [
    ...listFiles("supabase/migrations"),
    ...listFiles("supabase/validation"),
    ...listFiles("supabase/functions"),
  ].filter((path) => /event[-_]?lobby[-_]?investigation[-_]?batch[-_]?1|backend[-_]?contracts[-_]?closure/i.test(path));

  assert.deepEqual(closureArtifacts, [], "docs/test-only closure must not add Supabase artifacts");
  assert.doesNotMatch(branchDelta, /new env var|added env var|service role key/i);

  for (const path of ["package.json", "apps/mobile/package.json"]) {
    assert.doesNotMatch(read(path), /"expo-av"\s*:/, `${path} must not add expo-av`);
  }

  for (const path of [
    ...listFiles("src"),
    ...listFiles("apps/mobile"),
    ...listFiles("shared"),
    ...listFiles("supabase/functions"),
  ]) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    assert.doesNotMatch(
      read(path),
      /(?:from|require\(|import\()\s*['"]expo-av['"]/,
      `${path} must not import expo-av`,
    );
  }
});
