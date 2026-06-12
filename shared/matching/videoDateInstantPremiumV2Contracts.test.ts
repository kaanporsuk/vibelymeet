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

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const webVideoDate = readWebVideoDatePageFlowSource(root);
const webVideoCall = readWebVideoCallFlowSource(root);
const webLobbyProfileCard = readFileSync(join(root, "src/components/lobby/LobbyProfileCard.tsx"), "utf8");
const nativeVideoDate = readNativeVideoDateScreenFlowSource(root);
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
const publicInterfaceAliasMigration = readFileSync(
  join(root, "supabase/migrations/20260525150000_video_date_public_interface_alias_flags.sql"),
  "utf8",
);
const postDateAutoNextRemovalMigration = readFileSync(
  join(root, "supabase/migrations/20260610000100_remove_post_date_instant_next.sql"),
  "utf8",
);
const instantPremiumMigrations = `${instantPremiumMigration}\n${dailySingletonMatchEtaMigration}\n${publicInterfaceAliasMigration}`;
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("instant premium deck prefetch helper dedupes media and preserves top-3 scope", () => {
  assert.equal(VIDEO_DATE_DECK_PREFETCH_LIMIT, 3);
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
      {
        profileId: "d",
        source: "avatar.jpg",
        mediaVersion: null,
        cacheKey: "d:unversioned:avatar.jpg",
        sourceKind: "avatar_url",
        rank: 2,
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
    assert.doesNotMatch(source, /useFeatureFlag\(\s*["']video_date\./);
    assert.doesNotMatch(source, /deck_optimistic_v1|isFeatureFlagEnabledWithAlias/);
    assert.match(source, /getVideoDateDeckPrefetchItems\(sortedProfiles\)/);
    assert.match(source, /video_date_deck_prefetch_cache_hit/);
    assert.match(source, /video_date_deck_prefetch_cache_miss/);
    assert.match(source, /video_date_deck_prefetch_result/);
    assert.match(source, /video_date_deck_swipe_next_card_paint/);
    assert.match(source, /video_date_deck_top_up_decision/);
    assert.match(source, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
    assert.match(source, /invalidateQueries\(\{\s*queryKey:\s*\[[\s\S]*?event-deck/);
    assert.match(source, /pendingSwipeTargetIds/);
    assert.match(source, /pendingSwipeTargetIdsRef/);
    assert.match(source, /optimisticSwipeSequenceRef/);
    assert.match(source, /optimisticSwipeSequenceRef\.current = 0/);
    assert.match(source, /shouldRestoreVideoDateDeckCardAfterSwipeFailure/);
    assert.match(source, /video_date_deck_optimistic_restore_skipped/);
    assert.match(source, /video_date_deck_optimistic_restore_skipped[\s\S]+removeVideoDateDeckRecentSwipe\(\s*recentSwipeTargetsRef\.current,\s*profile\.id,\s*\)/);
    assert.match(source, /currentCardRetryState/);
    assert.match(source, /finally\s*\{\s*removePendingSwipeTargetId\(targetId\);/);
  }
  assert.match(webLobby, /rollbackOptimisticSwipeOnException/);
  assert.match(webLobbyProfileCard, /retryState/);
  assert.match(webLobbyProfileCard, /Retry in/);
  assert.match(nativeLobby, /cardRetryState/);
  assert.match(nativeLobby, /Retry in/);
});

test("web and native lobbies use timeline v2 plus private active-session Broadcast with legacy fallbacks", () => {
  for (const source of [webLobby, nativeLobby]) {
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /createVideoDateSessionChannel/);
    assert.match(source, /resolveVideoDateSessionSeqDecision/);
    assert.match(source, /resolveVideoDateTimelineCountdown/);
    assert.match(source, /ready_gate_both_ready/);
    assert.doesNotMatch(source, /lobbyTimelineV2/);
  }
  assert.doesNotMatch(nativeLobby, /useCountdown\(/);
  assert.match(nativeLobby, /formatEventCountdown\(eventEndTimeMs, lobbyClockMs\)/);
});

test("post-date instant-next prestage and optimistic verdict shortcuts are removed", () => {
  for (const source of [webVideoDate, nativeVideoDate, webSurvey, nativeSurvey]) {
    assert.doesNotMatch(source, /video_date\.post_date_instant_next_v2/);
    assert.doesNotMatch(source, /post_date_survey_prestaged|postDateSurveyShellPrestaged|postDateSurveyPrestageShell/);
    assert.doesNotMatch(source, /post_date_verdict_optimistic_started|post_date_verdict_optimistic_confirmed|post_date_verdict_optimistic_rollback/);
  }
  assert.match(webSurvey, /removed_auto_next_target_ignored/);
  assert.match(nativeSurvey, /removed_auto_next_target_ignored/);
  assert.match(postDateAutoNextRemovalMigration, /video_date\.post_date_instant_next_v2/);
});

test("resilience v2 improves reconnect UI and applies Daily adaptation only behind capability checks", () => {
  for (const source of [webVideoDate, nativeVideoDate]) {
    assert.match(source, /video_date_resilience_low_quality_mode/);
    assert.match(source, /networkTier|netQualityTier/);
    assert.doesNotMatch(source, /resilienceV2=\{/);
  }
  for (const source of [webVideoCall, nativeVideoDate]) {
    assert.match(source, /video_date_resilience_daily_adaptation/);
    assert.match(source, /capability_available/);
    assert.match(source, /updateReceiveSettings/);
  }
  for (const source of [webReconnectOverlay, nativeReconnectOverlay]) {
    assert.doesNotMatch(source, /resilienceV2/);
    assert.match(source, /networkTier/);
    assert.match(source, /backdropImageUrl/);
    assert.match(source, /Audio priority mode/);
    assert.match(source, /Stabilizing video/);
    assert.match(source, /graceTimeLeft/);
  }
  assert.match(webVideoDate, /captureRemoteFrameSnapshot/);
  assert.match(webVideoDate, /video_date_resilience_last_frame_snapshot/);
  assert.match(nativeVideoDate, /backdropImageUrl=\{partnerAvatarUri\}/);
});

test("Daily call continuity is explicit: web same-session remount, native gated warm handoff", () => {
  assert.doesNotMatch(flags, /"video_date\.daily_call_singleton_v2"/);
  assert.match(dailySingletonMatchEtaMigration, /'video_date\.daily_call_singleton_v2', false, 0/);
  assert.doesNotMatch(webVideoDate, /dailyCallSingletonV2: dailyCallSingletonV2\.enabled/);
  assert.match(webVideoDate, /dailyCallSingletonEligible:[\s\S]*videoSessionHasEncounterExposureTruth\(entryTruth\)/);
  assert.match(
    webVideoDate,
    /dailyCallSingletonEligible:[\s\S]*!showFeedback[\s\S]*!terminalSurveyRecoveryActive[\s\S]*phase !== "ended"[\s\S]*videoDateAccess === "allowed"/,
  );
  assert.doesNotMatch(
    webVideoDate,
    /dailyCallSingletonEligible:\s*\n\s*videoDateAccess === "allowed"\s*\|\|/,
  );
  assert.match(webVideoCall, /WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS: number \| null = null/);
  assert.match(webVideoCall, /parkWebDailyCallSingleton/);
  assert.match(webVideoCall, /consumeWebDailyCallSingleton/);
  assert.match(webVideoCall, /hasReusableWebDailyCallSingleton/);
  assert.match(webVideoCall, /isWebDailyCallSingletonIdleExpired/);
  assert.match(webVideoCall, /typeof entry\.idleMs === "number"/);
  assert.match(webVideoCall, /if \(shouldParkLiveSingleton && userId\) \{/);
  assert.match(webVideoCall, /expired_before_preflight/);
  assert.match(webVideoCall, /destroyed_before_preflight/);
  assert.match(webVideoCall, /local_media_not_live_before_preflight/);
  assert.match(webVideoCall, /expired_before_consume/);
  assert.match(webVideoCall, /destroyed_before_consume/);
  assert.match(webVideoCall, /local_media_not_live_before_consume/);
  assert.match(webVideoCall, /daily_media_permission_preflight_skipped_for_singleton/);
  assert.match(webVideoCall, /daily_call_singleton_reused/);
  assert.match(webVideoCall, /sameSessionDailyContinuity =[\s\S]+dailyCallSingletonEligible[\s\S]+hasSameSessionDailyContinuity\(sessionId\)/);
  assert.match(webVideoCall, /sameSessionDailyContinuityLatched:\s*hasSameSessionDailyContinuity\(sessionId\)/);
  assert.match(webVideoCall, /latchSameSessionDailyContinuity\(sessionId, "start_call_requested"\)/);
  assert.match(webVideoCall, /latchSameSessionDailyContinuity\(sessionId, "date_entry_truth_active"\)/);
  assert.match(webVideoCall, /latchSameSessionDailyContinuity\(sessionId, "daily_join_started"\)/);
  assert.match(webVideoCall, /latchSameSessionDailyContinuity\(sessionId, "daily_join_success"\)/);
  assert.match(webVideoCall, /clearSameSessionDailyContinuity\(\s*sessionId,\s*`daily_call_cleanup:\$\{reason\}`,\s*\)/);
  assert.match(webVideoCall, /const singletonCall =\s*userId\s*\?\s*consumeWebDailyCallSingleton/);
  assert.match(webVideoCall, /const skipMediaPreflightForSingleton = userId\s*\?\s*hasReusableWebDailyCallSingleton/);
  assert.match(webVideoCall, /parkingMode: "live_same_session_remount"/);
  assert.doesNotMatch(webVideoCall, /warm_handoff/);
  assert.match(webVideoCall, /meetingState !== "joined-meeting" && meetingState !== "joining-meeting"/);
  assert.match(webVideoCall, /daily_call_live_remount_leave_destroy_skipped_for_singleton/);
  assert.match(webVideoCall, /waitForDailyMeetingState/);
  assert.match(webVideoCall, /daily_join_skipped_singleton_already_joined/);
  assert.match(webVideoCall, /daily_join_completed_by_singleton_inflight/);
  assert.doesNotMatch(webVideoCall, /shouldParkSingleton && userId && callLeftSuccessfully/);
  assert.doesNotMatch(webVideoCall, /daily_call_singleton_park_skipped/);
  assert.match(webVideoCall, /singletonCall\.ok === false &&\s*prewarmedCall\.ok === false/);
  assert.match(webVideoCall, /releaseAppAcquiredMedia\("singleton_call_reused"\)/);
  assert.match(webVideoCall, /appAcquiredMedia: appAcquiredMediaRef\.current/);
  assert.match(webVideoCall, /stopMediaStreamTracks\(entry\.appAcquiredMedia\?\.stream\)/);
  assert.match(webVideoCall, /appAcquiredMediaRef\.current = singletonAppAcquiredMedia/);
  assert.match(webVideoCall, /clearDailyEventListeners\("daily_call_cleanup"\)/);
  assert.match(webVideoCall, /clearDailyEventListeners\("before_bind_daily_listeners"\)/);
  assert.match(webVideoCall, /callObject\.off\(eventName, handler\)/);
  assert.doesNotMatch(webVideoCall, /const bindDailyEvent[\s\S]{0,260}bindDailyEvent\(eventName, handler\)/);
  assert.match(nativeVideoDate, /NATIVE_DAILY_CALL_SINGLETON_IDLE_MS: number \| null = null/);
  assert.match(nativeVideoDate, /parkSharedCallForWarmHandoff/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_same_session_idle_deferred/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_same_session_idle/);
  assert.match(nativeVideoDate, /daily_call_singleton_reuse_cross_session/);
  assert.match(nativeVideoDate, /type SharedDailyCallEntry = \{[\s\S]{0,120}userId: string/);
  assert.match(nativeVideoDate, /sharedCallCandidate\.userId !== user\.id/);
  assert.match(nativeVideoDate, /daily_call_singleton_owner_mismatch_destroy/);
  assert.match(nativeVideoDate, /idleSingletonEntry\.userId !== user\.id/);
  assert.match(nativeVideoDate, /!idleSingletonEntry\.idleDestroyDisabled[\s\S]{0,180}idleAgeMs >= NATIVE_DAILY_CALL_SINGLETON_IDLE_MS/);
  assert.match(nativeVideoDate, /daily_call_singleton_idle_reuse_rejected/);
  assert.match(nativeVideoDate, /idleSingletonEntry\.call\.participants\(\)/);
  assert.match(nativeVideoDate, /idleDestroyDisabled: boolean/);
  // PR #1309 narrowed the parked shared entry to a local `entry` const before
  // the idle-destroy stamping; pin the narrowed assignment.
  assert.match(nativeVideoDate, /\bentry\.idleDestroyDisabled = idleMs == null/);
  assert.match(nativeVideoDate, /const meetingStateBeforeCleanup = safeNativeDailyMeetingState\(call\)/);
  assert.match(nativeVideoDate, /cleanupMode === "preserve_active_handoff"[\s\S]{0,220}!showFeedback\s*&&\s*!terminalSurveyHardStopRef\.current\s*&&\s*phaseRef\.current !== "ended"/);
  assert.match(nativeVideoDate, /meetingStateBeforeCleanup !== "left-meeting"[\s\S]{0,80}meetingStateBeforeCleanup !== "error"/);
  assert.doesNotMatch(nativeVideoDate, /cleanupMode === "preserve_active_handoff"[\s\S]{0,220}dateEstablishedRef\.current/);
  assert.match(nativeVideoDate, /mode: "destructive"[\s\S]{0,80}reason: "leave_and_cleanup"/);
  assert.match(nativeVideoDate, /mode: "destructive"[\s\S]{0,80}reason: "app_background"/);
  assert.match(nativeVideoDate, /mode: "destructive"[\s\S]{0,80}reason: "app_background_timeout"/);
  assert.match(nativeVideoDate, /if \(\s*shouldParkSingleton &&\s*parkSharedCallForWarmHandoff\(call, cleanupReason\)\s*\) \{/);
  assert.match(nativeVideoDate, /daily_call_live_remount_detach_only/);
  assert.match(nativeVideoDate, /heartbeatPreserved: true/);
  assert.doesNotMatch(nativeVideoDate, /await call\.leave\(\);[\s\S]{0,180}parkSharedCallForWarmHandoff/);
  assert.doesNotMatch(nativeVideoDate, /dailyCallSingletonV2\.enabled\s*&&\s*\(\s*dateEstablishedRef\.current\s*\|\|\s*showFeedback\s*\)/);
});

test("historical match ETA hint was gated by the removed post-date instant-next flag", () => {
  assert.match(dailySingletonMatchEtaMigration, /emit_video_date_match_eta_hint_v2/);
  assert.match(dailySingletonMatchEtaMigration, /'match_eta_hint'/);
  assert.match(dailySingletonMatchEtaMigration, /'participants'/);
  assert.match(dailySingletonMatchEtaMigration, /flag_key = 'video_date\.post_date_instant_next_v2'/);
  assert.match(postDateAutoNextRemovalMigration, /video_date\.post_date_instant_next_v2/);
  assert.match(dailySingletonMatchEtaMigration, /rollout_bps >= 10000/);
  assert.match(dailySingletonMatchEtaMigration, /AFTER UPDATE OF ready_gate_status ON public\.video_sessions/);
});

test("new instant premium flags are default-off", () => {
  const clientFlags = [
    "video_date.deck_prefetch_polish_v2",
    "video_date.lobby_timeline_v2",
    "video_date.daily_call_singleton_v2",
    "video_date.resilience_v2",
  ];
  // broadcast_batched_v2 is server-read only; deck_optimistic_v1 was a retired
  // compatibility alias. Both stay seeded in the historical migrations but are
  // no longer declared as client flags.
  const seededButNotClient = [
    "video_date.broadcast_batched_v2",
    "video_date.deck_optimistic_v1",
  ];
  // PR 6 flag freeze: every client-read key is hard-coded and removed from the
  // client flag list; the DB seed migrations remain historical truth.
  for (const flag of [...clientFlags, ...seededButNotClient]) {
    assert.doesNotMatch(flags, new RegExp(`"${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  for (const flag of [...clientFlags, ...seededButNotClient]) {
    assert.match(
      instantPremiumMigrations,
      new RegExp(`'${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'[\\s\\S]{0,120}false[\\s\\S]{0,40}0`),
    );
  }
});

test("instant premium contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateInstantPremiumV2Contracts\.test\.ts/);
});
