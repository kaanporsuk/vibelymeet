import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DATE_PREMIUM_EMPTY_STATE_MIN_HEIGHT_PX,
  VIDEO_DATE_PREMIUM_MIN_TOUCH_TARGET_PX,
  VIDEO_DATE_PREMIUM_READY_GATE_MIN_CARD_HEIGHT_PX,
  VIDEO_DATE_SPRINT6_LATENCY_CHECKPOINTS,
  VIDEO_DATE_SPRINT6_MANUAL_QA_CHECKS,
} from "./videoDateInstantExperience";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webSwipe = read("src/hooks/useSwipeAction.ts");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const operatorMetrics = read("shared/observability/videoDateOperatorMetrics.ts");
const swipeResultMigration = read(
  "supabase/migrations/20260525234000_video_date_sprint6_swipe_result_latency_checkpoint.sql",
);
const webVideoDate = readWebVideoDatePageFlowSource(root);
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeVideoDate = readNativeVideoDateScreenFlowSource();
const webLobbyEmptyState = read("src/components/lobby/LobbyEmptyState.tsx");
const webLobbyProfileCard = read("src/components/lobby/LobbyProfileCard.tsx");
const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeStandaloneReadyGate = read("apps/mobile/app/ready/[id].tsx");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const sharedPrepareEntry = read("shared/matching/videoDatePrepareEntry.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const qaChecklist = read("docs/qa/video-date-sprint6-speed-premium-ux.md");
const operatorDashboards = read("docs/observability/video-date-operator-dashboards.md");
const packageJson = read("package.json");

test("Sprint 6 latency checkpoints cover the full swipe-to-playable-frame path", () => {
  assert.deepEqual([...VIDEO_DATE_SPRINT6_LATENCY_CHECKPOINTS], [
    "swipe_result",
    "ready_gate_impression",
    "both_ready_observed",
    "date_route_entered",
    "daily_join_success",
    "remote_seen",
    "first_remote_frame",
    "remote_readable",
  ]);

  for (const checkpoint of VIDEO_DATE_SPRINT6_LATENCY_CHECKPOINTS) {
    assert.match(operatorMetrics, new RegExp(`["']${checkpoint}["']`), `${checkpoint} missing from operator metrics`);
  }

  assert.match(operatorMetrics, /swipeResultObservedAtMs/);
  assert.match(operatorMetrics, /case "swipe_result":[\s\S]+return "swipeResultObservedAtMs"/);
  assert.match(operatorDashboards, /first remote media proxy/);
  assert.match(operatorDashboards, /not proof that a remote frame was rendered on screen/);
  assert.match(operatorDashboards, /first-playable-media proxy/);
});

test("Sprint 6 swipe-result latency is emitted by web and native before Ready Gate handoff", () => {
  for (const source of [webSwipe, nativeLobby]) {
    assert.match(source, /recordReadyGateToDateLatencyCheckpoint/);
    assert.match(source, /buildReadyGateToDateLatencyPayload/);
    assert.match(source, /checkpoint:\s*["']swipe_result["']/);
    assert.match(source, /sourceAction:\s*["']swipe_result["']/);
    assert.match(source, /swipe_result_ms/);
    assert.match(source, /READY_GATE_TO_DATE_LATENCY_CHECKPOINT/);
  }

  assert.ok(
    webSwipe.indexOf('checkpoint: "swipe_result"') < webSwipe.indexOf("onVideoSessionReady?.(sessionId)"),
    "web must record swipe-result latency before opening Ready Gate callbacks",
  );
  assert.ok(
    nativeLobby.indexOf("checkpoint: 'swipe_result'") < nativeLobby.indexOf("setActiveSessionId(videoSessionId)"),
    "native must record swipe-result latency before opening the in-lobby Ready Gate",
  );
});

test("Sprint 6 durable migration handles only swipe_result and delegates existing checkpoints unchanged", () => {
  assert.match(swipeResultMigration, /v_checkpoint = 'swipe_result'/);
  assert.match(swipeResultMigration, /record_vd_launch_latency_202605252340_base/);
  assert.match(swipeResultMigration, /RETURN public\.record_vd_launch_latency_202605252340_base/);
  assert.match(swipeResultMigration, /public\.video_date_launch_latency_safe_int\(v_payload->>'swipe_result_ms'/);
  assert.match(swipeResultMigration, /participant_1_id IS DISTINCT FROM v_actor/);
  assert.match(swipeResultMigration, /participant_2_id IS DISTINCT FROM v_actor/);
  assert.match(swipeResultMigration, /GRANT EXECUTE[\s\S]+TO authenticated/);
});

test("Sprint 6 Daily route and media checkpoints remain present on web and native", () => {
  const webDatePath = `${webVideoDate}\n${webVideoCall}`;
  const nativeDatePath = nativeVideoDate;

  for (const source of [webDatePath, nativeDatePath]) {
    assert.match(source, /checkpoint:\s*["']date_route_entered["']/);
    assert.match(source, /checkpoint:\s*["']daily_join_success["']/);
    assert.match(source, /checkpoint:\s*["']remote_seen["']/);
    assert.match(source, /checkpoint:\s*["']first_remote_frame["']/);
    assert.match(source, /checkpoint:\s*["']remote_readable["']/);
  }
});

test("Sprint 6 deck/date prewarm remains active while post-survey instant-next prewarm is removed", () => {
  for (const source of [read("src/pages/EventLobby.tsx"), nativeLobby]) {
    assert.doesNotMatch(
      source,
      /useFeatureFlag\(\s*["']video_date\.deck_prefetch_polish_v2["'],?\s*\)/,
    );
    assert.match(source, /getVideoDateDeckPrefetchItems\(\s*sortedProfiles\s*\)/);
    assert.match(source, /video_date_deck_prefetch_cache_hit/);
    assert.match(source, /video_date_deck_prefetch_cache_miss/);
  }
  assert.match(read("src/pages/EventLobby.tsx"), /preloadRouteOnIdle\("videoDate"\)/);
  assert.match(nativeReadyGate, /router\.prefetch\(`\/date\/\$\{sessionId\}`/);

  for (const source of [webSurvey, nativeSurvey]) {
    assert.doesNotMatch(source, /post_date_instant_next_prewarm_started/);
    assert.doesNotMatch(source, /prefetchQuery\(\{|fetchEventDeck\(|getVideoDateDeckPrefetchItems/);
  }
});

test("Sprint 6 prepared-entry cache remains bounded, verified, and observable", () => {
  assert.match(sharedPrepareEntry, /PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS = 3 \* 60 \* 1000/);
  assert.match(sharedPrepareEntry, /preparedEntryRoomUrlMatchesRoomName/);
  assert.match(sharedPrepareEntry, /token_expired/);
  assert.match(sharedPrepareEntry, /invalid_ready_gate/);
  assert.match(sharedPrepareEntry, /consumePreparedVideoDateEntryHandoff/);
  assert.match(sharedPrepareEntry, /rejectCachedPreparedVideoDateEntry/);

  for (const source of [webPrepareEntry, nativePrepareEntry]) {
    assert.match(source, /cachedPrepareEntry|cached_prepare_entry/);
    assert.match(source, /provider_verify_skipped/);
    assert.match(source, /prepare_entry_success/);
    assert.match(source, /daily_token_mint_success/);
  }
});

test("Sprint 6 premium UX constants and jank guards are wired into shared contracts and surfaces", () => {
  assert.equal(VIDEO_DATE_PREMIUM_MIN_TOUCH_TARGET_PX, 44);
  assert.equal(VIDEO_DATE_PREMIUM_READY_GATE_MIN_CARD_HEIGHT_PX, 420);
  assert.equal(VIDEO_DATE_PREMIUM_EMPTY_STATE_MIN_HEIGHT_PX, 320);

  assert.match(webLobbyEmptyState, /useReducedMotion/);
  assert.match(webLobbyEmptyState, /min-h-\[320px\]/);
  assert.match(webLobbyEmptyState, /role="status"/);
  assert.match(webLobbyEmptyState, /aria-live="polite"/);
  assert.match(webLobbyEmptyState, /break-words/);
  assert.match(webLobbyEmptyState, /min-h-11/);

  assert.match(webLobbyProfileCard, /min-h-10/);
  assert.match(webLobbyProfileCard, /break-words/);
  assert.match(webLobbyProfileCard, /w-11 h-11/);

  assert.match(webReadyGate, /aria-modal="true"/);
  assert.match(webReadyGate, /safe-area-inset-top/);
  assert.match(webReadyGate, /min-h-\[min\(30rem,calc\(100dvh-2rem\)\)\]/);
  assert.match(webReadyGate, /sm:min-h-\[min\(34rem,calc\(100dvh-2rem\)\)\]/);
  assert.match(webReadyGate, /Marking\.\.\./);
  assert.match(webReadyGate, /min-h-10/);
  assert.match(webReadyGate, /aria-busy/);

  assert.match(nativeReadyGate, /SafeAreaView/);
  assert.match(nativeReadyGate, /ScrollView/);
  assert.match(nativeReadyGate, /accessibilityViewIsModal/);
  assert.match(nativeReadyGate, /minHeight:\s*420/);
  assert.match(nativeReadyGate, /minHeight:\s*44/);
  assert.match(nativeReadyGate, /accessibilityRole="button"/);
  assert.match(nativeReadyGate, /Marking\.\.\./);

  assert.match(nativeStandaloneReadyGate, /label=\{markingReady \? 'Marking\.\.\.' : "I'm Ready"\}/);
  assert.match(nativeStandaloneReadyGate, /accessibilityLabel="Snooze this Ready Gate for two minutes"/);
  assert.match(nativeStandaloneReadyGate, /accessibilityLabel="Step away from this Ready Gate"/);
  assert.match(nativeStandaloneReadyGate, /primaryBtn:\s*\{[^}]*minHeight:\s*48/);
  assert.match(nativeStandaloneReadyGate, /ghostBtn:\s*\{[^}]*minHeight:\s*44/);
  assert.match(nativeStandaloneReadyGate, /waitingPill:\s*\{[\s\S]*minHeight:\s*44/);
});

test("Sprint 6 manual screenshot QA matrix is explicit and included in the video-date suite", () => {
  assert.deepEqual([...VIDEO_DATE_SPRINT6_MANUAL_QA_CHECKS], [
    "web_desktop",
    "mobile_web",
    "ios_native",
    "android_native",
    "slow_network",
    "denied_permissions",
    "no_candidates",
    "queued_users",
  ]);

  for (const expected of [
    "Web desktop",
    "Mobile web",
    "iOS native",
    "Android native",
    "Slow network",
    "Denied permissions",
    "No candidates",
    "Queued users",
  ]) {
    assert.match(qaChecklist, new RegExp(expected));
  }

  assert.match(packageJson, /videoDateSprint6SpeedPremiumUxContracts\.test\.ts/);
});
