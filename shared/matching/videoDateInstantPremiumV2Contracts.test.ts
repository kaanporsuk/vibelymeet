import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  VIDEO_DATE_DECK_PREFETCH_LIMIT,
  getVideoDateDeckPrefetchItems,
} from "./videoDateDeckPrefetch";
import {
  VIDEO_DATE_DECK_BUFFER_LIMIT,
  VIDEO_DATE_DECK_TOP_UP_THRESHOLD,
  shouldTopUpVideoDateDeck,
} from "./videoDateInstantExperience";

const root = process.cwd();
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webVideoCall = readFileSync(join(root, "src/hooks/useVideoCall.ts"), "utf8");
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const webSurvey = readFileSync(join(root, "src/components/video-date/PostDateSurvey.tsx"), "utf8");
const nativeSurvey = readFileSync(join(root, "apps/mobile/components/video-date/PostDateSurvey.tsx"), "utf8");
const webReconnectOverlay = readFileSync(join(root, "src/components/video-date/ReconnectionOverlay.tsx"), "utf8");
const nativeReconnectOverlay = readFileSync(join(root, "apps/mobile/components/video-date/ReconnectionOverlay.tsx"), "utf8");
const webDeckHook = readFileSync(join(root, "src/hooks/useEventDeck.ts"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const flags = readFileSync(join(root, "shared/featureFlags/videoDateV4Flags.ts"), "utf8");
const instantPremiumMigration = readFileSync(
  join(root, "supabase/migrations/20260522193000_video_date_instant_premium_v2_flags_batched_broadcast.sql"),
  "utf8",
);
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("instant premium deck prefetch helper dedupes media and preserves top-2 scope", () => {
  assert.equal(VIDEO_DATE_DECK_PREFETCH_LIMIT, 2);
  assert.deepEqual(
    getVideoDateDeckPrefetchItems([
      { id: "a", primary_photo_path: "same.jpg", photos: ["fallback-a.jpg"] },
      { id: "b", primary_photo_path: "same.jpg", photos: ["fallback-b.jpg"] },
      { id: "c", photos: ["unique.jpg"] },
      { id: "d", avatar_url: "avatar.jpg" },
    ]),
    [
      { profileId: "a", source: "same.jpg", sourceKind: "primary_photo_path", rank: 0 },
      { profileId: "c", source: "unique.jpg", sourceKind: "photo", rank: 1 },
    ],
  );
});

test("deck buffer and top-up rules remain the shipped 5/2 server-dealt contract", () => {
  assert.equal(VIDEO_DATE_DECK_BUFFER_LIMIT, 5);
  assert.equal(VIDEO_DATE_DECK_TOP_UP_THRESHOLD, 2);
  assert.equal(shouldTopUpVideoDateDeck(3), false);
  assert.equal(shouldTopUpVideoDateDeck(2), true);
  assert.match(webDeckHook, /p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT/);
  assert.match(nativeEventsApi, /p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT/);
});

test("web and native lobbies prefetch leading deck media, track paint/cache/top-up, and refetch stale deck state", () => {
  for (const source of [webLobby, nativeLobby]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.deck_prefetch_polish_v2["']\)/);
    assert.match(source, /getVideoDateDeckPrefetchItems\(sortedProfiles\)/);
    assert.match(source, /video_date_deck_prefetch_cache_hit/);
    assert.match(source, /video_date_deck_prefetch_cache_miss/);
    assert.match(source, /video_date_deck_prefetch_result/);
    assert.match(source, /video_date_deck_swipe_next_card_paint/);
    assert.match(source, /video_date_deck_top_up_decision/);
    assert.match(source, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
    assert.match(source, /invalidateQueries\(\{ queryKey: \[[^\]]*event-deck/);
  }
});

test("web and native lobbies use timeline v2 plus private active-session Broadcast with legacy fallbacks", () => {
  for (const source of [webLobby, nativeLobby]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.lobby_timeline_v2["']\)/);
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /setInterval/);
    assert.match(source, /createVideoDateSessionChannel/);
    assert.match(source, /resolveVideoDateSessionSeqDecision/);
    assert.match(source, /ready_gate_both_ready/);
    assert.match(source, /lobbyTimelineV2\.enabled && lobbyBroadcastSessionId/);
  }
  assert.match(nativeLobby, /useCountdown\(eventEndTime, !lobbyTimelineV2\.enabled\)/);
  assert.match(nativeLobby, /formatEventCountdown\(eventEndTimeMs, lobbyClockMs\)/);
});

test("post-date instant next is prestaged, deck-prefetched, optimistic for normal verdicts, and server-confirmed for safety paths", () => {
  assert.match(webVideoDate, /useFeatureFlag\("video_date\.post_date_instant_next_v2"\)/);
  assert.match(webVideoDate, /post_date_survey_prestaged/);
  assert.match(webVideoDate, /preloadRouteOnIdle\("eventLobby"\)/);
  assert.match(nativeVideoDate, /useFeatureFlag\('video_date\.post_date_instant_next_v2'\)/);
  assert.match(nativeVideoDate, /postDateSurveyShellPrestaged/);
  assert.match(nativeVideoDate, /postDateSurveyPrestageShell/);
  assert.match(nativeVideoDate, /post_date_survey_prestaged/);

  for (const source of [webSurvey, nativeSurvey]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.post_date_instant_next_v2["']\)/);
    assert.match(source, /prefetchQuery\(\{/);
    assert.match(source, /fetchEventDeckProfiles/);
    assert.match(source, /getVideoDateDeckPrefetchItems/);
    assert.match(source, /post_date_verdict_optimistic_started/);
    assert.match(source, /post_date_verdict_optimistic_confirmed/);
    assert.match(source, /post_date_verdict_optimistic_rollback/);
    assert.match(source, /submitPostDateReportWithOutbox|submitWebPostDateOutboxItem|submit_user_report/);
    assert.doesNotMatch(source, /post_date_safety_optimistic/);
  }
});

test("resilience v2 improves reconnect UI and applies Daily adaptation only behind capability checks", () => {
  for (const source of [webVideoDate, nativeVideoDate]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.resilience_v2["']\)/);
    assert.match(source, /video_date_resilience_low_quality_mode/);
    assert.match(source, /networkTier|netQualityTier/);
    assert.match(source, /resilienceV2=\{resilienceV2\.enabled\}/);
  }
  for (const source of [webVideoCall, nativeVideoDate]) {
    assert.match(source, /video_date_resilience_daily_adaptation/);
    assert.match(source, /capability_available/);
    assert.match(source, /updateReceiveSettings/);
  }
  for (const source of [webReconnectOverlay, nativeReconnectOverlay]) {
    assert.match(source, /resilienceV2/);
    assert.match(source, /networkTier/);
    assert.match(source, /Audio priority mode/);
    assert.match(source, /Stabilizing video/);
    assert.match(source, /graceTimeLeft/);
  }
});

test("new instant premium flags are default-off and explicitly exclude Daily warm handoff", () => {
  for (const flag of [
    "video_date.deck_prefetch_polish_v2",
    "video_date.lobby_timeline_v2",
    "video_date.post_date_instant_next_v2",
    "video_date.broadcast_batched_v2",
    "video_date.resilience_v2",
  ]) {
    assert.match(flags, new RegExp(`"${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(instantPremiumMigration, new RegExp(`'${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}', false, 0`));
  }
  assert.match(instantPremiumMigration, /Daily warm handoff is intentionally excluded/);
  assert.doesNotMatch(flags, /warm_handoff|daily_warm_handoff/);
});

test("instant premium contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateInstantPremiumV2Contracts\.test\.ts/);
});
