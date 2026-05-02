import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assertMentionsAll(text: string, phrases: string[], label: string): void {
  const normalized = text.toLowerCase();
  for (const phrase of phrases) {
    assert.match(normalized, new RegExp(escapeRegExp(phrase.toLowerCase())), `${label} should mention ${phrase}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const scriptPath = "scripts/run_event_lobby_regression.sh";
const script = read(scriptPath);
const runbookPath = "docs/golden-path-event-lobby-regression-runbook.md";
const runbook = read(runbookPath);
const auditPath = "docs/audits/event-lobby-regression-harness-verification.md";
const audit = read(auditPath);
const branchDeltaPath = "docs/branch-deltas/test-event-lobby-regression-harness.md";
const branchDelta = read(branchDeltaPath);
const activeDocMap = read("docs/active-doc-map.md");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

const activeEventTest = read("shared/matching/eventLobbyActiveEventContract.test.ts");
const canonicalActiveStateTest = read("shared/matching/eventLobbyCanonicalActiveState.test.ts");
const swipeRetryTest = read("shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts");
const webGatingTest = read("shared/matching/webEventLobbyGating.test.ts");
const readyQueueTest = read("shared/matching/eventLobbyReadyQueueContract.test.ts");
const deckPayloadTest = read("shared/matching/eventLobbyDeckPayloadMedia.test.ts");
const observabilityTest = read("shared/observability/eventLobbyObservability.test.ts");
const videoSessionFlowTest = read("supabase/functions/_shared/matching/videoSessionFlow.test.ts");
const videoSessionFlowSource = read("supabase/functions/_shared/matching/videoSessionFlow.ts");
const discoveryMigration = read("supabase/migrations/20260430190000_enforce_discovery_audience_in_discovery_surfaces.sql");
const readyQueueMigration = read("supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql");
const deckPayloadMigration = read("supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql");

test("Prompt 1-6 Event Lobby dependency migrations are present and sorted", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  for (const version of ["20260501223000", "20260501224000", "20260501225000", "20260501230000"]) {
    assert.ok(versions.includes(version), `${version} should be present`);
  }

  assert.ok(
    versions.indexOf("20260501224000") > versions.indexOf("20260501223000"),
    "swipe idempotency follow-up must sort after canonical active-event migration",
  );
  assert.ok(
    versions.indexOf("20260501225000") > versions.indexOf("20260501224000"),
    "ready/queue contract migration must sort after swipe idempotency follow-up",
  );
  assert.ok(
    versions.indexOf("20260501230000") > versions.indexOf("20260501225000"),
    "deck payload migration must sort after ready/queue contract migration",
  );
});

test("regression runner is safe by default and refuses ambiguous production smoke metadata", () => {
  assert.match(script, /Event Lobby regression harness/);
  assert.match(script, /PRODUCTION_SUPABASE_REF="schdyxcunwcvddlcshwd"/);
  assert.match(script, /supabase db push --linked --dry-run/);
  assert.match(script, /confirm_linked_supabase_ref/);
  assert.match(script, /EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1/);
  assert.match(script, /EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID/);
  assert.match(script, /Refusing production smoke metadata/);
  assert.match(script, /No live RPC smoke flow was executed/);
  assert.doesNotMatch(script, /supabase functions deploy/);
  assert.doesNotMatch(script, /supabase db push(?! --linked --dry-run)/);
  assert.doesNotMatch(script, /supabase migration repair|supabase db reset|psql .* -c/);
  assert.ok((statSync(join(root, scriptPath)).mode & 0o111) !== 0, "runner should be executable");
});

test("regression runner executes the focused Event Lobby contract pack", () => {
  for (const command of [
    "npx tsx scripts/runtime-copy-entities.test.ts",
    "npx tsx shared/matching/eventLobbyRegressionHarness.test.ts",
    "npx tsx shared/matching/eventLobbyActiveEventContract.test.ts",
    "npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts",
    "npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
    "npx tsx shared/matching/webEventLobbyGating.test.ts",
    "npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts",
    "npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts",
    "npx tsx shared/observability/eventLobbyObservability.test.ts",
    "npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts",
    "git diff --check",
  ]) {
    assert.match(script, new RegExp(escapeRegExp(command)), `runner should execute ${command}`);
  }

  assert.equal(packageJson.scripts?.["test:event-lobby-regression"], "bash scripts/run_event_lobby_regression.sh");
  assert.equal(packageJson.scripts?.["test:copy-entities"], "tsx scripts/runtime-copy-entities.test.ts");
});

test("automated coverage maps to the fixed backend/client contracts", () => {
  assert.match(canonicalActiveStateTest, /event_not_found/);
  assert.match(canonicalActiveStateTest, /event_not_started/);
  assert.match(canonicalActiveStateTest, /event_ended/);
  assert.match(canonicalActiveStateTest, /event_cancelled/);
  assert.match(canonicalActiveStateTest, /event_archived/);
  assert.match(canonicalActiveStateTest, /event_draft/);

  assert.match(activeEventTest, /get_event_deck/);
  assert.match(activeEventTest, /handle_swipe/);
  assert.match(activeEventTest, /find_mystery_match/);
  assert.match(activeEventTest, /drain_match_queue/);
  assert.match(activeEventTest, /event_not_active/);
  assert.match(readyQueueMigration, /event_swipes/);
  assert.match(readyQueueMigration, /video_sessions/);
  assert.match(runbook, /event_swipes/);
  assert.match(runbook, /video_sessions/);
  assert.match(runbook, /registration room\/partner mutation/);

  assert.match(swipeRetryTest, /already_swiped/);
  assert.match(swipeRetryTest, /duplicate/);
  assert.match(swipeRetryTest, /notification_suppressed/);
  assert.match(swipeRetryTest, /super-vibe duplicate cannot reach cap/);
  assert.match(swipeRetryTest, /simultaneous mutual swipes/);

  assert.match(readyQueueTest, /busy (?:in-session candidates|queue statuses)/);
  assert.match(readyQueueTest, /active-session conflicts/);
  assert.match(readyQueueTest, /one-active-session/);
  assert.match(readyQueueTest, /queue promotion blocks inactive events/);

  assert.match(webGatingTest, /missing event/);
  assert.match(webGatingTest, /ended-state UI/);
  assert.match(webGatingTest, /block deck fetch/);
  assert.match(webGatingTest, /readyGateOverlayAllowed/);

  assert.match(deckPayloadTest, /forbidden fields|forbidden_private_fields_not_returned/);
  assert.match(deckPayloadTest, /native lobby card consumes the same payload/);
  assert.match(deckPayloadTest, /first valid photo, then avatar/);

  assert.match(observabilityTest, /lobby_deck_empty/);
  assert.match(observabilityTest, /duplicate_suppressed/);
  assert.match(observabilityTest, /notification_suppressed/);
  assert.match(videoSessionFlowSource, /event_not_active/);
});

test("block, report, paused, suspended, and deleted exclusions remain in scope", () => {
  assert.match(readyQueueMigration, /public\.is_blocked\(p_actor_id, p_target_id\)/);
  assert.match(readyQueueMigration, /FROM public\.user_reports/);
  assert.match(readyQueueMigration, /account_paused/);
  assert.match(readyQueueMigration, /public\.is_profile_hidden\(p_actor_id\)/);
  assert.match(readyQueueMigration, /public\.is_profile_discoverable\(p_target_id, p_actor_id\)/);
  assert.match(discoveryMigration, /IF v_profile\.is_suspended THEN/);
  assert.match(discoveryMigration, /IF v_profile\.is_paused/);
  assert.match(discoveryMigration, /IF v_profile\.account_paused/);
  assert.match(discoveryMigration, /public\.is_blocked\(p_viewer_id, p_target_id\)/);
  assert.match(discoveryMigration, /FROM public\.user_reports ur/);
  assert.match(read("src/integrations/supabase/types.ts"), /deleted_at: string \| null/);
  assert.match(deckPayloadMigration, /public\.get_event_deck_20260501180000_active_base/);
  assert.match(runbook, /block\/report exclusion/);
});

test("runbook covers the manual staging golden paths that should not mutate production by default", () => {
  assertMentionsAll(
    runbook,
    [
      "two-user mutual vibe",
      "Ready Gate",
      "date entry",
      "three-user queued match",
      "queue drain",
      "super-vibe limit",
      "retry",
      "block/report exclusion",
      "event ends while users are in lobby",
      "empty deck diagnostics",
      "direct stale RPC rejection",
    ],
    "Event Lobby regression runbook",
  );

  assert.match(runbook, /Do not run these manual flows against production/);
  assert.match(runbook, /rollback-safe transaction/);
  assert.match(runbook, /EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1/);
  assert.match(runbook, /schdyxcunwcvddlcshwd/);
});

test("docs expose limitations, rebuild delta, and current evidence entrypoints", () => {
  assert.match(audit, /Supabase project ref: `schdyxcunwcvddlcshwd`/);
  assert.match(audit, /Remote migration parity: local and remote were in parity through `20260501230000`/);
  assert.match(audit, /No migration is added by this stream/);
  assert.match(audit, /No Edge Function source is changed by this stream/);
  assert.match(audit, /Rebuild Delta/);

  assert.match(branchDelta, /Problem/);
  assert.match(branchDelta, /Pre-audit Summary/);
  assert.match(branchDelta, /Implementation Summary/);
  assert.match(branchDelta, /Validation Plan/);
  assert.match(branchDelta, /Deploy Plan/);
  assert.match(branchDelta, /Rollback Plan/);
  assert.match(branchDelta, /Rebuild Delta/);
  assert.match(branchDelta, /Out Of Scope/);

  assert.match(activeDocMap, /Event Lobby regression harness/);
  assert.match(activeDocMap, /scripts\/run_event_lobby_regression\.sh/);
  assert.match(activeDocMap, /docs\/golden-path-event-lobby-regression-runbook\.md/);
});
