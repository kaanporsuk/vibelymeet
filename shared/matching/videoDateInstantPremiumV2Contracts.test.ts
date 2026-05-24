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
const dailySingletonMatchEtaMigration = readFileSync(
  join(root, "supabase/migrations/20260522203000_video_date_daily_singleton_match_eta_hint.sql"),
  "utf8",
);
const instantPremiumMigrations = `${instantPremiumMigration}\n${dailySingletonMatchEtaMigration}`;
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
      {
        profileId: "a",
        source: "same.jpg",
        mediaVersion: null,
        cacheKey: "a:unversioned:same.jpg",
        sourceKind: "primary_photo_path",
        rank: 0,
      },
      {
        profileId: "c",
        source: "unique.jpg",
        mediaVersion: null,
        cacheKey: "c:unversioned:unique.jpg",
        sourceKind: "photo",
        rank: 1,
      },
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
    assert.match(source, /resolveVideoDateTimelineCountdown/);
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
    assert.match(source, /fetchEventDeck\(/);
    assert.match(source, /getVideoDateDeckPrefetchItems/);
    assert.match(source, /const optimisticStep: SurveyStep = liked \? ["']awaiting_partner["'] : ["']highlights["']/);
    assert.match(source, /setStep\(optimisticStep\)/);
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
    assert.match(source, /backdropImageUrl/);
    assert.match(source, /Audio priority mode/);
    assert.match(source, /Stabilizing video/);
    assert.match(source, /graceTimeLeft/);
  }
  assert.match(webVideoDate, /captureRemoteFrameSnapshot/);
  assert.match(webVideoDate, /video_date_resilience_last_frame_snapshot/);
  assert.match(nativeVideoDate, /backdropImageUrl=\{resilienceV2\.enabled \? partnerAvatarUri : null\}/);
});

test("daily call singleton warm handoff is default-off, web/native gated, and idle-destroyed", () => {
  assert.match(flags, /"video_date\.daily_call_singleton_v2"/);
  assert.match(dailySingletonMatchEtaMigration, /'video_date\.daily_call_singleton_v2', false, 0/);
  assert.match(webVideoDate, /dailyCallSingletonV2: dailyCallSingletonV2\.enabled/);
  assert.match(webVideoDate, /dailyCallSingletonEligible:[\s\S]*videoSessionHasEncounterExposureTruth\(handshakeTruth\)/);
  assert.match(webVideoCall, /WEB_DAILY_CALL_SINGLETON_IDLE_MS = 90_000/);
  assert.match(webVideoCall, /parkWebDailyCallSingleton/);
  assert.match(webVideoCall, /consumeWebDailyCallSingleton/);
  assert.match(webVideoCall, /hasReusableWebDailyCallSingleton/);
  assert.match(webVideoCall, /expired_before_preflight/);
  assert.match(webVideoCall, /destroyed_before_preflight/);
  assert.match(webVideoCall, /expired_before_consume/);
  assert.match(webVideoCall, /destroyed_before_consume/);
  assert.match(webVideoCall, /daily_media_permission_preflight_skipped_for_singleton/);
  assert.match(webVideoCall, /daily_call_singleton_reused/);
  assert.match(webVideoCall, /Boolean\(optionsRef\.current\?\.dailyCallSingletonEligible\)/);
  assert.match(webVideoCall, /shouldParkSingleton && userId && callLeftSuccessfully/);
  assert.match(webVideoCall, /daily_call_singleton_park_skipped/);
  assert.match(webVideoCall, /singletonCall\.ok === false &&\s*prewarmedCall\.ok === false/);
  assert.match(webVideoCall, /releaseAppAcquiredMedia\("singleton_call_reused"\)/);
  assert.match(webVideoCall, /appAcquiredMedia: appAcquiredMediaRef\.current/);
  assert.match(webVideoCall, /stopMediaStreamTracks\(entry\.appAcquiredMedia\?\.stream\)/);
  assert.match(webVideoCall, /appAcquiredMediaRef\.current = singletonAppAcquiredMedia/);
  assert.match(webVideoCall, /clearDailyEventListeners\("daily_call_cleanup"\)/);
  assert.match(webVideoCall, /clearDailyEventListeners\("before_bind_daily_listeners"\)/);
  assert.match(webVideoCall, /callObject\.off\(eventName, handler\)/);
  assert.doesNotMatch(webVideoCall, /const bindDailyEvent[\s\S]{0,260}bindDailyEvent\(eventName, handler\)/);
  assert.match(nativeVideoDate, /NATIVE_DAILY_CALL_SINGLETON_IDLE_MS = 90_000/);
  assert.match(nativeVideoDate, /parkSharedCallForWarmHandoff/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_same_session_idle_deferred/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_same_session_idle/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_cross_session/);
  assert.match(nativeVideoDate, /type SharedDailyCallEntry = \{[\s\S]{0,120}userId: string/);
  assert.match(nativeVideoDate, /sharedCallCandidate\.userId !== user\.id/);
  assert.match(nativeVideoDate, /daily_call_singleton_owner_mismatch_destroy/);
  assert.match(nativeVideoDate, /idleSingletonEntry\.userId !== user\.id/);
  assert.match(nativeVideoDate, /idleAgeMs >= NATIVE_DAILY_CALL_SINGLETON_IDLE_MS/);
  assert.match(nativeVideoDate, /daily_call_singleton_idle_reuse_rejected/);
  assert.match(nativeVideoDate, /idleSingletonEntry\.call\.participants\(\)/);
  assert.match(nativeVideoDate, /dailyCallSingletonV2\.enabled && \(dateEstablishedRef\.current \|\| showFeedback\)/);
  assert.doesNotMatch(nativeVideoDate, /dailyCallSingletonV2\.enabled &&[\s\S]{0,120}phaseRef\.current === 'ended'/);
});

test("match ETA hint is sanitized, participant-visible, and gated by post-date instant-next full rollout", () => {
  assert.match(dailySingletonMatchEtaMigration, /emit_video_date_match_eta_hint_v2/);
  assert.match(dailySingletonMatchEtaMigration, /'match_eta_hint'/);
  assert.match(dailySingletonMatchEtaMigration, /'participants'/);
  assert.match(dailySingletonMatchEtaMigration, /flag_key = 'video_date\.post_date_instant_next_v2'/);
  assert.match(dailySingletonMatchEtaMigration, /rollout_bps >= 10000/);
  assert.match(dailySingletonMatchEtaMigration, /AFTER UPDATE OF ready_gate_status ON public\.video_sessions/);
});

test("new instant premium flags are default-off", () => {
  for (const flag of [
    "video_date.deck_prefetch_polish_v2",
    "video_date.lobby_timeline_v2",
    "video_date.post_date_instant_next_v2",
    "video_date.daily_call_singleton_v2",
    "video_date.broadcast_batched_v2",
    "video_date.resilience_v2",
  ]) {
    assert.match(flags, new RegExp(`"${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(instantPremiumMigrations, new RegExp(`'${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}', false, 0`));
  }
});

test("instant premium contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateInstantPremiumV2Contracts\.test\.ts/);
});
