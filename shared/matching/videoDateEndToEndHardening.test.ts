import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSpendVideoDateCreditExtensionPayload,
  remainingDatePhaseSeconds,
} from "./videoDateExtensionSpend";
import {
  remainingStartedAtCountdownSeconds,
  startedAtCountdownDeadlineMs,
} from "./videoDateCountdown";
import { VIDEO_DATE_HANDSHAKE_TRUTH_SELECT } from "./videoDateHandshakePersistence";
import {
  getPostDateLobbyContinuityDecision,
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  secondsUntilPostDateEventEnd,
  shouldEnablePostDateSurveyQueueDrain,
} from "./postDateContinuity";
import {
  normalizeVideoDateIceBreakerQuestions,
  resolveVideoDateIceBreakerIndex,
  shuffleVideoDateIceBreakerQuestions,
} from "./videoDateIceBreakers";
import {
  createVideoDateCameraSwitchRenderHint,
  parseVideoDateCameraSwitchRenderHint,
} from "./videoDateCameraSwitchRenderHint";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501090000_video_date_end_to_end_hardening.sql"),
  "utf8",
);
const preDateEndMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501091000_video_date_pre_date_end_cleanup.sql"),
  "utf8",
);
const swipeRecoveryMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501092000_handle_swipe_presence_and_already_matched_session.sql"),
  "utf8",
);
const prepareEntryMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501100000_video_date_prepare_entry_prewarm.sql"),
  "utf8",
);
const dailyRoomFunction = readFileSync(
  join(process.cwd(), "supabase/functions/daily-room/index.ts"),
  "utf8",
);
const videoDateRoomNameTokenWithExpiryEject =
  /const tokenWindow = resolveVideoDateMeetingTokenWindow\(\{[\s\S]*?const token = await createMeetingToken\(\s*roomName,\s*user\.id,\s*tokenWindow\.ttlSeconds,\s*undefined,\s*\{\s*ejectAtTokenExp:\s*true\s*\},?\s*\)/s;
const videoDateRoomProofTokenWithExpiryEject =
  /const tokenWindow = resolveVideoDateMeetingTokenWindow\(\{[\s\S]*?const token = await createMeetingToken\(\s*roomProof\.roomName,\s*user\.id,\s*tokenWindow\.ttlSeconds,\s*undefined,\s*\{\s*ejectAtTokenExp:\s*true\s*\},?\s*\)/s;

function indexOfMatch(source: string, pattern: RegExp, start = 0): number {
  const match = source.slice(start).match(pattern);
  return match?.index == null ? -1 : start + match.index;
}

const dailyRoomContracts = readFileSync(
  join(process.cwd(), "supabase/functions/daily-room/dailyRoomContracts.ts"),
  "utf8",
);
const videoDateRoomCleanupFunction = readFileSync(
  join(process.cwd(), "supabase/functions/video-date-room-cleanup/index.ts"),
  "utf8",
);
const activeLookupIndexesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501102000_video_sessions_active_lookup_indexes.sql"),
  "utf8",
);
const remainingHardeningMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501103000_video_date_remaining_hardening.sql"),
  "utf8",
);
const providerAtomicEntryMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501110000_video_date_provider_atomic_entry.sql"),
  "utf8",
);
const backendIntegrityMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501112000_video_sessions_rls_write_lockdown.sql"),
  "utf8",
);
const eventParticipantHeartbeatMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501134000_event_participant_server_stamped_heartbeat.sql"),
  "utf8",
);
const videoDateObservabilityV1Migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501135000_video_date_observability_v1.sql"),
  "utf8",
);
const videoDateObservabilityV2Migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501140000_video_date_observability_v2_trace.sql"),
  "utf8",
);
const readyGateServerOwnedRegistrationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501141000_ready_gate_server_owned_registration_status.sql"),
  "utf8",
);
const readyGateClientLifecycleOverwriteGuardMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql"),
  "utf8",
);
const halfVerdictTimeoutCronMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501104000_schedule_post_date_half_verdict_timeout_cron.sql"),
  "utf8",
);
const pendingVerdictObservabilityMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501113000_post_date_pending_verdict_observability.sql"),
  "utf8",
);
const pendingVerdictReminderMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501114000_post_date_pending_verdict_reminders.sql"),
  "utf8",
);
const checkMutualVibeLockdownMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501131000_lock_down_check_mutual_vibe_and_match.sql"),
  "utf8",
);
const pendingSurveyRecoveryIndexesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501132000_pending_post_date_survey_recovery_indexes.sql"),
  "utf8",
);
const cleanupProviderPresenceMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501133000_video_date_cleanup_provider_presence_hardening.sql"),
  "utf8",
);
const partialJoinTimeoutMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501143000_video_date_partial_join_timeout.sql"),
  "utf8",
);
const partialJoinObservabilityPolishMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501144000_video_date_partial_join_observability_polish.sql"),
  "utf8",
);
const partialJoinManualEndMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501145000_video_date_peer_missing_manual_end.sql"),
  "utf8",
);
const clientStuckObservabilityMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501151000_video_date_client_stuck_observability.sql"),
  "utf8",
);
const launchLatencyCheckpointObservabilityMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260505120000_video_date_launch_latency_checkpoint_observability.sql"),
  "utf8",
);
const rpcShortCircuitAndKeepwarmMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260505214500_video_date_rpc_short_circuit_and_daily_keepwarm.sql"),
  "utf8",
);
const launchLatencyJoinPrewarmCheckpointsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260505231000_video_date_launch_latency_join_prewarm_checkpoints.sql"),
  "utf8",
);
const launchLatencyPermissionPrewarmSkipCheckpointMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260505234000_video_date_permission_prewarm_skip_checkpoint.sql"),
  "utf8",
);
const launchLatencyPrepareTimingSlicesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260506101000_video_date_launch_latency_prepare_timing_slices.sql"),
  "utf8",
);
const launchLatencyPrepareTimingBaseNamePolishMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260506102000_video_date_prepare_timing_base_name_polish.sql"),
  "utf8",
);
const handshakeJoinStartMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501170000_video_date_handshake_starts_after_daily_join.sql"),
  "utf8",
);
const soloPrejoinJoinGuardMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260505230000_video_date_solo_prejoin_daily_join_guard.sql"),
  "utf8",
);
const handshakeDeadlineFinalizerMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260502143000_video_date_handshake_deadline_finalizer.sql"),
  "utf8",
);
const handshakeDeadlinePolishMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260502150000_video_date_handshake_deadline_polish.sql"),
  "utf8",
);
const encounterSurveyMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260503090000_video_date_encounter_survey_and_pair_guard.sql"),
  "utf8",
);
const encounterPairGuardAclPolishMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260503100000_video_date_pair_guard_function_acl_polish.sql"),
  "utf8",
);
const surveyContinuityCleanupMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260503110000_video_date_survey_continuity_cleanup.sql"),
  "utf8",
);
const iceBreakerSyncMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260503123000_video_date_ice_breaker_sync.sql"),
  "utf8",
);
const postDateVerdictRemindersFunction = readFileSync(
  join(process.cwd(), "supabase/functions/post-date-verdict-reminders/index.ts"),
  "utf8",
);
const sendNotificationFunction = readFileSync(
  join(process.cwd(), "supabase/functions/send-notification/index.ts"),
  "utf8",
);
const supabaseConfig = readFileSync(
  join(process.cwd(), "supabase/config.toml"),
  "utf8",
);
const videoDateValidationSql = readFileSync(
  join(process.cwd(), "supabase/validation/video_date_end_to_end_hardening.sql"),
  "utf8",
);
const launchLatencyBaselineSql = readFileSync(
  join(process.cwd(), "supabase/validation/video_date_launch_latency_baseline.sql"),
  "utf8",
);
const readyGateRouteLabelCleanupMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260522162000_video_date_ready_gate_route_label_cleanup.sql"),
  "utf8",
);
const readyGateOverlay = readFileSync(
  join(process.cwd(), "src/components/lobby/ReadyGateOverlay.tsx"),
  "utf8",
);
const webReadyRedirect = readFileSync(
  join(process.cwd(), "src/pages/ReadyRedirect.tsx"),
  "utf8",
);
const nativeReadyGateOverlay = readFileSync(
  join(process.cwd(), "apps/mobile/components/lobby/ReadyGateOverlay.tsx"),
  "utf8",
);
const nativeReadyRoute = readFileSync(
  join(process.cwd(), "apps/mobile/app/ready/[id].tsx"),
  "utf8",
);
const webReadyGateHook = readFileSync(
  join(process.cwd(), "src/hooks/useReadyGate.ts"),
  "utf8",
);
const nativeReadyGateApi = readFileSync(
  join(process.cwd(), "apps/mobile/lib/readyGateApi.ts"),
  "utf8",
);
const sharedActiveSession = readFileSync(
  join(process.cwd(), "shared/matching/activeSession.ts"),
  "utf8",
);
const webPrepareEntry = readFileSync(
  join(process.cwd(), "src/lib/videoDatePrepareEntry.ts"),
  "utf8",
);
const nativePrepareEntry = readFileSync(
  join(process.cwd(), "apps/mobile/lib/videoDatePrepareEntry.ts"),
  "utf8",
);
const webAnalytics = readFileSync(
  join(process.cwd(), "src/lib/analytics.ts"),
  "utf8",
);
const nativeAnalytics = readFileSync(
  join(process.cwd(), "apps/mobile/lib/analytics.ts"),
  "utf8",
);
const launchLatencyCheckpointObservability = readFileSync(
  join(process.cwd(), "shared/observability/videoDateLaunchLatencyCheckpointObservability.ts"),
  "utf8",
);
const videoDateOperatorMetrics = readFileSync(
  join(process.cwd(), "shared/observability/videoDateOperatorMetrics.ts"),
  "utf8",
);
const webActiveSessionHook = readFileSync(
  join(process.cwd(), "src/hooks/useActiveSession.ts"),
  "utf8",
);
const webDateNavigationGuard = readFileSync(
  join(process.cwd(), "src/lib/dateNavigationGuard.ts"),
  "utf8",
);
const nativeDateNavigationGuard = readFileSync(
  join(process.cwd(), "apps/mobile/lib/dateNavigationGuard.ts"),
  "utf8",
);
const webEventStatusHook = readFileSync(
  join(process.cwd(), "src/hooks/useEventStatus.ts"),
  "utf8",
);
const nativeActiveSessionHook = readFileSync(
  join(process.cwd(), "apps/mobile/lib/useActiveSession.ts"),
  "utf8",
);
const nativeEventStatusHook = readFileSync(
  join(process.cwd(), "apps/mobile/lib/eventStatus.ts"),
  "utf8",
);
const webClientWritableStatusType = webEventStatusHook.match(
  /export type ClientWritableParticipantStatus =[\s\S]*?;/,
)?.[0] ?? "";
const nativeClientWritableStatusType = nativeEventStatusHook.match(
  /export type ClientWritableParticipantStatus =[\s\S]*?;/,
)?.[0] ?? "";
const webSwipeActionHook = readFileSync(
  join(process.cwd(), "src/hooks/useSwipeAction.ts"),
  "utf8",
);
const eventLobby = readFileSync(
  join(process.cwd(), "src/pages/EventLobby.tsx"),
  "utf8",
);
const webVideoCallHook = readFileSync(
  join(process.cwd(), "src/hooks/useVideoCall.ts"),
  "utf8",
);
const webDailyPrewarm = readFileSync(
  join(process.cwd(), "src/lib/videoDateDailyPrewarm.ts"),
  "utf8",
);
const webDailyCallObjectConfig = readFileSync(
  join(process.cwd(), "src/lib/dailyCallObjectConfig.ts"),
  "utf8",
);
const nativeDailyPrewarm = readFileSync(
  join(process.cwd(), "apps/mobile/lib/videoDateDailyPrewarm.ts"),
  "utf8",
);
const webEnvExample = readFileSync(
  join(process.cwd(), ".env.example"),
  "utf8",
);
const nativeEnvExample = readFileSync(
  join(process.cwd(), "apps/mobile/.env.example"),
  "utf8",
);
const webVideoDatePage = readFileSync(
  join(process.cwd(), "src/pages/VideoDate.tsx"),
  "utf8",
);
const cameraSwitchRenderHintContract = readFileSync(
  join(process.cwd(), "shared/matching/videoDateCameraSwitchRenderHint.ts"),
  "utf8",
);
const webIceBreakerCard = readFileSync(
  join(process.cwd(), "src/components/video-date/IceBreakerCard.tsx"),
  "utf8",
);
const sharedIceBreakers = readFileSync(
  join(process.cwd(), "shared/matching/videoDateIceBreakers.ts"),
  "utf8",
);
const webVibeCheckButton = readFileSync(
  join(process.cwd(), "src/components/video-date/VibeCheckButton.tsx"),
  "utf8",
);
const webHandshakeTimer = readFileSync(
  join(process.cwd(), "src/components/video-date/HandshakeTimer.tsx"),
  "utf8",
);
const nativeVideoDateRoute = readFileSync(
  join(process.cwd(), "apps/mobile/app/date/[id].tsx"),
  "utf8",
);
const nativeIceBreakerCard = readFileSync(
  join(process.cwd(), "apps/mobile/components/video-date/IceBreakerCard.tsx"),
  "utf8",
);
const nativeVideoDateDailyMediaConfig = readFileSync(
  join(process.cwd(), "apps/mobile/lib/videoDateDailyMediaConfig.ts"),
  "utf8",
);
const nativeOneSignal = readFileSync(
  join(process.cwd(), "apps/mobile/lib/onesignal.ts"),
  "utf8",
);
const nativeRevenueCat = readFileSync(
  join(process.cwd(), "apps/mobile/lib/revenuecat.ts"),
  "utf8",
);
const videoDateMediaContract = readFileSync(
  join(process.cwd(), "shared/matching/videoDateMediaContract.ts"),
  "utf8",
);
const nativeVibeCheckButton = readFileSync(
  join(process.cwd(), "apps/mobile/components/video-date/VibeCheckButton.tsx"),
  "utf8",
);
const adminVideoDateOpsFunction = readFileSync(
  join(process.cwd(), "supabase/functions/admin-video-date-ops/index.ts"),
  "utf8",
);
const adminLiveEventMetrics = readFileSync(
  join(process.cwd(), "src/components/admin/AdminLiveEventMetrics.tsx"),
  "utf8",
);
const adminVideoDateTimelinePanel = readFileSync(
  join(process.cwd(), "src/components/admin/AdminVideoDateTimelinePanel.tsx"),
  "utf8",
);
const adminDashboardPage = readFileSync(
  join(process.cwd(), "src/pages/admin/AdminDashboard.tsx"),
  "utf8",
);
const webDashboardPage = readFileSync(
  join(process.cwd(), "src/pages/Dashboard.tsx"),
  "utf8",
);
const webActiveCallBanner = readFileSync(
  join(process.cwd(), "src/components/events/ActiveCallBanner.tsx"),
  "utf8",
);
const nativeTabsHome = readFileSync(
  join(process.cwd(), "apps/mobile/app/(tabs)/index.tsx"),
  "utf8",
);
const nativeActiveCallBanner = readFileSync(
  join(process.cwd(), "apps/mobile/components/events/ActiveCallBanner.tsx"),
  "utf8",
);

function readMigrationRange(fromVersionInclusive: string): string {
  const dir = join(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && name.slice(0, 14) >= fromVersionInclusive)
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n\n");
}

function listFiles(root: string): string[] {
  const base = join(process.cwd(), root);
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(base, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(join(root, entry.name)));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}
const webConnectionOverlay = readFileSync(
  join(process.cwd(), "src/components/video-date/ConnectionOverlay.tsx"),
  "utf8",
);
const webSelfViewPip = readFileSync(
  join(process.cwd(), "src/components/video-date/SelfViewPIP.tsx"),
  "utf8",
);
const webReconnectionOverlay = readFileSync(
  join(process.cwd(), "src/components/video-date/ReconnectionOverlay.tsx"),
  "utf8",
);
const webReconnectionHook = readFileSync(
  join(process.cwd(), "src/hooks/useReconnection.ts"),
  "utf8",
);
const nativeEventLobby = readFileSync(
  join(process.cwd(), "apps/mobile/app/event/[eventId]/lobby.tsx"),
  "utf8",
);
const nativeHomeRoute = readFileSync(
  join(process.cwd(), "apps/mobile/app/(tabs)/index.tsx"),
  "utf8",
);
const nativeSafeAudioMode = readFileSync(
  join(process.cwd(), "apps/mobile/lib/safeAudioMode.ts"),
  "utf8",
);
const nativePackageJson = readFileSync(
  join(process.cwd(), "apps/mobile/package.json"),
  "utf8",
);
const webPostDateSurvey = readFileSync(
  join(process.cwd(), "src/components/video-date/PostDateSurvey.tsx"),
  "utf8",
);
const nativePostDateSurvey = readFileSync(
  join(process.cwd(), "apps/mobile/components/video-date/PostDateSurvey.tsx"),
  "utf8",
);
const sharedVideoDateEntryRetryPolicy = readFileSync(
  join(process.cwd(), "shared/matching/videoDateEntryRetryPolicy.ts"),
  "utf8",
);
const sharedDailyJoinedConfirmation = readFileSync(
  join(process.cwd(), "shared/matching/dailyJoinedConfirmation.ts"),
  "utf8",
);
const nativeVideoDateApi = readFileSync(
  join(process.cwd(), "apps/mobile/lib/videoDateApi.ts"),
  "utf8",
);
const nativeVideoDateApiClientWritableStatusType = nativeVideoDateApi.match(
  /export type ClientWritableParticipantStatus =[\s\S]*?;/,
)?.[0] ?? "";
const notificationDeepLinkHandler = readFileSync(
  join(process.cwd(), "apps/mobile/components/NotificationDeepLinkHandler.tsx"),
  "utf8",
);
const lobbyToPostDateJourney = readFileSync(
  join(process.cwd(), "shared/analytics/lobbyToPostDateJourney.ts"),
  "utf8",
);
const videoDateJourneyTraceMap = readFileSync(
  join(process.cwd(), "shared/observability/videoDateJourneyTraceMap.ts"),
  "utf8",
);

test("credit extension parser preserves server-returned seconds and totals", () => {
  assert.deepEqual(
    parseSpendVideoDateCreditExtensionPayload({
      success: true,
      added_seconds: 120,
      date_extra_seconds: 420,
      idempotent: true,
    }),
    {
      success: true,
      addedSeconds: 120,
      dateExtraSeconds: 420,
      idempotent: true,
    },
  );
});

test("date remaining time is recomputed from server date_extra_seconds", () => {
  assert.equal(
    remainingDatePhaseSeconds({
      dateStartedAtIso: "2026-04-24T10:00:00.000Z",
      baseDateSeconds: 300,
      dateExtraSeconds: 120,
      nowMs: Date.parse("2026-04-24T10:02:00.000Z"),
    }),
    300,
  );
});

test("started-at countdown recomputes handshake time from server timestamp", () => {
  const startedAtIso = "2026-04-24T10:00:00.000Z";
  assert.equal(
    remainingStartedAtCountdownSeconds({
      startedAtIso,
      durationSeconds: 60,
      nowMs: Date.parse("2026-04-24T10:00:35.250Z"),
    }),
    25,
  );
  assert.equal(
    remainingStartedAtCountdownSeconds({
      startedAtIso,
      durationSeconds: 60,
      nowMs: Date.parse("2026-04-24T10:01:00.001Z"),
    }),
    0,
  );
  assert.equal(
    startedAtCountdownDeadlineMs({ startedAtIso, durationSeconds: 60 }),
    Date.parse("2026-04-24T10:01:00.000Z"),
  );
});

test("handshake truth select carries server date timing for timer reconciliation", () => {
  assert.match(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT, /handshake_started_at/);
  assert.match(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT, /date_started_at/);
  assert.match(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT, /date_extra_seconds/);
});

test("post-date continuity uses event timing for nearly-over state", () => {
  const nowMs = Date.parse("2026-04-24T10:00:00.000Z");
  const endsAt = "2026-04-24T10:04:59.000Z";
  const seconds = secondsUntilPostDateEventEnd(endsAt, nowMs);
  assert.equal(seconds, 299);
  assert.equal(isPostDateEventNearlyOver(seconds), true);
});

test("post-date survey continuity prioritizes real queued sessions over deck copy", () => {
  assert.deepEqual(
    getPostDateSurveyContinuityDecision({
      isDrainingQueue: false,
      queuedCount: 1,
      isSubmittingSurvey: false,
      eventActive: true,
      secondsUntilEventEnd: 600,
      hasEventId: true,
    }).action,
    "ready_gate",
  );
});

test("post-date survey queue drain waits for resolved live event lifecycle", () => {
  assert.equal(
    getPostDateSurveyContinuityDecision({
      isDrainingQueue: false,
      queuedCount: 0,
      isSubmittingSurvey: false,
      eventActive: false,
      eventLifecycleResolved: false,
      secondsUntilEventEnd: null,
      hasEventId: true,
    }).tone,
    "checking",
  );
  assert.equal(
    shouldEnablePostDateSurveyQueueDrain({
      hasEventId: true,
      eventLifecycleResolved: false,
      eventActive: false,
      secondsUntilEventEnd: null,
    }),
    false,
  );
  assert.equal(
    shouldEnablePostDateSurveyQueueDrain({
      hasEventId: true,
      eventLifecycleResolved: true,
      eventActive: false,
      secondsUntilEventEnd: 0,
    }),
    false,
  );
  assert.equal(
    shouldEnablePostDateSurveyQueueDrain({
      hasEventId: true,
      eventLifecycleResolved: true,
      eventActive: true,
      secondsUntilEventEnd: 600,
    }),
    true,
  );
});

test("post-date lobby continuity distinguishes fresh cards from calm empty state", () => {
  assert.equal(
    getPostDateLobbyContinuityDecision({
      yieldingToVideoDate: false,
      yieldingToReadyGate: false,
      hasQueuedSession: false,
      deckLoading: false,
      deckHasCandidate: true,
      deckError: false,
      eventLive: true,
      secondsUntilEventEnd: 600,
    }).action,
    "fresh_deck",
  );
  assert.equal(
    getPostDateLobbyContinuityDecision({
      yieldingToVideoDate: false,
      yieldingToReadyGate: false,
      hasQueuedSession: false,
      deckLoading: false,
      deckHasCandidate: false,
      deckError: false,
      eventLive: true,
      secondsUntilEventEnd: 600,
    }).action,
    "empty_deck",
  );
});

test("migration adds idempotent credit extension ledger and optional key", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_credit_extension_spends/);
  assert.match(migration, /UNIQUE \(session_id, user_id, credit_type, idempotency_key\)/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.spend_video_date_credit_extension\(\s+p_session_id uuid,\s+p_credit_type text,\s+p_idempotency_key text DEFAULT NULL/s,
  );
  assert.match(migration, /'idempotent', true/);
});

test("migration gates post-date verdicts to terminal date-phase sessions", () => {
  assert.match(migration, /v_session\.ended_at IS NULL/);
  assert.match(migration, /v_session\.date_started_at IS NULL/);
  assert.match(migration, /'session_not_survey_eligible'/);
  assert.match(migration, /'handshake_not_mutual'/);
  assert.match(migration, /'ready_gate_expired'/);
});

test("migration serializes super-vibe cap checks per actor and event", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /handle_swipe_super_vibe_cap/);
  assert.match(migration, /SELECT COUNT\(\*\) INTO v_super_count/);
});

test("swipe recovery migration serializes mirrored mutual swipes before mutuality check", () => {
  assert.match(swipeRecoveryMigration, /handle_swipe_mutual_pair/);
  assert.match(
    swipeRecoveryMigration,
    /PERFORM pg_advisory_xact_lock\([\s\S]*handle_swipe_mutual_pair[\s\S]*INSERT INTO public\.event_swipes[\s\S]*SELECT EXISTS/s,
  );
  assert.match(
    swipeRecoveryMigration,
    /ON CONFLICT \(event_id, participant_1_id, participant_2_id\) DO NOTHING[\s\S]*RETURNING id INTO v_session_id/s,
  );
});

test("swipe recovery migration returns routable session id for already-matched active pair", () => {
  assert.match(
    swipeRecoveryMigration,
    /IF v_session_id IS NULL THEN[\s\S]*SELECT id, ready_gate_status[\s\S]*INTO v_session_id, v_existing_status[\s\S]*AND ended_at IS NULL/s,
  );
  assert.match(
    swipeRecoveryMigration,
    /'result', 'already_matched'[\s\S]*'match_id', v_session_id[\s\S]*'video_session_id', v_session_id[\s\S]*'event_id', p_event_id[\s\S]*'immediate', v_existing_status IN/s,
  );
  assert.match(
    swipeRecoveryMigration,
    /record_event_loop_observability\([\s\S]*'already_matched'[\s\S]*v_session_id[\s\S]*'ready_gate_status', v_existing_status/s,
  );
});

test("swipe recovery migration restores registration pointers without overriding live date states", () => {
  assert.match(
    swipeRecoveryMigration,
    /queue_status = CASE[\s\S]*v_existing_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\) THEN 'in_ready_gate'[\s\S]*ELSE queue_status/s,
  );
  assert.match(swipeRecoveryMigration, /current_room_id = v_session_id/);
  assert.match(
    swipeRecoveryMigration,
    /queue_status IS NULL OR queue_status NOT IN \('in_handshake', 'in_date', 'in_survey'\)/,
  );
});

test("swipe recovery migration preserves conflict, immediate, queued, and pass outcomes", () => {
  assert.match(swipeRecoveryMigration, /RETURN jsonb_build_object\('result', 'pass_recorded'\)/);
  assert.match(swipeRecoveryMigration, /RETURN jsonb_build_object\('result', 'participant_has_active_session_conflict'\)/);
  assert.match(
    swipeRecoveryMigration,
    /'result', 'match'[\s\S]*'video_session_id', v_session_id[\s\S]*'immediate', true/s,
  );
  assert.match(
    swipeRecoveryMigration,
    /'result', 'match_queued'[\s\S]*'video_session_id', v_session_id[\s\S]*'event_id', p_event_id/s,
  );
});

test("migration extends both_ready join window without reopening expired gates", () => {
  assert.match(migration, /v_new_status := 'both_ready'/);
  assert.match(handshakeJoinStartMigration, /v_now \+ interval '45 seconds'/);
  assert.match(handshakeJoinStartMigration, /both_ready_provider_prepare_grace_extended/);
  assert.match(
    handshakeJoinStartMigration,
    /v_session\.ready_gate_status = 'both_ready'[\s\S]*v_session\.ready_gate_expires_at IS NOT NULL[\s\S]*v_session\.ready_gate_expires_at > v_now/s,
  );
  assert.match(migration, /PERFORM public\.expire_stale_video_sessions\(\)/);
});

test("ready_gate_transition serializes Ready Gate terminal state before mutation", () => {
  const lockIndex = migration.indexOf("SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE");
  const terminalGuardIndex = migration.indexOf("IF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN");
  const markReadyIndex = migration.indexOf("IF p_action = 'mark_ready' THEN", terminalGuardIndex);
  const snoozeIndex = migration.indexOf("IF p_action = 'snooze' THEN", terminalGuardIndex);
  const forfeitIndex = migration.indexOf("IF p_action = 'forfeit' THEN", terminalGuardIndex);

  assert.ok(lockIndex > 0, "ready_gate_transition must lock the video_sessions row");
  assert.ok(terminalGuardIndex > lockIndex, "terminal guard must run after canonical row lock");
  assert.ok(markReadyIndex > terminalGuardIndex, "terminal guard must precede mark_ready mutation");
  assert.ok(snoozeIndex > terminalGuardIndex, "terminal guard must precede snooze mutation");
  assert.ok(forfeitIndex > terminalGuardIndex, "terminal guard must precede forfeit mutation");
  assert.match(migration, /'status', v_session\.ready_gate_status[\s\S]*'ready_gate_expires_at', v_session\.ready_gate_expires_at/);
});

test("pre-date end migration delegates non-end actions through the prior state machine", () => {
  assert.match(
    preDateEndMigration,
    /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260430180000_last_chance_grace_10s/s,
  );
  assert.match(
    preDateEndMigration,
    /IF p_action IS DISTINCT FROM 'end' THEN\s+RETURN public\.video_date_transition_20260430180000_last_chance_grace_10s/s,
  );
  assert.match(
    preDateEndMigration,
    /REVOKE ALL ON FUNCTION public\.video_date_transition_20260430180000_last_chance_grace_10s\(uuid, text, text\)/,
  );
});

test("pre-date manual end cleans registrations without entering survey", () => {
  assert.match(preDateEndMigration, /v_reached_date_phase := \(/);
  assert.match(preDateEndMigration, /ELSE 'pre_date_manual_end'/);
  assert.match(preDateEndMigration, /CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END/);
  assert.match(preDateEndMigration, /CASE WHEN v_reached_date_phase THEN 'date_end_survey' ELSE 'pre_date_end_cleanup' END/);
  assert.match(
    preDateEndMigration,
    /ELSE\s+-- Pre-date termination is not survey-eligible[\s\S]*queue_status = v_resume_status[\s\S]*current_room_id = NULL[\s\S]*current_partner_id = NULL[\s\S]*AND current_room_id = p_session_id/s,
  );
  assert.match(preDateEndMigration, /'survey_eligible', v_reached_date_phase/);
});

test("validation pack checks delegated pre-date cleanup after wrapper layering", () => {
  assert.match(
    videoDateValidationSql,
    /video_date_transition_20260501091000_pre_date_end_cleanup\(uuid,text,text\)/,
  );
  assert.match(videoDateValidationSql, /pre_date_manual_end/);
  assert.match(videoDateValidationSql, /queue_status = v_resume_status/);
});

test("date-phase end still routes pointed registrations to survey", () => {
  assert.match(preDateEndMigration, /v_session\.date_started_at IS NOT NULL/);
  assert.match(preDateEndMigration, /v_session\.state = 'date'::public\.video_date_state/);
  assert.match(
    preDateEndMigration,
    /ELSIF v_reached_date_phase THEN\s+UPDATE public\.event_registrations[\s\S]*queue_status = 'in_survey'[\s\S]*AND current_room_id = p_session_id/s,
  );
});

test("pre-date end remains terminal and reconnect-compatible", () => {
  assert.match(preDateEndMigration, /IF v_session\.ended_at IS NOT NULL THEN[\s\S]*'already_ended', true/s);
  assert.match(preDateEndMigration, /'reconnect_grace_expired'/);
  assert.match(
    preDateEndMigration,
    /'survey_eligible', v_session\.date_started_at IS NOT NULL/s,
  );
  assert.match(
    preDateEndMigration,
    /WHEN v_reached_date_phase AND COALESCE\(p_reason, ''\) = 'reconnect_grace_expired' THEN 'idle'/,
  );
});

test("prepare_entry migration adds an atomic server-owned prewarm action", () => {
  assert.match(prepareEntryMigration, /p_action IS DISTINCT FROM 'prepare_entry'/);
  assert.match(prepareEntryMigration, /FOR UPDATE/);
  assert.match(prepareEntryMigration, /reconnect_grace_ends_at IS NOT NULL[\s\S]*reconnect_grace_expired/s);
  assert.match(prepareEntryMigration, /reconnect_grace_expired[\s\S]*current_room_id = p_session_id/s);
  assert.match(prepareEntryMigration, /ready_gate_status[\s\S]*'both_ready'[\s\S]*ready_gate_expires_at > v_now/s);
  assert.match(prepareEntryMigration, /state = CASE[\s\S]*'handshake'::public\.video_date_state/s);
  assert.match(prepareEntryMigration, /queue_status = v_registration_status/);
});

test("prepare_entry rejects ended, blocked, expired, and non-participant callers", () => {
  assert.match(prepareEntryMigration, /'code', 'SESSION_ENDED'/);
  assert.match(prepareEntryMigration, /'code', 'ACCESS_DENIED'/);
  assert.match(prepareEntryMigration, /FROM public\.blocked_users/);
  assert.match(prepareEntryMigration, /'code', 'BLOCKED_PAIR'/);
  assert.match(prepareEntryMigration, /NOT v_already_entry AND NOT v_gate_live/);
  assert.match(prepareEntryMigration, /'code', 'READY_GATE_NOT_READY'/);
});

test("daily-room prepare_date_entry creates deterministic rooms and scoped tokens", () => {
  assert.match(dailyRoomFunction, /action === "prepare_date_entry"/);
  assert.match(dailyRoomFunction, /p_action: "prepare_entry"/);
  assert.match(dailyRoomFunction, /videoDateRoomNameForSession/);
  assert.match(dailyRoomContracts, /function videoDateRoomNameForSession\(sessionId: string\): string/);
  assert.match(dailyRoomContracts, /function buildMeetingTokenProperties/);
  assert.match(dailyRoomFunction, /max_participants: 2/);
  assert.match(dailyRoomFunction, /enable_chat: false/);
  assert.match(dailyRoomFunction, /enable_screenshare: false/);
  assert.match(dailyRoomFunction, /enable_knocking: false/);
  assert.match(dailyRoomFunction, /enforce_unique_user_ids: true/);
  assert.match(dailyRoomFunction, videoDateRoomNameTokenWithExpiryEject);
  assert.match(dailyRoomFunction, /provider_verify_skipped/);
  assert.match(dailyRoomFunction, /reused_room: reusedRoom/);
});

test("daily-room supports room-only warmup without token issuance or entry transition", () => {
  assert.match(dailyRoomContracts, /"ensure_date_room"/);
  assert.match(dailyRoomFunction, /action === "ensure_date_room"/);
  assert.match(dailyRoomFunction, /Room-only warmup/);
  assert.match(dailyRoomFunction, /ensureVideoDateProviderRoomForToken/);
  const warmupIndex = dailyRoomFunction.indexOf('if (action === "ensure_date_room")');
  const soloIndex = dailyRoomFunction.indexOf('if (action === "prepare_solo_entry")');
  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  assert.ok(warmupIndex > 0);
  assert.ok(soloIndex > warmupIndex || prepareIndex > warmupIndex);
  const warmupEndIndex = Math.min(
    ...[soloIndex, prepareIndex].filter((index) => index > warmupIndex),
  );
  const warmupBlock = dailyRoomFunction.slice(warmupIndex, warmupEndIndex);
  assert.doesNotMatch(warmupBlock, /createMeetingToken/);
  assert.doesNotMatch(warmupBlock, /p_action: "prepare_entry"/);
  assert.doesNotMatch(warmupBlock, /confirmVideoDateEntryPrepared/);
  assert.match(warmupBlock, /"ready"[\s\S]*"ready_a"[\s\S]*"ready_b"[\s\S]*"both_ready"/);
  assert.doesNotMatch(warmupBlock, /"queued"/);
});

test("daily-room solo prejoin is token-only and never route-confirms the session", () => {
  assert.match(dailyRoomContracts, /"prepare_solo_entry"/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_SOLO_PREJOIN_TOKEN_TTL_SECONDS = 180/);
  assert.match(dailyRoomFunction, /function canIssueSoloPrejoinVideoDateToken/);
  assert.match(dailyRoomFunction, /session\.ready_gate_expires_at \? Date\.parse\(session\.ready_gate_expires_at\) : NaN/);
  assert.match(dailyRoomFunction, /expiresAtMs <= Date\.now\(\)/);
  const soloIndex = dailyRoomFunction.indexOf('if (action === "prepare_solo_entry")');
  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  assert.ok(soloIndex > 0);
  assert.ok(prepareIndex > soloIndex);
  const soloBlock = dailyRoomFunction.slice(soloIndex, prepareIndex);
  assert.match(soloBlock, /get_event_lobby_inactive_reason/);
  assert.match(soloBlock, /isPairBlocked/);
  assert.match(soloBlock, /canIssueSoloPrejoinVideoDateToken\(session, user\.id\)/);
  assert.match(soloBlock, /READY_GATE_ALREADY_BOTH_READY/);
  assert.match(soloBlock, /createMeetingToken\([\s\S]*DAILY_VIDEO_DATE_SOLO_PREJOIN_TOKEN_TTL_SECONDS/s);
  assert.match(soloBlock, /solo_prejoin: true/);
  assert.doesNotMatch(soloBlock, /confirmVideoDateEntryPrepared/);
  assert.doesNotMatch(soloBlock, /p_action: "prepare_entry"/);
  assert.doesNotMatch(soloBlock, /confirm_video_date_entry_prepared/);
});

test("daily-room freshness proof and token guards reject stale terminal shortcuts", () => {
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_PROVIDER_PROOF_CLOCK_SKEW_MS/);
  assert.match(dailyRoomFunction, /verifiedAtMs - nowMs > DAILY_VIDEO_DATE_PROVIDER_PROOF_CLOCK_SKEW_MS/);
  assert.match(dailyRoomFunction, /function videoDateRoomGateSessionEnded/);
  assert.match(dailyRoomFunction, /session\.state === "ended"/);
  assert.match(dailyRoomFunction, /session\.phase === "ended"/);
  assert.match(dailyRoomFunction, /if \(videoDateRoomGateSessionEnded\(session\)\)/);
});

test("prepare_entry remains idempotent for concurrent and already-entry calls", () => {
  assert.match(prepareEntryMigration, /SELECT \* INTO v_session[\s\S]*FOR UPDATE/);
  assert.match(
    prepareEntryMigration,
    /v_already_entry := \([\s\S]*handshake_started_at IS NOT NULL[\s\S]*state IN \('handshake'::public\.video_date_state, 'date'::public\.video_date_state\)[\s\S]*date_started_at IS NOT NULL/s,
  );
  assert.match(prepareEntryMigration, /IF NOT v_already_entry AND NOT v_gate_live THEN/);
  assert.match(prepareEntryMigration, /handshake_started_at = COALESCE\(handshake_started_at, v_now\)/);
  assert.match(prepareEntryMigration, /CASE WHEN v_already_entry THEN 'prepare_entry_already_active' ELSE 'prepare_entry_entered' END/);
});

test("daily-room prepare_date_entry preserves auth, participant, and delete-room boundaries", () => {
  assert.match(dailyRoomFunction, /if \(!authHeader\)/);
  assert.match(dailyRoomFunction, /supabase\.auth\.getUser\(\)/);
  assert.match(dailyRoomFunction, /if \(participant1 !== user\.id && participant2 !== user\.id\)/);
  assert.match(dailyRoomFunction, /code: "ACCESS_DENIED"/);
  assert.match(dailyRoomFunction, /service_role_post_prepare_block_check/);
  assert.doesNotMatch(dailyRoomFunction, /token[^;\n]*\.from\("video_sessions"\)/);
  assert.match(dailyRoomFunction, /if \(action === "delete_room"\)/);
  assert.match(dailyRoomFunction, /roomType === "video_date"[\s\S]*classifyDeleteRoomSafety/s);
  assert.match(dailyRoomContracts, /VIDEO_DATE_CLEANUP_OWNED_BY_CRON/);
});

test("daily-room makes DAILY_DOMAIN fallback visible without logging secrets", () => {
  assert.match(dailyRoomFunction, /const DAILY_DOMAIN_FALLBACK = "vibelyapp\.daily\.co"/);
  assert.match(dailyRoomFunction, /DAILY_DOMAIN_ENV \|\| DAILY_DOMAIN_FALLBACK/);
  assert.match(dailyRoomFunction, /event: "daily_domain_env_missing"/);
  assert.match(dailyRoomFunction, /code: "DAILY_DOMAIN_FALLBACK_USED"/);
  assert.doesNotMatch(dailyRoomFunction, /DAILY_API_KEY[\s\S]{0,200}daily_domain_env_missing/);
});

test("daily-room prepare_date_entry verifies or recreates unsafe provider room state before token issuance", () => {
  assert.match(dailyRoomFunction, /async function ensureVideoDateProviderRoomForToken/);
  assert.match(dailyRoomFunction, /hasFreshVideoDateProviderRoomProof/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_PROVIDER_PROOF_FRESH_MS/);
  assert.match(dailyRoomFunction, /const providerRoomState = await getDailyRoomProviderState\(roomName\)/);
  assert.match(dailyRoomFunction, /const recoveryPlan = planDailyProviderRoomRecovery\(providerRoomState\)/);
  assert.match(dailyRoomFunction, /if \(recoveryPlan\.shouldCreate\) \{/);
  assert.match(dailyRoomFunction, /video_date_provider_room_missing_or_expired_recovering/);
  assert.match(dailyRoomFunction, /await createDailyRoom\(roomName, videoDateRoomProperties\(\)\)/);
  assert.match(dailyRoomFunction, /providerRoomRecovered = Boolean\(existingRoomName\) \|\| providerRoomState\.expired/);
  assert.match(dailyRoomFunction, /providerVerifySkipped: true/);
  assert.match(dailyRoomFunction, /providerVerifySkipped: false/);
  assert.match(dailyRoomFunction, /fresh_provider_room_proof/);
  assert.doesNotMatch(dailyRoomFunction, /skip.*old DB metadata/i);

  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  const prepareTokenIndex = indexOfMatch(dailyRoomFunction, videoDateRoomNameTokenWithExpiryEject, prepareIndex);
  const prepareVerifyIndex = dailyRoomFunction.indexOf("ensureVideoDateProviderRoomForToken", prepareIndex);
  assert.ok(prepareVerifyIndex > prepareIndex);
  assert.ok(prepareTokenIndex > prepareVerifyIndex);
});

test("legacy join_date_room verifies or recovers provider room before token issuance", () => {
  const joinIndex = dailyRoomFunction.indexOf('if (action === "join_date_room")');
  const nextActionIndex = dailyRoomFunction.indexOf("if (action === \"create_match_call\")", joinIndex);
  const joinBlock = dailyRoomFunction.slice(joinIndex, nextActionIndex);

  assert.match(joinBlock, /daily_room_name, daily_room_url/);
  assert.match(joinBlock, /if \(videoDateRoomGateSessionEnded\(session\)\)[\s\S]*code: "SESSION_ENDED"/);
  assert.match(joinBlock, /if \(!canIssueVideoDateRoomToken\(session\)\)[\s\S]*code: "READY_GATE_NOT_READY"/);
  assert.doesNotMatch(joinBlock, /if \(!session\.daily_room_name\)[\s\S]*code: "ROOM_NOT_FOUND"/);
  assert.doesNotMatch(joinBlock, /daily_room_name_guard/);
  assert.match(joinBlock, /const roomProof = await ensureVideoDateProviderRoomForToken/);
  assert.match(joinBlock, videoDateRoomProofTokenWithExpiryEject);
  assert.doesNotMatch(joinBlock, /createMeetingToken\(\s*session\.daily_room_name/);

  const joinVerifyIndex = joinBlock.indexOf("ensureVideoDateProviderRoomForToken");
  const joinTokenIndex = joinBlock.indexOf("createMeetingToken(");
  assert.ok(joinVerifyIndex >= 0);
  assert.ok(joinTokenIndex > joinVerifyIndex);
});

test("web ready-gate paths do not navigate to date before prepare-entry succeeds", () => {
  assert.doesNotMatch(readyGateOverlay, /PREPARE_ENTRY_NAV_GRACE_MS/);
  assert.doesNotMatch(readyGateOverlay, /both_ready_prepare_grace/);
  assert.match(readyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_SLOW_WAIT/);
  assert.match(readyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV/);
  assert.match(readyGateOverlay, /navigateToDate\("both_ready_prepare_success"\)/);

  assert.doesNotMatch(eventLobby, /PREPARE_ENTRY_NAV_GRACE_MS/);
  assert.doesNotMatch(eventLobby, /prepare_grace/);
  assert.match(eventLobby, /VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV/);
  assert.match(eventLobby, /navigateAfterPrepare\(`\$\{source\}_prepare_done`\)/);
  assert.match(
    eventLobby,
    /VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV[\s\S]*openReadyGateSession\(sessionId, `\$\{source\}_prepare_failed_ready_gate_recovery`\)/,
  );
});

test("web lobby opens returned swipe session id immediately", () => {
  assert.match(webSwipeActionHook, /onVideoSessionReady\?\.\(sessionId\)/);
  assert.match(
    eventLobby,
    /onVideoSessionReady:\s*\(videoSessionId\)\s*=>\s*\{[\s\S]*openReadyGateSession\(videoSessionId, "swipe_result"\)[\s\S]*scheduleLobbyConvergenceRefresh\(videoSessionId, "swipe_result"\)/,
  );
});

test("native ready-gate paths are success-gated with no timer fallback route", () => {
  assert.doesNotMatch(nativeReadyGateOverlay, /PREPARE_ENTRY_NAV_GRACE_MS/);
  assert.doesNotMatch(nativeReadyGateOverlay, /both_ready_prepare_grace|prepare_grace/);
  assert.doesNotMatch(nativeReadyGateOverlay, /setTimeout\(\s*\(\)\s*=>[\s\S]{0,200}onNavigateToDate/s);
  assert.match(nativeReadyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_SLOW_WAIT/);
  assert.match(nativeReadyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV/);
  assert.match(nativeReadyGateOverlay, /if \(result\.ok === true\) \{[\s\S]*preAuthNativeVideoDateDailyPrewarm[\s\S]*navigateWithLatency\(`\$\{source\}_prepare_success`\)/s);
  assert.match(nativeReadyGateOverlay, /setPrepareEntryStatus\('failed'\)/);
  assert.match(nativeReadyGateOverlay, /retryPrepareEntry/);
});

test("web and native ready-gate handoff use shared retry policy", () => {
  assert.match(sharedVideoDateEntryRetryPolicy, /VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS = 3_000/);
  assert.match(sharedVideoDateEntryRetryPolicy, /VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS = \[1_000, 2_000, 4_000, 8_000\]/);
  assert.match(sharedVideoDateEntryRetryPolicy, /VIDEO_DATE_ENTRY_HANDOFF_STATUS_COPY/);
  assert.match(sharedVideoDateEntryRetryPolicy, /Joining your date/);
  assert.match(sharedVideoDateEntryRetryPolicy, /Holding your date/);
  assert.match(sharedVideoDateEntryRetryPolicy, /Retrying connection/);
  assert.match(sharedVideoDateEntryRetryPolicy, /function shouldRetryVideoDateEntryHandoffFailure/);
  for (const source of [readyGateOverlay, nativeReadyGateOverlay]) {
    assert.match(source, /VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS/);
    assert.match(source, /VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS/);
    assert.match(source, /getVideoDateEntryHandoffStatusCopy/);
    assert.match(source, /shouldRetryVideoDateEntryHandoffFailure/);
    assert.doesNotMatch(source, /const PREPARE_ENTRY_SLOW_WAIT_MS|const PREPARE_ENTRY_RETRY_DELAYS_MS/);
  }
});

test("ready-gate terminal actions wait for server forfeit before closing", () => {
  assert.match(webReadyGateHook, /type ReadyGateTransitionAction = "mark_ready" \| "forfeit" \| "snooze" \| "sync"/);
  assert.match(webReadyGateHook, /type ReadyGateTransitionResult = ReadyGateSyncResult/);
  assert.match(webReadyGateHook, /Promise<ReadyGateTransitionResult>/);
  assert.match(webReadyGateHook, /const skip = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(webReadyGateHook, /const \{ error \} = await supabase\.rpc\("ready_gate_transition"/);
  assert.match(webReadyGateHook, /const syncSession = useCallback\(async \(\): Promise<ReadyGateSyncResult> =>/);
  assert.match(webReadyGateHook, /p_action: "sync" satisfies ReadyGateTransitionAction/);
  assert.match(webReadyGateHook, /return applyReadyGateTruth\(\{[\s\S]*ready_gate_status:[\s\S]*payload\.ready_gate_status[\s\S]*payload\.result_status/s);
  assert.match(webReadyGateHook, /ok: false[\s\S]*ok: true/);
  assert.match(readyGateOverlay, /const runTerminalAction = useCallback\(/);
  assert.match(readyGateOverlay, /const result = await skip\(\)/);
  assert.match(readyGateOverlay, /if \(!result\.ok\) \{[\s\S]*ready_gate_forfeit_failed/s);
  assert.match(readyGateOverlay, /result\.status === "both_ready"/);
  assert.match(readyGateOverlay, /manualExitRequestedRef/);
  assert.match(readyGateOverlay, /setTerminalActionError\(message\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("skip_this_one"\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("cancel_go_back"\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("prepare_failed_back"\)/);
  assert.doesNotMatch(
    readyGateOverlay,
    /closedRef\.current = true;\s*skip\(\);\s*setStatus\("browsing"\);\s*onClose\(\);/,
  );

  assert.match(nativeReadyGateApi, /type ReadyGateTransitionAction = 'mark_ready' \| 'forfeit' \| 'snooze' \| 'sync'/);
  assert.match(nativeReadyGateApi, /export type ReadyGateTransitionResult = ReadyGateSyncResult/);
  assert.match(nativeReadyGateApi, /Promise<ReadyGateTransitionResult>/);
  assert.match(nativeReadyGateApi, /const forfeit = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(nativeReadyGateApi, /const \{ error \} = await supabase\.rpc\('ready_gate_transition'/);
  assert.match(nativeReadyGateApi, /const syncSession = useCallback\(async \(\): Promise<ReadyGateSyncResult> =>/);
  assert.match(nativeReadyGateApi, /p_action: 'sync' satisfies ReadyGateTransitionAction/);
  assert.match(nativeReadyGateApi, /return applyReadyGateTruth\(\{[\s\S]*ready_gate_status:[\s\S]*payload\.ready_gate_status[\s\S]*payload\.result_status/s);
  assert.match(nativeReadyGateApi, /ok: false[\s\S]*ok: true/);
  assert.match(nativeReadyGateOverlay, /const handleSkip = useCallback\(async \(reason: 'skip' = 'skip'\) =>/);
  assert.match(nativeReadyGateOverlay, /const result = await forfeit\(\)/);
  assert.match(nativeReadyGateOverlay, /if \(!result\.ok\) throw new Error\('ready_gate_forfeit_failed'\)/);
  assert.match(nativeReadyGateOverlay, /result\.status === 'both_ready'/);
  assert.match(nativeReadyGateOverlay, /manualExitRequestedRef/);
  assert.match(nativeReadyGateOverlay, /setTerminalActionError\(message\)/);
  assert.match(nativeReadyGateOverlay, /pendingForfeitReasonRef\.current = reason/);
  assert.doesNotMatch(
    nativeReadyGateOverlay,
    /closedRef\.current = true;\s*void forfeit\(\);\s*void updateParticipantStatus\(eventId, 'browsing'\);\s*onClose\(\);/,
  );
});

test("ready-gate RPC failures surface retryable UI and web expiry syncs server truth", () => {
  assert.match(webReadyGateHook, /const markReady = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(webReadyGateHook, /const snooze = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(webReadyGateHook, /runReadyGateTransition\("mark_ready"\)/);
  assert.match(webReadyGateHook, /runReadyGateTransition\("snooze"\)/);
  assert.match(readyGateOverlay, /const result = await markReady\(\)/);
  assert.match(readyGateOverlay, /if \(!result\.ok\) \{[\s\S]*ready_gate_mark_ready_failed/s);
  assert.match(readyGateOverlay, /throw new Error\("ready_gate_mark_ready_failed"\)/);
  assert.match(readyGateOverlay, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(readyGateOverlay, /const result = await snooze\(\)/);
  assert.match(readyGateOverlay, /if \(!result\.ok\) \{[\s\S]*ready_gate_snooze_failed/s);
  assert.match(readyGateOverlay, /throw new Error\("ready_gate_snooze_failed"\)/);
  assert.match(readyGateOverlay, /We couldn't snooze this match\. Check your connection and try again\./);
  assert.match(readyGateOverlay, /EXPIRY_SYNC_RETRY_DELAY_MS/);
  assert.match(readyGateOverlay, /source === "initial" \|\| source === "poll"[\s\S]*const syncResult = await syncSession\(\)/);
  assert.match(readyGateOverlay, /void syncSession\(\)[\s\S]*countdown expiry sync deferred after RPC error/s);
  assert.doesNotMatch(readyGateOverlay, /timeout_auto_forfeit|timeoutForfeitSentRef|TIMEOUT_FORFEIT/);
  assert.doesNotMatch(readyGateOverlay, /next <= 0[\s\S]{0,320}skip\(\)/);

  assert.match(nativeReadyGateApi, /const markReady = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(nativeReadyGateApi, /const snooze = useCallback\(async \(\): Promise<ReadyGateTransitionResult> =>/);
  assert.match(nativeReadyGateApi, /runReadyGateTransition\('mark_ready'\)/);
  assert.match(nativeReadyGateApi, /runReadyGateTransition\('snooze'\)/);
  assert.match(nativeReadyGateOverlay, /const result = await markReady\(\)/);
  assert.match(nativeReadyGateOverlay, /if \(!result\.ok\) throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyGateOverlay, /throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyGateOverlay, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(nativeReadyGateOverlay, /const result = await snooze\(\)/);
  assert.match(nativeReadyGateOverlay, /if \(!result\.ok\) throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyGateOverlay, /throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyGateOverlay, /We couldn't snooze this match\. Check your connection and try again\./);
  assert.match(nativeReadyGateOverlay, /EXPIRY_SYNC_RETRY_DELAY_MS/);
  assert.match(nativeReadyGateOverlay, /void syncSession\(\)[\s\S]*countdown_expiry_sync_deferred/s);
  assert.doesNotMatch(nativeReadyGateOverlay, /TIMEOUT_FORFEIT|timeoutForfeit|timeout_auto_forfeit|handleSkip\('timeout'\)/);

  assert.match(nativeReadyRoute, /const runReadyGateForfeit = useCallback\(/);
  assert.match(nativeReadyRoute, /const result = await forfeit\(\)/);
  assert.match(nativeReadyRoute, /if \(!result\.ok\) throw new Error\('ready_gate_forfeit_failed'\)/);
  assert.match(nativeReadyRoute, /setTerminalActionError\("We couldn't step away\. Check your connection and try again\."\)/);
  assert.match(nativeReadyRoute, /EXPIRY_SYNC_RETRY_DELAY_MS/);
  assert.match(nativeReadyRoute, /const syncExpiredReadyGate = useCallback/);
  assert.match(nativeReadyRoute, /const result = await syncSession\(\)/);
  assert.match(nativeReadyRoute, /standalone_countdown_expiry_sync_deferred/);
  assert.doesNotMatch(nativeReadyRoute, /TIMEOUT_FORFEIT|timeoutForfeit|runReadyGateForfeit\('timeout'\)/);
  assert.match(nativeReadyRoute, /primaryAction: \{ label: 'Step away', onPress: \(\) => \{ void runReadyGateForfeit\('skip'\); \} \}/);
  assert.doesNotMatch(nativeReadyRoute, /forfeit\(\);\s*return 0/);
  assert.match(nativeReadyRoute, /const result = await markReady\(\)/);
  assert.match(nativeReadyRoute, /if \(!result\.ok\) throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyRoute, /throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyRoute, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(nativeReadyRoute, /const result = await snooze\(\)/);
  assert.match(nativeReadyRoute, /if \(!result\.ok\) throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyRoute, /throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyRoute, /We couldn't snooze this match\. Check your connection and try again\./);
});

test("ready-gate mark_ready both_ready uses RPC short-circuit telemetry", () => {
  assert.match(rpcShortCircuitAndKeepwarmMigration, /result_status/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /result_ready_gate_status/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /ready_gate_transition_20260505214500_result_status_base/);
  assert.match(
    rpcShortCircuitAndKeepwarmMigration,
    /v_status := COALESCE\([\s\S]*v_result->>'ready_gate_status'[\s\S]*v_result->>'status'[\s\S]*v_result->>'result_status'/,
  );
  assert.match(rpcShortCircuitAndKeepwarmMigration, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base/);

  assert.match(webReadyGateHook, /bothReadySourceAction:[\s\S]*action === "mark_ready"[\s\S]*ReadyGateStatus\.BothReady[\s\S]*both_ready_observed_via_rpc_short_circuit/s);
  assert.match(nativeReadyGateApi, /bothReadySourceAction:[\s\S]*action === 'mark_ready'[\s\S]*payloadStatus === BOTH_READY[\s\S]*both_ready_observed_via_rpc_short_circuit/s);
  assert.match(readyGateOverlay, /sourceAction: "both_ready_observed" \| "both_ready_observed_via_rpc_short_circuit"/);
  assert.match(nativeReadyGateOverlay, /sourceAction: 'both_ready_observed' \| 'both_ready_observed_via_rpc_short_circuit'/);
  assert.match(launchLatencyCheckpointObservability, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(videoDateOperatorMetrics, /both_ready_observed_via_rpc_short_circuit/);
});

test("daily-room health ping and edge cold-start timing are additive", () => {
  assert.match(dailyRoomFunction, /EDGE_PROCESS_STARTED_AT_MS = Date\.now\(\)/);
  assert.match(dailyRoomFunction, /createDailyRoomHealthPingResponse/);
  assert.match(dailyRoomFunction, /action === "health_ping"[\s\S]*x-cron-secret/s);
  assert.match(dailyRoomFunction, /edge_cold_start_ms: params\.edgeProcessUptimeMs/);
  assert.match(dailyRoomFunction, /timings\.edge_cold_start_ms = edgeProcessUptimeMs/);
  assert.match(dailyRoomFunction, /timings\.edge_process_uptime_ms = edgeProcessUptimeMs/);
  assert.match(webPrepareEntry, /edge_cold_start_ms: result\.data\.timings\?\.edge_cold_start_ms/);
  assert.match(nativePrepareEntry, /edge_cold_start_ms: result\.data\.timings\?\.edge_cold_start_ms/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /daily-room-keepwarm/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /'anon_key', 'supabase_anon_key', 'service_role_key'/);
  assert.match(rpcShortCircuitAndKeepwarmMigration, /missing project_url, cron_secret, or function JWT secret/);
  assert.match(supabaseConfig, /\[functions\.daily-room\][\s\S]{0,80}verify_jwt = true/);
});

test("daily-room classifies Daily provider failures without leaking raw response bodies", () => {
  assert.match(dailyRoomFunction, /status === 401 \|\| status === 403[\s\S]*DAILY_AUTH_FAILED/s);
  assert.match(dailyRoomFunction, /status === 429[\s\S]*DAILY_RATE_LIMIT[\s\S]*httpStatus: 429/s);
  assert.match(dailyRoomFunction, /headers\["Retry-After"\] = retryAfter/);
  assert.match(dailyRoomFunction, /retry_after_seconds: Number\(retryAfter\)/);
  assert.match(dailyRoomFunction, /DAILY_PROVIDER_MAX_RETRY_SLEEP_SECONDS/);
  assert.match(dailyRoomFunction, /waitForBoundedDailyProviderRetry/);
  assert.match(dailyRoomFunction, /status >= 500[\s\S]*DAILY_PROVIDER_UNAVAILABLE/s);
  assert.match(dailyRoomFunction, /status >= 400[\s\S]*DAILY_REQUEST_REJECTED/s);
  assert.match(dailyRoomFunction, /event: "daily_provider_error"/);
  assert.match(dailyRoomFunction, /provider_status: params\.error\.status/);
  assert.doesNotMatch(dailyRoomFunction, /Daily API error \$\{res\.status\}: \$\{errText\}/);
});

test("video_sessions active lookup indexes are additive partial indexes", () => {
  assert.match(
    activeLookupIndexesMigration,
    /CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_1_active\s+ON public\.video_sessions\(participant_1_id\)\s+WHERE ended_at IS NULL;/,
  );
  assert.match(
    activeLookupIndexesMigration,
    /CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_2_active\s+ON public\.video_sessions\(participant_2_id\)\s+WHERE ended_at IS NULL;/,
  );
});

test("pending post-date survey recovery has narrow lookup indexes", () => {
  assert.match(
    pendingSurveyRecoveryIndexesMigration,
    /CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_1_pending_survey\s+ON public\.video_sessions\(participant_1_id, ended_at DESC\)\s+WHERE ended_at IS NOT NULL\s+AND date_started_at IS NOT NULL;/,
  );
  assert.match(
    pendingSurveyRecoveryIndexesMigration,
    /CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_2_pending_survey\s+ON public\.video_sessions\(participant_2_id, ended_at DESC\)\s+WHERE ended_at IS NOT NULL\s+AND date_started_at IS NOT NULL;/,
  );
  assert.match(
    pendingSurveyRecoveryIndexesMigration,
    /CREATE INDEX IF NOT EXISTS idx_date_feedback_user_session\s+ON public\.date_feedback\(user_id, session_id\);/,
  );
});

test("video-date room cleanup checks Daily presence before destructive delete", () => {
  assert.match(videoDateRoomCleanupFunction, /\/rooms\/\$\{encodeURIComponent\(roomName\)\}\/presence/);
  assert.match(videoDateRoomCleanupFunction, /type VideoDateCleanupRow/);
  assert.match(videoDateRoomCleanupFunction, /function hasTerminalCleanupState\(row: VideoDateCleanupRow\)/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_deferred_non_terminal_state/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_deferred_active_participants/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_deferred_provider_check_failed/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_delete_failed/);
  assert.match(
    videoDateRoomCleanupFunction,
    /select\(\s*"id, daily_room_name, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, state, phase"/,
  );
  assert.match(
    videoDateRoomCleanupFunction,
    /function providerFailureReason\(status: number \| null\): string \{[\s\S]*status === 429[\s\S]*provider_rate_limited[\s\S]*status >= 500[\s\S]*provider_unavailable/s,
  );
  assert.match(videoDateRoomCleanupFunction, /fetchWithTimeout/);
  assert.match(videoDateRoomCleanupFunction, /enforceProviderRateLimit\(supabase, providerRateLimitConfig\("daily", params\.bucket\)\)/);
  assert.match(videoDateRoomCleanupFunction, /bucket: "room_lookup"/);
  assert.match(videoDateRoomCleanupFunction, /bucket: "room_delete"/);
  assert.match(videoDateRoomCleanupFunction, /parseRetryAfterSeconds\(res\.headers, 30\)/);
  assert.match(videoDateRoomCleanupFunction, /headers\["Retry-After"\]/);
  assert.doesNotMatch(videoDateRoomCleanupFunction, /(?<!WithTimeout)fetch\(/);
  assert.match(
    videoDateRoomCleanupFunction,
    /function markRoomCleaned\([\s\S]*endedAt: string \| null[\s\S]*if \(!endedAt\) return false/s,
  );
  assert.match(
    videoDateRoomCleanupFunction,
    /\.eq\("id", sessionId\)[\s\S]*\.eq\("daily_room_name", roomName\)[\s\S]*\.eq\("ended_at", endedAt\)[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/s,
  );
  assert.match(
    videoDateRoomCleanupFunction,
    /return Boolean\(data\?\.id\)/,
  );
  assert.match(videoDateRoomCleanupFunction, /if \(!hasTerminalCleanupState\(row\)\)[\s\S]*continue;/s);
  assert.match(videoDateRoomCleanupFunction, /if \(presence\.ok && presence\.activeCount > 0\)[\s\S]*continue;/s);
  assert.match(videoDateRoomCleanupFunction, /if \(!presence\.ok\)[\s\S]*cleanup_deferred_provider_check_failed[\s\S]*continue;/s);
  assert.match(videoDateRoomCleanupFunction, /if \(presence\.ok && !presence\.exists\)[\s\S]*markRoomCleaned\(supabase, row\.id, name, endedAt\)/s);
  assert.match(videoDateRoomCleanupFunction, /const deleteResult = await deleteDailyRoom\(supabase, name\);[\s\S]*if \(deleteResult\.ok\)[\s\S]*markRoomCleaned\(supabase, row\.id, name, endedAt\)/s);
  assert.match(videoDateRoomCleanupFunction, /provider_rate_limited: providerRateLimited/);
  assert.match(videoDateRoomCleanupFunction, /status: responseStatus/);
  assert.doesNotMatch(videoDateRoomCleanupFunction, /cleanup_hard_delete_after_provider_check_failed/);
  assert.doesNotMatch(videoDateRoomCleanupFunction, /HARD_DELETE_FALLBACK_MS/);
});

test("web and native reject cached prewarmed token after Daily join failure and retry prepare", () => {
  assert.match(webVideoCallHook, /rejectPreparedVideoDateEntry\(sessionId, userId, "daily_join_failed", eventId\)/);
  assert.match(webVideoCallHook, /return startCall\(sessionId, \{ internalRetry: true \}\)/);
  assert.match(nativeVideoDateRoute, /rejectPreparedVideoDateEntry\(sessionId, user\.id, 'daily_join_failed', eventId \|\| null\)/);
  assert.match(nativeVideoDateRoute, /setJoinAttemptNonce\(\(n\) => n \+ 1\)/);
});

test("remaining hardening migration locks video_sessions writes behind server-owned paths", () => {
  assert.match(remainingHardeningMigration, /DROP POLICY IF EXISTS "Participants can create video sessions"/);
  assert.match(remainingHardeningMigration, /DROP POLICY IF EXISTS "Participants can update own feedback"/);
  assert.match(remainingHardeningMigration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.video_sessions FROM anon, authenticated/);
  assert.match(remainingHardeningMigration, /CREATE OR REPLACE FUNCTION public\.get_or_seed_video_session_vibe_questions/);
  assert.match(remainingHardeningMigration, /CREATE TRIGGER enforce_one_active_video_session_before_write/);
  assert.match(remainingHardeningMigration, /participant_has_active_session_conflict/);
  assert.match(remainingHardeningMigration, /pg_advisory_xact_lock/);
});

test("event participant heartbeat RPC is server-stamped without queue-status authority", () => {
  assert.match(eventParticipantHeartbeatMigration, /CREATE OR REPLACE FUNCTION public\.mark_event_participant_heartbeat/);
  assert.match(eventParticipantHeartbeatMigration, /p_event_id uuid/);
  assert.match(eventParticipantHeartbeatMigration, /v_now timestamptz := now\(\)/);
  assert.match(
    eventParticipantHeartbeatMigration,
    /SET last_active_at = v_now[\s\S]*WHERE event_id = p_event_id[\s\S]*AND profile_id = v_uid/s,
  );
  assert.doesNotMatch(eventParticipantHeartbeatMigration, /SET queue_status/);
  assert.doesNotMatch(
    eventParticipantHeartbeatMigration,
    /mark_event_participant_heartbeat\([\s\S]*p_(?:last_active_at|timestamp|client)\b[\s\S]*\) RETURNS/,
  );
  assert.match(eventParticipantHeartbeatMigration, /REVOKE ALL ON FUNCTION public\.mark_event_participant_heartbeat\(uuid\)[\s\S]*FROM PUBLIC, anon/s);
  assert.match(eventParticipantHeartbeatMigration, /GRANT EXECUTE ON FUNCTION public\.mark_event_participant_heartbeat\(uuid\)[\s\S]*TO authenticated/s);
});

test("old-client direct heartbeat timestamps are accepted but server-overwritten", () => {
  assert.match(eventParticipantHeartbeatMigration, /Compatibility bridge for older deployed web\/native clients/);
  assert.match(eventParticipantHeartbeatMigration, /CREATE OR REPLACE FUNCTION public\.server_stamp_client_last_active_at/);
  assert.match(eventParticipantHeartbeatMigration, /current_user IN \('anon', 'authenticated'\)/);
  assert.match(eventParticipantHeartbeatMigration, /NEW\.last_active_at := now\(\)/);
  assert.match(eventParticipantHeartbeatMigration, /CREATE TRIGGER event_registrations_server_stamp_client_last_active_at/);
  assert.match(eventParticipantHeartbeatMigration, /BEFORE UPDATE OF last_active_at ON public\.event_registrations/);
  assert.doesNotMatch(eventParticipantHeartbeatMigration, /RAISE EXCEPTION 'event_registrations\.last_active_at is server-owned'/);
  assert.doesNotMatch(eventParticipantHeartbeatMigration, /prevent_client_last_active_at_override/);
  assert.doesNotMatch(eventParticipantHeartbeatMigration, /NEW\.queue_status|SET queue_status/);
});

test("web and native event heartbeats use server-stamped RPC", () => {
  assert.match(webEventStatusHook, /rpc\("mark_event_participant_heartbeat"/);
  assert.doesNotMatch(webEventStatusHook, /last_active_at\s*:/);
  assert.doesNotMatch(webEventStatusHook, /\.from\("event_registrations"\)[\s\S]{0,240}\.update\(/);
  assert.match(nativeVideoDateApi, /export async function markEventParticipantHeartbeat\(eventId: string\): Promise<boolean>/);
  assert.match(nativeVideoDateApi, /rpc\('mark_event_participant_heartbeat'/);
  assert.match(nativeEventStatusHook, /markEventParticipantHeartbeat\(eventId\)/);
  assert.doesNotMatch(nativeEventStatusHook, /last_active_at\s*:/);
  assert.doesNotMatch(nativeEventStatusHook, /\.from\('event_registrations'\)[\s\S]{0,240}\.update\(/);
});

test("backend integrity migration reasserts video_sessions client write lockdown", () => {
  assert.match(backendIntegrityMigration, /ALTER TABLE public\.video_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(backendIntegrityMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.video_sessions\s+FROM anon/s);
  assert.match(backendIntegrityMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.video_sessions\s+FROM authenticated/s);
  assert.match(backendIntegrityMigration, /DROP POLICY IF EXISTS "Participants can create video sessions"/);
  assert.match(backendIntegrityMigration, /DROP POLICY IF EXISTS "Participants can update own feedback"/);
  assert.doesNotMatch(backendIntegrityMigration, /DROP POLICY IF EXISTS "Participants can view own sessions"/);
  assert.doesNotMatch(backendIntegrityMigration, /CREATE POLICY[\s\S]*ON public\.video_sessions[\s\S]*FOR (INSERT|UPDATE|DELETE|ALL)/);
});

test("no later migrations re-grant client writes or write policies on video_sessions", () => {
  const postLockdownMigrations = readMigrationRange("20260501103000");
  assert.doesNotMatch(
    postLockdownMigrations,
    /GRANT\s+(?:INSERT|UPDATE|DELETE)(?:[\s\S]{0,120})ON TABLE public\.video_sessions(?:[\s\S]{0,120})TO\s+(?:anon|authenticated)/i,
  );
  assert.doesNotMatch(
    postLockdownMigrations,
    /CREATE POLICY\s+"[^"]+"\s+ON public\.video_sessions\s+FOR\s+(?:INSERT|UPDATE|DELETE|ALL)/i,
  );
});

test("production clients do not directly mutate video_sessions", () => {
  const directVideoSessionMutation = /\.from\(['"]video_sessions['"]\)[\s\S]{0,260}\.(?:insert|update|delete)\s*\(/;
  const offenders = ["src", "apps/mobile", "shared"]
    .flatMap(listFiles)
    .filter((path) => directVideoSessionMutation.test(readFileSync(path, "utf8")))
    .map((path) => path.replace(`${process.cwd()}/`, ""));

  assert.deepEqual(offenders, []);
});

test("provider-atomic entry keeps prepare_entry non-routeable until Daily proof is confirmed", () => {
  assert.match(providerAtomicEntryMigration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260501110000_provider_atomic_base/s);
  assert.match(providerAtomicEntryMigration, /IF p_action IS DISTINCT FROM 'prepare_entry' THEN[\s\S]*video_date_transition_20260501110000_provider_atomic_base/s);
  assert.match(providerAtomicEntryMigration, /'preflight_only', true/);
  assert.match(providerAtomicEntryMigration, /'registration_status', 'deferred_until_confirm_prepare_entry'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /queue_status = v_registration_status/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_entered/);
  assert.doesNotMatch(providerAtomicEntryMigration, /state = CASE[\s\S]*'handshake'::public\.video_date_state[\s\S]*WHERE id = p_session_id[\s\S]*p_action/s);
});

test("client presence RPC cannot create server-owned ready gate or video date route statuses", () => {
  const finalStatusAllowlist = readyGateClientLifecycleOverwriteGuardMigration.match(
    /IF v_status NOT IN \([\s\S]*?\) THEN/,
  )?.[0] ?? "";

  assert.match(readyGateServerOwnedRegistrationMigration, /CREATE OR REPLACE FUNCTION public\.update_participant_status/);
  assert.match(readyGateClientLifecycleOverwriteGuardMigration, /CREATE OR REPLACE FUNCTION public\.update_participant_status/);
  assert.ok(finalStatusAllowlist.length > 0);
  assert.match(
    finalStatusAllowlist,
    /v_status NOT IN \(\s+'browsing',\s+'idle',\s+'in_survey',\s+'offline'\s+\) THEN/s,
  );
  assert.match(
    readyGateClientLifecycleOverwriteGuardMigration,
    /v_current_room_id IS NOT NULL\s+AND v_current_status IN \('in_ready_gate', 'in_handshake', 'in_date'\)\s+AND v_status IN \('browsing', 'idle', 'in_survey', 'offline'\) THEN\s+RETURN;/s,
  );
  assert.doesNotMatch(finalStatusAllowlist, /in_ready_gate/);
  assert.doesNotMatch(finalStatusAllowlist, /in_handshake/);
  assert.doesNotMatch(finalStatusAllowlist, /in_date/);
  assert.match(readyGateClientLifecycleOverwriteGuardMigration, /REVOKE ALL ON FUNCTION public\.update_participant_status\(uuid, text\)\s+FROM PUBLIC, anon/s);
  assert.match(readyGateClientLifecycleOverwriteGuardMigration, /GRANT EXECUTE ON FUNCTION public\.update_participant_status\(uuid, text\)\s+TO authenticated/s);
});

test("ready gate registration ownership is not resurrected by clients", () => {
  assert.match(
    readyGateServerOwnedRegistrationMigration,
    /UPDATE public\.event_registrations[\s\S]*SET queue_status = 'idle'[\s\S]*WHERE queue_status = 'in_ready_gate'[\s\S]*AND current_room_id IS NULL/s,
  );
  assert.doesNotMatch(readyGateOverlay, /setStatus\(["']in_ready_gate["']\)/);
  assert.doesNotMatch(nativeReadyGateOverlay, /updateParticipantStatus\(eventId,\s*['"]in_ready_gate['"]\)/);
  assert.ok(webClientWritableStatusType.length > 0);
  assert.ok(nativeClientWritableStatusType.length > 0);
  assert.ok(nativeVideoDateApiClientWritableStatusType.length > 0);
  assert.doesNotMatch(webClientWritableStatusType, /in_ready_gate/);
  assert.doesNotMatch(webClientWritableStatusType, /in_handshake/);
  assert.doesNotMatch(webClientWritableStatusType, /in_date/);
  assert.doesNotMatch(nativeClientWritableStatusType, /in_ready_gate/);
  assert.doesNotMatch(nativeClientWritableStatusType, /in_handshake/);
  assert.doesNotMatch(nativeClientWritableStatusType, /in_date/);
  assert.doesNotMatch(nativeVideoDateApiClientWritableStatusType, /in_ready_gate/);
  assert.doesNotMatch(nativeVideoDateApiClientWritableStatusType, /in_handshake/);
  assert.doesNotMatch(nativeVideoDateApiClientWritableStatusType, /in_date/);
  assert.doesNotMatch(readyGateOverlay, /setStatus\(["']browsing["']\)/);
  assert.doesNotMatch(nativeReadyGateOverlay, /updateParticipantStatus\(eventId,\s*['"]browsing['"]\)/);
  assert.doesNotMatch(eventLobby, /clearReadyGateSession\("ready_gate_overlay_close"\);\s*setStatus\(["']browsing["']\)/);
  assert.doesNotMatch(
    nativeHomeRoute,
    /ready_gate[\s\S]{0,500}ready_gate_transition[\s\S]{0,500}updateParticipantStatus\(activeSession\.eventId,\s*['"]browsing['"]\)/,
  );
});

test("direct client updates cannot overwrite server-owned registration lifecycle columns", () => {
  assert.match(
    readyGateClientLifecycleOverwriteGuardMigration,
    /CREATE OR REPLACE FUNCTION public\.prevent_client_session_registration_state_overwrite\(\)/,
  );
  assert.match(
    readyGateClientLifecycleOverwriteGuardMigration,
    /current_user IN \('anon', 'authenticated'\)[\s\S]*NEW\.current_room_id IS DISTINCT FROM OLD\.current_room_id[\s\S]*RETURN NULL/s,
  );
  assert.match(
    readyGateClientLifecycleOverwriteGuardMigration,
    /NEW\.queue_status IS DISTINCT FROM OLD\.queue_status[\s\S]*OLD\.queue_status IN \('in_ready_gate', 'in_handshake', 'in_date'\)[\s\S]*NEW\.queue_status IN \('in_ready_gate', 'in_handshake', 'in_date'\)[\s\S]*RETURN NULL/s,
  );
  assert.match(
    readyGateClientLifecycleOverwriteGuardMigration,
    /CREATE TRIGGER event_registrations_prevent_client_session_state_overwrite\s+BEFORE UPDATE OF queue_status, current_room_id, current_partner_id\s+ON public\.event_registrations/s,
  );
});

test("web lobby dedupes same-runtime prepare handoffs before date navigation", () => {
  assert.match(eventLobby, /const prepareNavigationInFlightRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(eventLobby, /prepareNavigationInFlightRef\.current\.has\(sessionId\)/);
  assert.match(eventLobby, /prepare_entry_already_in_flight/);
  assert.match(eventLobby, /prepareNavigationInFlightRef\.current\.add\(sessionId\)/);
  assert.match(eventLobby, /\.catch\(\(error\) => \{[\s\S]*PREPARE_ENTRY_EXCEPTION[\s\S]*openReadyGateSession/s);
  assert.match(
    eventLobby,
    /\.finally\(\(\) => \{\s*prepareNavigationInFlightRef\.current\.delete\(sessionId\);\s*\}\)/s,
  );
});

test("native date entry reuses same-session Daily joins across remounts and rescue timers", () => {
  assert.match(
    nativeVideoDateRoute,
    /type SharedDailyCallEntryState = 'creating' \| 'joining' \| 'joined' \| 'failed' \| 'leaving'/,
  );
  assert.match(nativeVideoDateRoute, /type NativePrejoinPipelineEntry = \{/);
  assert.match(nativeVideoDateRoute, /sharedNativePrejoinPipelineEntry/);
  assert.match(nativeVideoDateRoute, /nativePrejoinPipelineKey\(sessionId, user\.id\)/);
  assert.match(nativeVideoDateRoute, /native_prejoin_pipeline_reuse_in_flight/);
  assert.match(nativeVideoDateRoute, /native_prejoin_pipeline_release/);
  assert.match(nativeVideoDateRoute, /joinPromise: Promise<void> \| null/);
  assert.match(nativeVideoDateRoute, /daily_call_singleton_reuse_join_in_flight/);
  assert.match(nativeVideoDateRoute, /await sharedCall\.joinPromise/);
  assert.match(nativeVideoDateRoute, /hydrateJoinedSharedCall/);
  assert.match(nativeVideoDateRoute, /showJoiningOverlay =[\s\S]*\(joining \|\| isConnecting\) && !localInDailyRoom[\s\S]*!showFeedback/);
  assert.match(nativeVideoDateRoute, /showPeerWaitOverlay =\s*!showFeedback &&\s*localInDailyRoom/s);
  assert.doesNotMatch(nativeVideoDateRoute, /reuse_probe_not_joined/);
  assert.doesNotMatch(nativeVideoDateRoute, /allowMultipleCallInstances/);
  assert.match(nativeEventLobby, /dateLaunchIntentSessionRef/);
  assert.match(nativeEventLobby, /isDateEntryTransitionActive\(rescueSid\)/);
  assert.match(nativeEventLobby, /launch_already_in_progress/);
  assert.doesNotMatch(nativeEventLobby, /bypassDuplicateBurstForRescue/);
  assert.doesNotMatch(nativeDateNavigationGuard, /bypassDuplicateBurstForRescue/);
});

test("native provider wrappers coalesce duplicate foreground/user sync noise", () => {
  assert.match(nativeOneSignal, /permissionGrantedSyncInFlightByUser = new Map<string, Promise<PushSyncResult>>/);
  assert.match(nativeOneSignal, /syncPushWithBackendIfPermissionGranted:coalesced/);
  assert.match(nativeOneSignal, /permissionGrantedSyncInFlightByUser\.set\(userId, run\)/);
  assert.match(nativeOneSignal, /permissionGrantedSyncInFlightByUser\.delete\(userId\)/);
  assert.match(nativeRevenueCat, /currentRevenueCatUserId === nextUserId/);
  assert.match(nativeRevenueCat, /revenueCatLoginInFlightUserId === nextUserId/);
});

test("native video date capture uses supported Daily defaults while web keeps explicit portrait constraints", () => {
  assert.match(
    videoDateMediaContract,
    /VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS[\s\S]*width:[\s\S]*height:[\s\S]*aspectRatio/s,
  );
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_PORTRAIT_MEDIUM_VIDEO_CONSTRAINTS[\s\S]*aspectRatio/s);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_PORTRAIT_COMPATIBLE_VIDEO_CONSTRAINTS[\s\S]*aspectRatio/s);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER[\s\S]*portrait_medium[\s\S]*portrait_compatible[\s\S]*fallback/s);
  const nativeIdealConstraints =
    videoDateMediaContract.match(/VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS[\s\S]*?\};/)?.[0] ?? "";
  const nativeFallbackConstraints =
    videoDateMediaContract.match(/VIDEO_DATE_NATIVE_FALLBACK_VIDEO_CONSTRAINTS[\s\S]*?\};/)?.[0] ?? "";
  assert.doesNotMatch(nativeIdealConstraints, /\bwidth\s*:/);
  assert.doesNotMatch(nativeIdealConstraints, /\bheight\s*:/);
  assert.doesNotMatch(nativeFallbackConstraints, /\bwidth\s*:/);
  assert.doesNotMatch(nativeFallbackConstraints, /\bheight\s*:/);
  assert.match(nativeVideoDateDailyMediaConfig, /audioSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /videoSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /sendSettings:[\s\S]*video:\s*'quality-optimized'/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /userMediaVideoConstraints/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /dailyConfig/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /experimentalChromeVideoMuteLightOff/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /videoDateNativeVideoConstraintsForProfile/);
  assert.match(webDailyCallObjectConfig, /type DailyAdvancedConfigWithVideoDateKnobs/);
  assert.match(webDailyCallObjectConfig, /experimentalChromeVideoMuteLightOff\?: boolean/);
  assert.match(webDailyCallObjectConfig, /experimentalChromeVideoMuteLightOff:\s*true/);
  assert.match(webDailyCallObjectConfig, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webDailyCallObjectConfig, /appAcquiredMedia\?\.videoTrack/);
  assert.match(webDailyCallObjectConfig, /useDevicePreferenceCookies/);
  assert.match(webDailyCallObjectConfig, /avoidEval:\s*true/);
  assert.match(webVideoCallHook, /for \(const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER\)/);
  assert.match(webVideoCallHook, /getUserMedia\(videoDateWebMediaStreamConstraints\(profile\)\)/);
  assert.match(webVideoCallHook, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webVideoCallHook, /permission_handoff_media_acquired/);
  assert.match(webVideoCallHook, /daily_media_permission_handoff_fallback_to_preflight/);
  assert.match(webVideoCallHook, /prewarmAppAcquiredMedia/);
  assert.match(webVideoCallHook, /releaseAppAcquiredMedia\("daily_room_failed_after_media_preflight"\)/);
  assert.match(webVideoCallHook, /VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC/);
  assert.match(webDailyPrewarm, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webDailyPrewarm, /appAcquiredMedia: WebDailyPrewarmAppAcquiredMedia \| null/);
  assert.match(readyGateOverlay, /permissionPrewarmMediaRef/);
  assert.match(readyGateOverlay, /getReadyGatePermissionPrewarmReleaseDelayMs/);
  assert.match(readyGateOverlay, /settings_deep_link/);
  assert.match(readyGateOverlay, /permission_prewarm_media_ttl_expired/);
  assert.match(readyGateOverlay, /ready_gate_session_changed/);
  assert.match(readyGateOverlay, /appAcquiredMedia: prewarmMedia/);
  assert.match(readyGateOverlay, /captureProfile: prewarmMedia\?\.captureProfile/);
  assert.match(webVideoCallHook, /permissionHandoff\.captureProfile \?\? "ideal"/);
  assert.match(nativeVideoDateRoute, /diagnostic_scope: 'sender_capture'/);
  assert.match(nativeVideoDateRoute, /diagnostic_scope: 'receiver_layout'/);
  assert.match(nativeVideoDateRoute, /receiver_object_fit: VIDEO_DATE_REMOTE_OBJECT_FIT/);
  assert.match(nativeVideoDateRoute, /frame_issue_hint: 'remote_layout_contains_sender_frame_without_receiver_crop'/);
  assert.match(nativeVideoDateRoute, /ensureNativeFrontCameraIntent/);
  assert.match(nativeVideoDateRoute, /getCameraFacingMode/);
  assert.match(nativeVideoDateRoute, /cycleCamera/);
});

test("video date camera switch hints are sent only after committed live capture", () => {
  assert.match(cameraSwitchRenderHintContract, /commitConfirmed\?: boolean/);
  assert.match(cameraSwitchRenderHintContract, /commitMethod\?: string \| null/);
  assert.match(cameraSwitchRenderHintContract, /localVideoTrackId\?: string \| null/);
  assert.match(cameraSwitchRenderHintContract, /commitLatencyMs\?: number \| null/);
  assert.doesNotMatch(cameraSwitchRenderHintContract, /publishSequence\?: number \| null/);
  assert.doesNotMatch(cameraSwitchRenderHintContract, /publishRefreshApplied\?: boolean/);
  assert.doesNotMatch(cameraSwitchRenderHintContract, /hintSequence\?: number \| null/);
  assert.match(webVideoCallHook, /waitForLocalCameraSwitchCommit/);
  assert.match(webVideoCallHook, /setInputDevicesAsync/);
  assert.match(webVideoCallHook, /videoSource: false/);
  assert.match(webVideoCallHook, /function videoOnlyCameraSwitchConstraints\(\s*captureProfile: VideoDateWebMediaCaptureProfile/);
  assert.match(webVideoCallHook, /videoDateWebMediaStreamConstraints\(captureProfile\)/);
  assert.match(webVideoCallHook, /videoOnlyCameraSwitchConstraints\(captureProfileRef\.current, desiredFacing, expectedDeviceId\)/);
  assert.doesNotMatch(webVideoCallHook, /CAMERA_SWITCH_HINT_RESEND_DELAY_MS/);
  assert.doesNotMatch(webVideoCallHook, /cameraSwitchPublishSequenceRef/);
  assert.doesNotMatch(webVideoCallHook, /cameraSwitchHintResendTimeoutRef/);
  assert.match(webVideoCallHook, /requireFreshFrame/);
  assert.match(webVideoCallHook, /freshFrameBaseline/);
  assert.match(webVideoCallHook, /freshFrameTimeoutMs/);
  assert.match(webVideoCallHook, /REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS/);
  assert.match(webVideoCallHook, /daily_camera_switch_no_reattach_needed/);
  assert.match(webVideoCallHook, /sameTrackCameraSwitchCandidate/);
  assert.match(webVideoCallHook, /useFreshFrameGuard/);
  assert.match(webVideoCallHook, /daily_camera_switch_video_source_restore_failed/);
  assert.match(webVideoCallHook, /dailyVideoTrackAdopted/);
  assert.match(webVideoCallHook, /recovery_already_in_flight/);
  assert.match(webVideoCallHook, /video_date_camera_switch_committed/);
  assert.match(webVideoCallHook, /opts\.expectedFacing !== before\.facingMode/);
  assert.match(webVideoCallHook, /inferCameraFacingModeFromLabel/);
  assert.match(webVideoCallHook, /return currentDeviceId \? candidates\[0\] \?\? null : null/);
  assert.match(webVideoCallHook, /lastRemoteCameraSwitchHintIdRef/);
  assert.match(webVideoCallHook, /daily_camera_switch_render_watch_started/);
  assert.match(webVideoCallHook, /fresh_frame_not_observed/);
  const deterministicCameraSwitchIndex = webVideoCallHook.indexOf(
    "switchToDeterministicWebCamera(co, before, desiredFacing",
  );
  const cycleCameraFallbackIndex = webVideoCallHook.indexOf("co.cycleCamera", deterministicCameraSwitchIndex);
  assert.ok(deterministicCameraSwitchIndex > 0);
  assert.ok(cycleCameraFallbackIndex > deterministicCameraSwitchIndex);
  assert.match(nativeVideoDateRoute, /waitForNativeCameraSwitchCommit/);
  assert.match(nativeVideoDateRoute, /setCamera/);
  assert.match(nativeVideoDateRoute, /enumerateDevices/);
  assert.match(nativeVideoDateRoute, /video_date_camera_switch_committed/);
  assert.match(nativeVideoDateRoute, /resolveNativeCameraSwitchCommit/);
  assert.match(nativeVideoDateRoute, /baselineFacing: currentFacing/);
  assert.match(nativeVideoDateRoute, /previousControlsFacing: beforeControlsFacing/);
  assert.match(nativeVideoDateRoute, /expectedDeviceKey/);
  assert.match(nativeVideoDateRoute, /before_controls_facing_mode/);
  assert.match(nativeVideoDateRoute, /const facingMatches = usable\.filter/);
  assert.match(nativeVideoDateRoute, /facingMatches\[0\] \?\?/);
  assert.match(nativeVideoDateRoute, /nativeCameraDeviceFacingMode\(targetDevice\)/);
  assert.match(nativeVideoDateRoute, /nativeCameraDeviceKey/);
  assert.match(nativeVideoDateRoute, /nativeCameraFacingModeFromLabel\(videoTrack\?\.label\)/);
  const nativeChooseCameraStart = nativeVideoDateRoute.indexOf("function chooseNativeCameraDevice");
  const nativeChooseCameraEnd = nativeVideoDateRoute.indexOf("function describeNativeCameraSwitchError", nativeChooseCameraStart);
  const nativeChooseCameraBlock = nativeVideoDateRoute.slice(nativeChooseCameraStart, nativeChooseCameraEnd);
  const nativeDesiredFacingSelectionIndex = nativeChooseCameraBlock.indexOf("if (desiredFacing)");
  const nativeNoCandidateReturnIndex = nativeChooseCameraBlock.indexOf(
    "if (currentDeviceKey != null && candidates.length === 0) return null;",
  );
  assert.ok(nativeChooseCameraStart > 0 && nativeChooseCameraEnd > nativeChooseCameraStart);
  assert.ok(
    nativeDesiredFacingSelectionIndex >= 0 &&
      nativeNoCandidateReturnIndex > nativeDesiredFacingSelectionIndex,
  );
  assert.match(nativeVideoDateRoute, /lastNativeRemoteCameraSwitchHintIdRef/);
  assert.match(nativeVideoDateRoute, /NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS/);
  assert.match(nativeVideoDateRoute, /NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS/);
  assert.match(nativeVideoDateRoute, /NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS/);
  assert.match(nativeVideoDateRoute, /NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS/);
  assert.match(nativeVideoDateRoute, /activeNativeRemoteCameraSwitchRenderWatchRef/);
  assert.match(nativeVideoDateRoute, /scheduleNativeCameraSwitchFreshnessWatch/);
  assert.match(nativeVideoDateRoute, /readNativeCameraSwitchFreshness/);
  assert.match(nativeVideoDateRoute, /native_camera_switch_no_remount_needed/);
  assert.match(nativeVideoDateRoute, /native_camera_switch_render_watch_timed_out/);
  assert.match(nativeVideoDateRoute, /camera_switch_hint_received/);
  assert.match(nativeVideoDateRoute, /camera_switch_watch_active/);

  const nativeFreshnessWatchStart = nativeVideoDateRoute.indexOf("const scheduleNativeCameraSwitchFreshnessWatch");
  const nativeFreshnessWatchEnd = nativeVideoDateRoute.indexOf("useEffect(() => {", nativeFreshnessWatchStart);
  assert.ok(nativeFreshnessWatchStart > 0);
  assert.ok(nativeFreshnessWatchEnd > nativeFreshnessWatchStart);
  const nativeFreshnessWatch = nativeVideoDateRoute.slice(nativeFreshnessWatchStart, nativeFreshnessWatchEnd);
  const unsupportedFreshnessBlock =
    nativeFreshnessWatch.match(/if \(!freshness\.supported\) \{[\s\S]*?\n[^\S\r\n]{8}\}/)?.[0] ??
    "";
  assert.match(unsupportedFreshnessBlock, /native_camera_switch_render_watch_unverified/);
  assert.doesNotMatch(unsupportedFreshnessBlock, /\breturn;/);
  assert.match(
    nativeFreshnessWatch,
    /if \(elapsedMs >= NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS\)[\s\S]*scheduleNativeRemoteRenderRemount/,
  );
  assert.ok(
    nativeFreshnessWatch.indexOf("nativeCameraSwitchFreshnessTimerRef.current = setTimeout") >
      nativeFreshnessWatch.indexOf("native_camera_switch_render_watch_unverified"),
  );
});

test("camera switch render hints round-trip core commit metadata and tolerate legacy fields", () => {
  const hint = createVideoDateCameraSwitchRenderHint({
    sourcePlatform: "web",
    facingMode: "environment",
    commitMethod: "video_source",
    localVideoTrackId: "track-2",
    commitLatencyMs: 32.7,
    sentAtMs: 1_777,
    random: () => 0.42,
  });

  assert.equal(hint.facingMode, "environment");
  assert.equal(hint.commitMethod, "video_source");
  assert.equal(hint.localVideoTrackId, "track-2");
  assert.equal(hint.commitLatencyMs, 33);
  const parsedHint = parseVideoDateCameraSwitchRenderHint(hint);
  assert.equal(parsedHint?.facingMode, "environment");
  assert.equal(parsedHint?.commitMethod, "video_source");
  assert.equal(parsedHint?.localVideoTrackId, "track-2");
  assert.equal(parsedHint?.commitLatencyMs, 33);

  // Legacy in-flight clients may still send the deprecated retry-protocol
  // fields (publishSequence / publishRefreshApplied / hintSequence). The
  // parser must silently drop them without rejecting the hint.
  const legacyParsedHint = parseVideoDateCameraSwitchRenderHint({
    type: "video_date_camera_switch_render_hint",
    version: 1,
    switchId: "legacy-switch",
    sourcePlatform: "native",
    facingMode: "user",
    publishSequence: 7,
    publishRefreshApplied: true,
    hintSequence: 2,
    sentAtMs: 1_778,
  });
  assert.equal(legacyParsedHint?.facingMode, "user");
  assert.equal(legacyParsedHint?.sourcePlatform, "native");
  assert.equal((legacyParsedHint as Record<string, unknown> | null)?.publishSequence, undefined);
  assert.equal((legacyParsedHint as Record<string, unknown> | null)?.publishRefreshApplied, undefined);
  assert.equal((legacyParsedHint as Record<string, unknown> | null)?.hintSequence, undefined);

  // Hard rejections still apply to actual contract fields.
  assert.equal(parseVideoDateCameraSwitchRenderHint({ ...hint, commitLatencyMs: -1 }), null);
  assert.equal(parseVideoDateCameraSwitchRenderHint({ ...hint, sentAtMs: 0 }), null);
});

test("queue_status reaches in_handshake only after provider confirm succeeds", () => {
  assert.match(providerAtomicEntryMigration, /'registration_status', 'deferred_until_confirm_prepare_entry'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_preflight_ok[\s\S]{0,1200}queue_status = 'in_handshake'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_preflight_ok[\s\S]{0,1200}queue_status = v_queue_status/);
  assert.match(
    providerAtomicEntryMigration,
    /v_queue_status := CASE[\s\S]*ELSE 'in_handshake'[\s\S]*UPDATE public\.event_registrations[\s\S]*queue_status = v_queue_status/s,
  );
  assert.match(dailyRoomFunction, /const tokenWindow = resolveVideoDateMeetingTokenWindow\(\{[\s\S]*?const token = await createMeetingToken\(\s*roomName,\s*user\.id,\s*tokenWindow\.ttlSeconds,\s*undefined,\s*\{\s*ejectAtTokenExp:\s*true\s*\},?\s*\);[\s\S]*confirmVideoDateEntryPrepared\(serviceClient/s);
  assert.match(dailyRoomFunction, /confirmPayload\?\.code \?\? \(confirmError \? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN"\)/);
  const tokenCreate = indexOfMatch(dailyRoomFunction, videoDateRoomNameTokenWithExpiryEject);
  const confirmCall = dailyRoomFunction.indexOf("confirmVideoDateEntryPrepared(serviceClient", tokenCreate);
  const confirmFailure = dailyRoomFunction.indexOf("if (confirmError || confirmPayload?.success !== true)", confirmCall);
  const successResponse = dailyRoomFunction.indexOf("token,", confirmFailure);
  assert.ok(tokenCreate > 0);
  assert.ok(confirmCall > tokenCreate);
  assert.ok(confirmFailure > confirmCall);
  assert.ok(successResponse > confirmFailure);
});

test("confirm_video_date_entry_prepared is service-role-only and atomically persists route truth", () => {
  assert.match(providerAtomicEntryMigration, /CREATE OR REPLACE FUNCTION public\.confirm_video_date_entry_prepared\(/);
  assert.match(providerAtomicEntryMigration, /SECURITY DEFINER/);
  assert.match(providerAtomicEntryMigration, /SET search_path TO 'public'/);
  assert.match(providerAtomicEntryMigration, /REVOKE ALL ON FUNCTION public\.confirm_video_date_entry_prepared\(uuid, text, text, text\)\s+FROM PUBLIC, anon, authenticated/s);
  assert.match(providerAtomicEntryMigration, /GRANT EXECUTE ON FUNCTION public\.confirm_video_date_entry_prepared\(uuid, text, text, text\)\s+TO service_role/s);
  assert.match(providerAtomicEntryMigration, /FROM public\.event_registrations[\s\S]*FOR UPDATE[\s\S]*v_registration_count IS DISTINCT FROM 2/s);
  assert.match(providerAtomicEntryMigration, /'code', 'REGISTRATION_PERSIST_FAILED'/);
  assert.match(providerAtomicEntryMigration, /UPDATE public\.event_registrations[\s\S]*GET DIAGNOSTICS v_update_count = ROW_COUNT[\s\S]*v_update_count IS DISTINCT FROM 2/s);
  assert.match(providerAtomicEntryMigration, /UPDATE public\.video_sessions[\s\S]*daily_room_name = p_room_name[\s\S]*state = CASE[\s\S]*'handshake'::public\.video_date_state/s);
  assert.match(providerAtomicEntryMigration, /'entry_attempt_id', p_entry_attempt_id/);
});

test("latest handshake migration starts the visible timer only after both Daily joins", () => {
  assert.match(handshakeJoinStartMigration, /CREATE OR REPLACE FUNCTION public\.confirm_video_date_entry_prepared\(/);
  assert.match(handshakeJoinStartMigration, /'handshake_timer', 'deferred_until_both_daily_joined'/);

  const confirmStart = handshakeJoinStartMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared",
  );
  const markJoinedStart = handshakeJoinStartMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined",
  );
  const confirmBody = handshakeJoinStartMigration.slice(confirmStart, markJoinedStart);
  assert.ok(confirmStart >= 0);
  assert.ok(markJoinedStart > confirmStart);
  assert.doesNotMatch(confirmBody, /handshake_started_at\s*=\s*COALESCE\(handshake_started_at,\s*v_now\)/);
  assert.doesNotMatch(confirmBody, /handshake_started_at\s*=\s*v_now/);

  const markJoinedBody = handshakeJoinStartMigration.slice(markJoinedStart);
  assert.match(
    markJoinedBody,
    /participant_1_joined_at IS NOT NULL[\s\S]*participant_2_joined_at IS NOT NULL[\s\S]*handshake_started_at = v_now/s,
  );
  assert.match(markJoinedBody, /'handshake_started_after_both_daily_joined'/);
  assert.match(markJoinedBody, /'handshake_started', v_started_handshake/);
  assert.match(markJoinedBody, /'handshake_started_at', v_row\.handshake_started_at/);
});

test("Daily join stamping is routeable-only so solo prejoin cannot start handshake", () => {
  assert.match(soloPrejoinJoinGuardMigration, /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_joined/);
  assert.match(soloPrejoinJoinGuardMigration, /v_routeable :=/);
  assert.match(soloPrejoinJoinGuardMigration, /v_row\.ready_gate_status = 'both_ready'/);
  assert.match(soloPrejoinJoinGuardMigration, /'error', 'not_routeable'/);
  assert.match(soloPrejoinJoinGuardMigration, /IF NOT v_routeable THEN[\s\S]*RETURN jsonb_build_object/s);
  assert.match(soloPrejoinJoinGuardMigration, /REVOKE ALL ON FUNCTION public\.mark_video_date_daily_joined\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/s);
  assert.match(soloPrejoinJoinGuardMigration, /GRANT EXECUTE ON FUNCTION public\.mark_video_date_daily_joined\(uuid\)[\s\S]*TO authenticated/s);
  assert.match(soloPrejoinJoinGuardMigration, /participant_1_joined_at = COALESCE/);
  assert.match(soloPrejoinJoinGuardMigration, /UPDATE public\.event_registrations/);
});

test("prepared-but-never-joined video dates are repaired without starting the handshake timer", () => {
  assert.match(
    handshakeJoinStartMigration,
    /state = 'handshake'::public\.video_date_state[\s\S]*handshake_started_at IS NULL[\s\S]*daily_room_name IS NOT NULL[\s\S]*daily_room_url IS NOT NULL[\s\S]*participant_1_joined_at IS NULL[\s\S]*participant_2_joined_at IS NULL/s,
  );
  assert.match(handshakeJoinStartMigration, /ended_reason = 'prepare_entry_daily_join_missing'/);
  assert.match(handshakeJoinStartMigration, /'handshake_timer', 'never_started'/);
});

test("daily-room hard-fails room and registration persistence before returning tokens", () => {
  assert.match(dailyRoomFunction, /persistVideoDateRoomMetadata\(params\.serviceClient/);
  assert.match(dailyRoomFunction, /code: "DB_ROOM_PERSIST_FAILED"/);
  assert.match(dailyRoomFunction, /video_date_room_metadata_persist_failed/);
  assert.match(
    dailyRoomFunction,
    /ensureVideoDateProviderRoomForToken[\s\S]*const tokenWindow = resolveVideoDateMeetingTokenWindow\(\{[\s\S]*?const token = await createMeetingToken\(\s*roomName,\s*user\.id,\s*tokenWindow\.ttlSeconds,\s*undefined,\s*\{\s*ejectAtTokenExp:\s*true\s*\},?\s*\);[\s\S]*confirmVideoDateEntryPrepared\(serviceClient/s,
  );
  assert.match(dailyRoomFunction, /confirmPayload\?\.code \?\? \(confirmError \? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN"\)/);
  assert.doesNotMatch(dailyRoomFunction, /markVideoDateEntryPrepared\(serviceClient/);
  assert.doesNotMatch(dailyRoomFunction, /Registration status update after token success failed/);
});

test("entry_attempt_id is generated client-side and carried through Edge logs and responses", () => {
  assert.match(webPrepareEntry, /createVideoDateEntryAttemptId\(startedAt\)/);
  assert.match(nativePrepareEntry, /createVideoDateEntryAttemptId\(startedAt\)/);
  assert.match(webPrepareEntry, /body: \{[\s\S]*action: PREPARE_VIDEO_DATE_ENTRY_ACTION[\s\S]*entry_attempt_id: attemptId[\s\S]*video_date_trace_id: attemptId[\s\S]*\}/);
  assert.match(nativePrepareEntry, /body: \{[\s\S]*action: PREPARE_VIDEO_DATE_ENTRY_ACTION[\s\S]*entry_attempt_id: attemptId[\s\S]*video_date_trace_id: attemptId[\s\S]*\}/);
  assert.match(dailyRoomFunction, /readVideoDateTraceContext\(body, action\)/);
  assert.match(dailyRoomFunction, /entry_attempt_id: entryAttemptId/);
  assert.match(dailyRoomFunction, /video_date_trace_id: videoDateTraceId/);
  assert.match(dailyRoomFunction, /p_entry_attempt_id: params\.entryAttemptId \?\? null/);
});

test("date route truth requires provider metadata before navigating to video", () => {
  assert.match(sharedActiveSession, /function videoSessionHasProviderRoom/);
  assert.match(sharedActiveSession, /if \(!videoSessionHasProviderRoom\(row\)\) return false/);
  assert.match(sharedActiveSession, /videoSessionHasProviderRoom\(row\) &&/);
  assert.match(sharedActiveSession, /canPrepareDailyRoomFromReadyGateTruth/);
  assert.match(webVideoDatePage, /in_ready_gate_without_provider_prepared_truth/);
  assert.match(nativeVideoDateRoute, /in_ready_gate_without_provider_prepared_truth/);
  assert.doesNotMatch(nativeEventLobby, /phase === 'handshake' \|\| phase === 'date'/);
  assert.match(dailyRoomFunction, /allow Daily token only after provider-prepared handshake\/date truth is confirmed/);
});

test("web and native active-session recovery share pending survey contract", () => {
  assert.match(sharedActiveSession, /POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS/);
  assert.match(sharedActiveSession, /POST_DATE_SURVEY_RECOVERY_WINDOW_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(sharedActiveSession, /function videoSessionHasPostDateSurveyTruth/);
  assert.match(sharedActiveSession, /function videoSessionHasRecoverablePostDateSurveyTruth/);
  assert.match(sharedActiveSession, /function isActiveSessionDirectFallbackFresh/);
  assert.match(sharedActiveSession, /function activeSessionDirectFallbackStaleReason/);
  assert.match(sharedActiveSession, /function getVideoSessionPartnerIdForUser/);
  assert.match(sharedActiveSession, /function pickRecoverablePendingPostDateSurveySession/);
  assert.match(sharedActiveSession, /feedbackSessionIdsForUser\.has\(row\.id\)/);

  for (const source of [webActiveSessionHook, nativeActiveSessionHook]) {
    assert.match(source, /findPendingPostDateSurveySession/);
    assert.match(source, /\.not\(["']ended_at["'], ["']is["'], null\)/);
    assert.doesNotMatch(source, /\.not\(["']date_started_at["'], ["']is["'], null\)/);
    assert.match(source, /participant_1_joined_at, participant_2_joined_at, state, phase/);
    assert.match(source, /videoSessionHasPostDateSurveyTruth/);
    assert.match(source, /videoSessionHasRecoverablePostDateSurveyTruth/);
    assert.match(source, /pending_survey_recovery_stale/);
    assert.match(source, /direct_video_session_fallback_stale/);
    assert.match(source, /isActiveSessionDirectFallbackFresh/);
    assert.match(source, /pickRecoverablePendingPostDateSurveySession/);
    assert.match(source, /\.from\(["']date_feedback["']\)[\s\S]*\.select\(["']session_id["']\)[\s\S]*\.eq\(["']user_id["'], userId\)[\s\S]*\.in\(["']session_id["'], candidateSessionIds\)/);
    assert.match(source, /queueStatus: ["']in_survey["']/);
  }
});

test("home active-session banners distinguish pending survey from active calls", () => {
  for (const source of [webActiveCallBanner, nativeActiveCallBanner]) {
    assert.match(source, /mode\?: ['"]video['"] \| ['"]ready_gate['"] \| ['"]survey['"]/);
    assert.match(source, /Finish your date feedback/);
    assert.match(source, /Tell us how it went/);
    assert.match(source, /mode === ['"]survey['"] \? ['"]Finish['"]/);
    assert.match(source, /Open Ready Gate/);
    assert.match(source, /Finish date feedback/);
    assert.match(source, /Rejoin active date/);
  }

  assert.match(webActiveCallBanner, /\{onEnd \? \(/);
  assert.match(webActiveCallBanner, /role="button"/);
  assert.match(webActiveCallBanner, /aria-disabled=\{isDisabled\}/);
  assert.match(webActiveCallBanner, /aria-busy=\{isBusy\}/);
  assert.match(webActiveCallBanner, /if \(isDisabled\) return;[\s\S]*onRejoin\(\)/);
  assert.match(webActiveCallBanner, /event\.stopPropagation\(\)/);
  assert.match(webActiveCallBanner, /mode === "ready_gate" \? Timer : mode === "survey" \? ClipboardCheck : Video/);
  assert.doesNotMatch(webActiveCallBanner, /fixed top-0/);
  assert.match(webDashboardPage, /activeSession\.queueStatus === "in_survey"\s*\?\s*"survey"/);
  assert.match(webDashboardPage, /disabled=\{activeSessionRoutePending\}/);
  assert.match(webDashboardPage, /isBusy=\{activeSessionRoutePending\}/);
  assert.match(webDashboardPage, /partnerName=\{activeSession\.partnerName\}/);
  assert.match(webDashboardPage, /transitionFailureMessage\(data\)/);
  assert.ok(webDashboardPage.indexOf("</header>") < webDashboardPage.indexOf("<ActiveCallBanner"));

  assert.match(nativeActiveCallBanner, /\{onEnd \? \(/);
  assert.match(nativeActiveCallBanner, /onPress=\{onRejoin\}/);
  assert.match(nativeActiveCallBanner, /accessibilityRole="button"/);
  assert.match(nativeActiveCallBanner, /event\.stopPropagation\(\)/);
  assert.match(nativeActiveCallBanner, /mode === 'ready_gate'\s+\? 'timer-outline'[\s\S]*mode === 'survey'\s+\? 'clipboard-outline'[\s\S]*'videocam-outline'/);
  assert.doesNotMatch(nativeActiveCallBanner, /position:\s*'absolute'/);
  assert.match(nativeTabsHome, /activeSession\.queueStatus === 'in_survey'\s*\?\s*'survey'/);
  assert.ok(nativeTabsHome.indexOf("</GlassHeaderBar>") < nativeTabsHome.indexOf("<ActiveCallBanner"));
  assert.doesNotMatch(nativeTabsHome, /paddingTop:\s*insets\.top \+ 4/);
});

test("native date route opens recovered pending surveys after current_room_id is cleared", () => {
  assert.match(nativeVideoDateRoute, /function shouldRecoverPendingPostDateSurvey/);
  assert.match(nativeVideoDateRoute, /getVideoSessionPartnerIdForUser/);
  assert.match(nativeVideoDateRoute, /videoSessionHasPostDateSurveyTruth/);
  assert.match(nativeVideoDateRoute, /const openNativePostDateSurveyFromTerminalTruth = useCallback/);
  assert.match(nativeVideoDateRoute, /const surveyOpenedRef = useRef\(false\)/);
  assert.ok(
    nativeVideoDateRoute.indexOf("surveyOpenedRef.current = false;") <
      nativeVideoDateRoute.indexOf("}, [sessionId]);"),
  );
  const surveyOpenHelperIndex = nativeVideoDateRoute.indexOf("const openNativePostDateSurveyFromTerminalTruth = useCallback");
  const helperAuthGuardIndex = nativeVideoDateRoute.indexOf("if (!sessionId || !user?.id) return false;", surveyOpenHelperIndex);
  const helperLatchIndex = nativeVideoDateRoute.indexOf("if (surveyOpenedRef.current) {", surveyOpenHelperIndex);
  const helperLatchReturnIndex = nativeVideoDateRoute.indexOf("return true;", helperLatchIndex);
  const helperDueIndex = nativeVideoDateRoute.indexOf("if (!pendingPostDateSurveyDue) return false", surveyOpenHelperIndex);
  assert.ok(helperAuthGuardIndex > surveyOpenHelperIndex);
  assert.ok(helperLatchIndex > helperAuthGuardIndex);
  assert.ok(nativeVideoDateRoute.indexOf("post_date_survey_open_already_active", helperLatchIndex) > helperLatchIndex);
  assert.ok(helperLatchReturnIndex > helperLatchIndex);
  assert.ok(helperDueIndex > helperLatchReturnIndex);
  assert.match(nativeVideoDateRoute, /NATIVE_TERMINAL_SURVEY_SESSION_SELECT/);
  assert.match(nativeVideoDateRoute, /pendingPostDateSurveyDue/);
  assert.match(nativeVideoDateRoute, /if \(!pendingPostDateSurveyDue\) return false/);
  assert.match(nativeVideoDateRoute, /if \(recoveredPartnerId\) setPartnerId\(recoveredPartnerId\)/);
  assert.match(nativeVideoDateRoute, /openNativePostDateSurveyFromTerminalTruth\('ended_route_guard', vs\)/);
  assert.match(nativeVideoDateRoute, /openNativePostDateSurveyFromTerminalTruth\('terminal_session_recovery', session\)/);
  assert.match(nativeVideoDateRoute, /surveyOpenedRef\.current = true;\s*setShowFeedback\(true\);/);
  assert.doesNotMatch(nativeVideoDateRoute, /if \(!sessionId \|\| !user\?\.id \|\| showFeedback\) return false/);
  assert.match(nativeVideoDateRoute, /if \(showFeedback && sessionId && user\?\.id\) \{/);
  assert.doesNotMatch(nativeVideoDateRoute, /if \(phase === 'ended' && showFeedback\) \{/);
});

test("native terminal route guard keeps an already-open post-date survey mounted", () => {
  const endedGuardIndex = nativeVideoDateRoute.indexOf("if (truthDecision === 'ended') {");
  const openSurveyIndex = nativeVideoDateRoute.indexOf(
    "const openedSurvey = await openNativePostDateSurveyFromTerminalTruth('ended_route_guard', vs);",
    endedGuardIndex,
  );
  const openedSurveyBranchIndex = nativeVideoDateRoute.indexOf("if (openedSurvey) {", openSurveyIndex);
  const openedSurveyReturnIndex = nativeVideoDateRoute.indexOf("return;", openedSurveyBranchIndex);
  const bounceIndex = nativeVideoDateRoute.indexOf("route_bounced_to_lobby", openedSurveyReturnIndex);
  assert.ok(endedGuardIndex >= 0);
  assert.ok(openSurveyIndex > endedGuardIndex);
  assert.ok(openedSurveyBranchIndex > openSurveyIndex);
  assert.ok(openedSurveyReturnIndex > openedSurveyBranchIndex);
  assert.ok(bounceIndex > openedSurveyReturnIndex);
});

test("web date route opens ended-session survey only when feedback is missing", () => {
  assert.match(webVideoDatePage, /function shouldOpenPostDateSurveyForTerminalSession/);
  assert.match(webVideoDatePage, /videoSessionHasPostDateSurveyTruth\(row\) && !verdict/);
  assert.match(webVideoDatePage, /const recoverTerminalPostDateSurvey = useCallback/);
  assert.match(webVideoDatePage, /TERMINAL_SURVEY_SESSION_SELECT/);
  assert.match(webVideoDatePage, /const hydrateTerminalSurveyContext/);
  assert.match(webVideoDatePage, /setVideoDateAccess\("allowed"\)/);
  assert.match(webVideoDatePage, /terminal_survey_context_hydrated/);
  assert.match(webVideoDatePage, /participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at/);
  assert.match(webVideoDatePage, /\.from\("date_feedback"\)[\s\S]*\.eq\("session_id", id\)[\s\S]*\.eq\("user_id", user\.id\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\("session_load_terminal", sessionRow\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\("timing_terminal"\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\("realtime_terminal", row\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\(`\$\{source\}_sync_reconnect_terminal`\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\([\s\S]*"complete_handshake_survey_required"/);
  assert.match(webVideoDatePage, /reconcileTerminalSurvey\("peer_wait_terminal_reconcile_initial"\)/);
  assert.match(webVideoDatePage, /TERMINAL_SURVEY_RECONCILE_INTERVAL_MS = 2_500/);
  assert.match(webVideoDatePage, /\(isConnecting \|\| !isConnected \|\| remotePlayback\.playRejected\)[\s\S]*!showFeedback/);
});

test("terminal both-joined encounters are survey eligible and non-encounters stay excluded", () => {
  assert.match(encounterSurveyMigration, /CREATE OR REPLACE FUNCTION public\.video_date_session_has_encounter_exposure/);
  assert.match(encounterSurveyMigration, /participant_1_joined_at IS NOT NULL AND p_participant_2_joined_at IS NOT NULL/);
  assert.match(encounterSurveyMigration, /CREATE OR REPLACE FUNCTION public\.video_date_session_is_post_date_survey_eligible/);
  assert.match(encounterSurveyMigration, /COALESCE\(p_ended_reason, ''\) NOT IN \([\s\S]*'ready_gate_expired'[\s\S]*'partial_join_peer_timeout'[\s\S]*'blocked_pair'/);
  assert.doesNotMatch(encounterSurveyMigration, /'handshake_timeout'[\s\S]*'partial_join_peer_timeout'/);
  assert.match(sharedActiveSession, /function videoSessionHasEncounterExposureTruth/);
  assert.match(sharedActiveSession, /participant_1_joined_at && row\.participant_2_joined_at/);
  assert.match(sharedActiveSession, /function videoSessionHasTerminalEncounterExposureTruth/);
});

test("handshake deadline terminal encounters route both users to survey", () => {
  assert.match(encounterSurveyMigration, /CREATE OR REPLACE FUNCTION public\.finalize_video_date_handshake_deadline/);
  assert.match(encounterSurveyMigration, /v_should_open_survey := public\.video_date_session_is_post_date_survey_eligible/);
  assert.match(encounterSurveyMigration, /queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'idle' END/);
  assert.match(encounterSurveyMigration, /current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END/);
  assert.match(encounterSurveyMigration, /current_partner_id = CASE[\s\S]*WHEN v_should_open_survey THEN CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END/s);
  assert.match(encounterSurveyMigration, /'survey_required', v_should_open_survey/);
});

test("survey continuity cleanup removes remaining date-started-only reminder and transition gates", () => {
  assert.match(surveyContinuityCleanupMigration, /CREATE OR REPLACE FUNCTION public\.claim_post_date_pending_verdict_reminders/);
  assert.match(surveyContinuityCleanupMigration, /public\.video_date_session_is_post_date_survey_eligible\(/);
  assert.doesNotMatch(surveyContinuityCleanupMigration, /AND vs\.date_started_at IS NOT NULL/);
  assert.match(surveyContinuityCleanupMigration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_p1_ended_encounter_survey_lookup/);
  assert.match(surveyContinuityCleanupMigration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_p2_ended_encounter_survey_lookup/);
  assert.match(surveyContinuityCleanupMigration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)[\s\S]*RENAME TO video_date_transition_20260503110000_survey_continuity_base/);
  assert.match(surveyContinuityCleanupMigration, /queue_status = 'in_survey'/);
  assert.match(surveyContinuityCleanupMigration, /current_room_id = p_session_id/);
  assert.match(surveyContinuityCleanupMigration, /'survey_required', v_should_open_survey/);
});

test("same-event terminal encounter pairs are blocked from deck swipe and ready-gate promotion", () => {
  assert.match(encounterSurveyMigration, /CREATE OR REPLACE FUNCTION public\.video_date_pair_has_terminal_encounter/);
  assert.match(encounterSurveyMigration, /AND NOT public\.video_date_pair_has_terminal_encounter\(p_event_id, p_user_id, base\.profile_id\)/);
  assert.match(encounterSurveyMigration, /ALTER FUNCTION public\.handle_swipe\(uuid, uuid, uuid, text\)[\s\S]*RENAME TO handle_swipe_20260503090000_encounter_guard_base/);
  assert.match(encounterSurveyMigration, /public\.video_date_pair_has_terminal_encounter\(p_event_id, p_actor_id, p_target_id\)/);
  assert.match(encounterSurveyMigration, /'pair_already_met_this_event'/);
  assert.match(encounterSurveyMigration, /ALTER FUNCTION public\.promote_ready_gate_if_eligible\(uuid, uuid\)[\s\S]*RENAME TO promote_ready_gate_202605030900_base/);
  assert.match(encounterSurveyMigration, /public\.video_date_pair_has_terminal_encounter\(p_event_id, p_uid, v_partner, v_queued\.id\)/);
  assert.match(encounterSurveyMigration, /REVOKE ALL ON FUNCTION public\.handle_swipe_20260503090000_encounter_guard_base/);
  assert.match(encounterSurveyMigration, /REVOKE ALL ON FUNCTION public\.promote_ready_gate_202605030900_base/);
  assert.doesNotMatch(encounterSurveyMigration, /promote_ready_gate_if_eligible_20260503090000_encounter_guard_base/);
  assert.match(encounterPairGuardAclPolishMigration, /to_regprocedure\('public\.promote_ready_gate_if_eligible_20260503090000_encounter_guard_b\(uuid,uuid\)'\)/);
  assert.match(encounterPairGuardAclPolishMigration, /RENAME TO promote_ready_gate_202605030900_base/);
  assert.match(encounterPairGuardAclPolishMigration, /REVOKE ALL ON FUNCTION public\.handle_swipe_20260503090000_encounter_guard_base/);
  assert.match(encounterPairGuardAclPolishMigration, /REVOKE ALL ON FUNCTION public\.promote_ready_gate_202605030900_base/);
});

test("web and native ice breakers render as floating session chrome", () => {
  assert.match(webVideoDatePage, /dismissIceBreakerTemporarily/);
  assert.match(webVideoDatePage, /phase === "handshake" \|\| phase === "date"/);
  assert.match(webVideoDatePage, /remotePlayback\.participantPresent/);
  assert.match(webVideoDatePage, /data-video-date-stage/);
  assert.match(webVideoDatePage, /bottom-\[14rem\][\s\S]*IceBreakerCard/);
  assert.match(webVideoDatePage, /showCollapsedIceBreaker/);
  assert.match(webVideoDatePage, /Show ice-breaker question/);
  assert.match(webVideoDatePage, /bottom-\[6\.75rem\]/);
  assert.doesNotMatch(webVideoDatePage, /setTimeout\(\(\) => setShowIceBreaker\(false\), 30000\)/);
  assert.match(nativeVideoDateRoute, /showFloatingIceBreaker/);
  assert.match(nativeVideoDateRoute, /showCollapsedIceBreaker/);
  assert.match(nativeVideoDateRoute, /Show ice-breaker question/);
  assert.match(nativeVideoDateRoute, /iceBreakerBottomOffset/);
  assert.match(nativeVideoDateRoute, /styles\.iceBreakerFloat/);
  assert.match(nativeVideoDateRoute, /DATE_CONTROLS_STACK_HEIGHT/);
  assert.doesNotMatch(nativeVideoDateRoute, /setTimeout\(\(\) => setShowIceBreaker\(false\), 30000\)/);
});

test("video date ice breakers are synchronized and not local-only", () => {
  assert.match(sharedIceBreakers, /VIDEO_DATE_ICE_BREAKER_PROMPTS/);
  assert.match(sharedIceBreakers, /VIDEO_DATE_ICE_BREAKER_ROTATION_MS = 8_000/);
  assert.match(sharedIceBreakers, /VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS = 10_000/);
  assert.match(sharedIceBreakers, /resolveVideoDateIceBreakerIndex/);
  assert.match(iceBreakerSyncMigration, /ADD COLUMN IF NOT EXISTS vibe_question_index/);
  assert.match(iceBreakerSyncMigration, /ADD COLUMN IF NOT EXISTS vibe_question_anchor_at/);
  assert.match(iceBreakerSyncMigration, /jsonb_array_length\(v_row\.vibe_questions\) > 0/);
  assert.match(iceBreakerSyncMigration, /SET vibe_questions = v_questions,[\s\S]*vibe_question_index = 0,[\s\S]*vibe_question_anchor_at = v_now/);
  assert.match(iceBreakerSyncMigration, /CREATE OR REPLACE FUNCTION public\.advance_video_session_vibe_question/);
  assert.match(iceBreakerSyncMigration, /GRANT EXECUTE ON FUNCTION public\.advance_video_session_vibe_question\(uuid\) TO authenticated/);
  assert.match(webIceBreakerCard, /@clientShared\/matching\/videoDateIceBreakers/);
  assert.match(webIceBreakerCard, /advance_video_session_vibe_question/);
  assert.match(webIceBreakerCard, /VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS/);
  assert.match(webIceBreakerCard, /vibe_question_index/);
  assert.match(nativeVideoDateRoute, /getOrSeedVibeQuestionState/);
  assert.match(nativeVideoDateRoute, /advanceVibeQuestion/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS/);
  assert.match(nativeVideoDateRoute, /vibe-questions-\$\{sessionId\}/);
  assert.match(nativeIceBreakerCard, /layout\.minTouchTargetSize/);
  assert.match(nativeIceBreakerCard, /accessibilityLabel="Show another ice-breaker question"/);
});

test("shared ice breaker state normalizes and rotates from the server anchor", () => {
  assert.deepEqual(
    normalizeVideoDateIceBreakerQuestions([" First? ", "first?", "", 123, "Second?"]),
    ["First?", "Second?"],
  );
  const shuffled = shuffleVideoDateIceBreakerQuestions(["A", "B", "C"], () => 0);
  assert.deepEqual(shuffled, ["B", "C", "A"]);
  const anchor = "2026-05-03T12:00:00.000Z";
  assert.equal(resolveVideoDateIceBreakerIndex(3, 1, anchor, Date.parse(anchor) + 7_999), 1);
  assert.equal(resolveVideoDateIceBreakerIndex(3, 1, anchor, Date.parse(anchor) + 8_000), 2);
  assert.equal(resolveVideoDateIceBreakerIndex(3, 1, anchor, Date.parse(anchor) + 16_000), 0);
});

test("native ready and date routes validate before requesting camera and microphone", () => {
  assert.match(nativeReadyRoute, /permissionRequestEligible/);
  assert.match(nativeReadyRoute, /if \(!sessionId \|\| !user\?\.id \|\| !permissionRequestEligible\) return;/);
  assert.match(nativeReadyRoute, /setPermissionRequestEligible\(false\);[\s\S]*setPermissionsResolved\(false\);/);
  assert.match(nativeReadyRoute, /const isParticipant =[\s\S]*if \(!isParticipant\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(nativeReadyRoute, /if \(session\.ended_at\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(nativeReadyRoute, /setEventId\(session\.event_id\);\s*setPermissionRequestEligible\(true\);\s*revealReadyUi = true;/);

  const readyPermissionEffectIndex = nativeReadyRoute.indexOf(
    "if (!sessionId || !user?.id || !permissionRequestEligible) return;",
  );
  const readyParticipantCheckIndex = nativeReadyRoute.indexOf("const isParticipant =");
  const readyPermissionEligibleIndex = nativeReadyRoute.indexOf("setPermissionRequestEligible(true);");
  assert.ok(readyPermissionEffectIndex >= 0);
  assert.ok(readyParticipantCheckIndex >= 0);
  assert.ok(readyPermissionEligibleIndex > readyParticipantCheckIndex);

  assert.match(nativeVideoDateRoute, /dateEntryPermissionEligible/);
  assert.match(nativeVideoDateRoute, /if \(!getVideoSessionPartnerIdForUser\(vs, user\.id\)\) \{[\s\S]*setDateEntryPermissionEligible\(false\);/);
  assert.match(nativeVideoDateRoute, /if \(truthDecision === 'ended'\) \{[\s\S]*setDateEntryPermissionEligible\(false\);[\s\S]*openNativePostDateSurveyFromTerminalTruth\('ended_route_guard', vs\)/);
  assert.match(nativeVideoDateRoute, /if \(canAttemptDaily \|\| truthDecision === 'navigate_date'\) \{\s*setDateEntryPermissionEligible\(true\);/);
  assert.match(nativeVideoDateRoute, /session\.ended_at \|\|\s*!dateEntryPermissionEligible \|\|/);

  const dateRouteAllowsPromptIndex = nativeVideoDateRoute.indexOf("setDateEntryPermissionEligible(true);");
  const datePrejoinPermissionIndex = nativeVideoDateRoute.indexOf("const ok = await requestPermissions();");
  assert.ok(dateRouteAllowsPromptIndex >= 0);
  assert.ok(datePrejoinPermissionIndex > dateRouteAllowsPromptIndex);
});

test("remaining prepare-entry hardening defers in_handshake registration until Daily token success", () => {
  assert.match(remainingHardeningMigration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260501103000_prepare_entry_queue_guard/s);
  assert.match(remainingHardeningMigration, /registration_status', 'deferred_until_daily_token'/);
  assert.doesNotMatch(remainingHardeningMigration, /queue_status = v_registration_status/);
  assert.match(dailyRoomFunction, /const tokenWindow = resolveVideoDateMeetingTokenWindow\(\{[\s\S]*?const token = await createMeetingToken\(\s*roomName,\s*user\.id,\s*tokenWindow\.ttlSeconds,\s*undefined,\s*\{\s*ejectAtTokenExp:\s*true\s*\},?\s*\);[\s\S]*confirmVideoDateEntryPrepared/s);
  assert.match(remainingHardeningMigration, /repair_stale_video_date_prepare_entries/);
  assert.match(remainingHardeningMigration, /prepare_entry_provider_failed_repair/);
  assert.match(remainingHardeningMigration, /AND current_room_id = r\.id/);
  assert.doesNotMatch(remainingHardeningMigration, /OR queue_status = 'in_handshake'/);
  assert.match(remainingHardeningMigration, /stale_prepare_entry_registration_unlinked/);
  assert.match(remainingHardeningMigration, /Historical expire_stale_video_sessions body remains delegated\/unbounded/);
});

test("web and native use server-owned leave, reconnect, and permission recovery paths", () => {
  assert.match(dailyRoomFunction, /action === "video_date_leave"/);
  assert.match(dailyRoomFunction, /p_action: "mark_reconnect_self_away"/);
  assert.match(webVideoDatePage, /VIDEO_DATE_LEAVE_SIGNAL_SENT/);
  assert.match(webVideoDatePage, /VIDEO_DATE_LEAVE_SIGNAL_FAILED/);
  assert.match(webVideoDatePage, /leaveSignalSentRef/);
  assert.match(webVideoDatePage, /if \(leaveSignalSentRef\.current\) return;/);
  assert.match(
    webVideoDatePage,
    /source === "visibilitychange"[\s\S]*p_action: "mark_reconnect_return"[\s\S]*p_action: "sync_reconnect"/,
  );
  assert.match(webVideoDatePage, /WEB_LIFECYCLE_AWAY_GRACE_MS = 12_000/);
  assert.match(webVideoDatePage, /setTimeout\(\(\) => sendLeaveSignal\(source\), delayMs\)/);
  assert.match(webVideoCallHook, /CAMERA_PERMISSION_DENIED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_REMOTE_PLAYBACK_REQUIRES_GESTURE/);
  assert.match(webVideoCallHook, /noRemoteAutoRecoveryCountRef\.current < 2/);
  assert.match(webVideoCallHook, /Keeping your date state in sync/);
  assert.match(sharedDailyJoinedConfirmation, /DAILY_JOINED_CONFIRMATION_RETRY_DELAYS_MS = \[1_500, 3_000, 5_000\]/);
  assert.match(sharedDailyJoinedConfirmation, /function markDailyJoinedWithBackoff/);
  assert.match(sharedDailyJoinedConfirmation, /DAILY_JOINED_CONFIRMATION_TERMINAL_ERROR_CODES/);
  assert.match(webVideoCallHook, /markDailyJoinedWithBackoff\(/);
  assert.match(webVideoCallHook, /mark_video_date_daily_joined_retry_after_failure/);
  assert.match(nativeVideoDateApi, /action: 'video_date_leave'/);
  assert.match(nativeVideoDateRoute, /signalVideoDateLeave\(sessionId, 'app_background'\)/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_GRACE_STARTED/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_LEAVE_SIGNAL_FAILED/);
  assert.match(nativeVideoDateRoute, /app_background_timeout/);
  assert.match(nativeVideoDateRoute, /Keeping your date state in sync/);
  assert.match(nativeVideoDateRoute, /markDailyJoinedWithBackoff\(/);
  assert.match(nativeVideoDateRoute, /supabase\.rpc\('mark_video_date_daily_joined'/);
  assert.match(nativeVideoDateRoute, /mark_video_date_daily_joined_retry_after_failure/);
  assert.doesNotMatch(nativeVideoDateRoute, /markVideoDateDailyJoined\(sessionId\)\.then\(\(retryOk\)/);
});

test("video date button escape contracts keep web and native users routable", () => {
  assert.match(webVideoDatePage, /const handlePreDateExit = useCallback/);
  assert.match(webVideoDatePage, /runVideoDateManualExitStep\("daily_cleanup"[\s\S]*endCall\(source\)/);
  assert.match(webVideoDatePage, /runVideoDateManualExitStep\("server_end"[\s\S]*signalPreDateManualEnd\(reason\)/);
  assert.match(webVideoDatePage, /suppressDateNavigationAfterManualExit\(id\)/);
  assert.match(webVideoDatePage, /clearDateEntryTransition\(id\)/);
  assert.match(webVideoDatePage, /navigate\(target, \{ replace: true \}\)/);
  assert.match(
    webVideoDatePage,
    /onLeave=\{peerMissing\.terminal \? handlePeerMissingLeave : handlePreDateExit\}/,
  );
  assert.match(webVideoDatePage, /const hasDateEntryTruth =[\s\S]*hasEnteredDateFlowRef\.current[\s\S]*phaseRef\.current === "date"[\s\S]*Boolean\(dateStartedAt\)[\s\S]*videoSessionHasEncounterExposureTruth\(handshakeTruth\)/);
  assert.match(webVideoDatePage, /recoverTerminalPostDateSurvey\("local_end"\)/);
  assert.match(webDateNavigationGuard, /recent_manual_exit/);
  assert.match(webDateNavigationGuard, /sessionStorage/);
  assert.match(webActiveSessionHook, /isDateNavigationSuppressedAfterManualExit\(next\.sessionId\)/);
  assert.match(webConnectionOverlay, /disabled=\{isLeaving\}/);
  assert.match(webConnectionOverlay, /onClick=\{onLeave\}/);
  assert.match(webVideoDatePage, /isLeaving=\{isLeavingVideoDate\}/);

  assert.match(nativeVideoDateRoute, /const handleAbortConnection = useCallback/);
  assert.match(nativeVideoDateRoute, /abortConnectionInFlightRef/);
  assert.match(nativeVideoDateRoute, /endVideoDate\(sessionId, 'ended_from_client'\)/);
  assert.match(nativeVideoDateRoute, /endVideoDate\(sessionId, 'partial_join_peer_timeout'\)/);
  assert.match(nativeVideoDateRoute, /router\.replace\(target\)/);
  assert.match(nativeVideoDateRoute, /isLeaving=\{isAbortingConnection\}/);
  assert.match(nativeVideoDateRoute, /disabled=\{isAbortingConnection\}/);
});

test("native local date end waits for server terminal truth before survey", () => {
  assert.match(
    nativeVideoDateRoute,
    /const fetchServerTerminalTruth = useCallback\(async \(\) => \{[\s\S]*syncVideoDateReconnect\(sessionId\)[\s\S]*sync\?\.ended === true/s,
  );
  assert.match(
    nativeVideoDateRoute,
    /if \(source === 'server_end'\) \{[\s\S]*setShowFeedback\(true\)[\s\S]*await cleanupForAbortWithoutServerEnd\(\);[\s\S]*return;/s,
  );
  assert.match(
    nativeVideoDateRoute,
    /let terminalConfirmed = false;[\s\S]*terminalConfirmed = await endVideoDate\(sessionId, reason,[\s\S]*dateTimeoutV2: dateTimeoutV2\.enabled[\s\S]*terminalConfirmed = await fetchServerTerminalTruth\(\);[\s\S]*if \(!terminalConfirmed\) \{[\s\S]*setShowFeedback\(false\)[\s\S]*Alert\.alert\('Could not end date yet'[\s\S]*return;[\s\S]*logJourney\('survey_opened', \{ source: 'local_end_confirmed' \}/s,
  );
});

test("mobile terminal survey recovery does not depend on Daily-observed remote presence", () => {
  assert.match(nativeVideoDateRoute, /openNativePostDateSurveyFromTerminalTruth\('sync_reconnect'\)/);
  assert.match(nativeVideoDateRoute, /if \(!reconnectEndedHandledRef\.current\) \{/);
  assert.doesNotMatch(nativeVideoDateRoute, /if \(!reconnectEndedHandledRef\.current && partnerEverJoinedRef\.current\)/);
  assert.match(nativeVideoDateRoute, /openNativePostDateSurveyFromTerminalTruth\([\s\S]*'complete_handshake_survey_required'/);
  assert.match(nativeVideoDateApi, /survey_required\?: boolean/);
  assert.match(nativeVideoDateApi, /survey_required: payload\?\.survey_required/);
  assert.match(webVideoDatePage, /survey_required\?: boolean/);
  assert.match(webVideoDatePage, /payload\?\.survey_required === true/);
});

test("native video date overlays never mask the post-date survey", () => {
  assert.match(nativeVideoDateRoute, /const showOpeningRoomTopPill = !showFeedback &&/);
  assert.match(nativeVideoDateRoute, /const showJoiningOverlay =[\s\S]*!showFeedback &&/);
  assert.match(nativeVideoDateRoute, /const showPeerWaitOverlay =[\s\S]*!showFeedback &&/);
  assert.match(nativeVideoDateRoute, /const showHandshakeChrome =[\s\S]*!showFeedback &&/);
  assert.match(nativeVideoDateRoute, /const showDatePhaseChrome = !showFeedback &&/);
  assert.match(nativeVideoDateRoute, /\{!showFeedback && peerMissingTerminal && \(/);
});

test("web lifecycle background path delays false-away and handles freeze/pagehide safely", () => {
  assert.match(webVideoDatePage, /WEB_LIFECYCLE_AWAY_GRACE_MS = 12_000/);
  assert.match(webVideoDatePage, /lifecycleHiddenStartedAtRef/);
  assert.match(webVideoDatePage, /scheduleLifecycleAway\("visibilitychange"\)/);
  assert.match(webVideoDatePage, /document\.addEventListener\("freeze", handleFreeze\)/);
  assert.match(webVideoDatePage, /sendLifecycleAwayIfGraceElapsed\("freeze"\)/);
  assert.match(webVideoDatePage, /if \(event\.persisted\) \{[\s\S]*sendLifecycleAwayIfGraceElapsed\("pagehide"\)/);
  assert.match(webVideoDatePage, /if \(phaseRef\.current === "ended"\) return/);
  assert.match(webVideoDatePage, /surveyOpenedRef\.current/);
  assert.match(webVideoDatePage, /clearLifecycleAwayTimer\(\)/);
  assert.doesNotMatch(webVideoDatePage, /setTimeout\(\(\) => sendLeaveSignal\("visibilitychange"\), 1200\)/);
});

test("web reconnect grace surfaces partner-left UX immediately", () => {
  assert.match(webVideoCallHook, /partner_left_grace/);
  assert.match(webVideoCallHook, /startReconnectGrace\("participant_left"\)/);
  assert.match(webVideoCallHook, /reconnectRecoveryResetTimeoutRef/);
  assert.match(webVideoCallHook, /VIDEO_DATE_RECONNECT_GRACE_RECOVERED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_RECONNECT_GRACE_EXPIRED/);
  assert.match(webVideoDatePage, /dailyReconnectState === "partner_left_grace"\s+\? "partner_away"/);
  assert.match(webReconnectionOverlay, /Keeping the room open/);
  assert.match(webReconnectionOverlay, /Your match may be stepping back in\. We'll hold the room for a few seconds\./);
  assert.match(webReconnectionHook, /VIDEO_DATE_RECONNECT_GRACE_STARTED/);
  assert.match(webReconnectionHook, /VIDEO_DATE_RECONNECT_GRACE_RECOVERED/);
  assert.match(webReconnectionHook, /VIDEO_DATE_RECONNECT_GRACE_EXPIRED/);
});

test("post-date survey retries verdicts and exposes half-verdict pending state on both clients", () => {
  assert.match(remainingHardeningMigration, /awaiting_partner_verdict/);
  assert.match(remainingHardeningMigration, /post_date_half_verdict_pending/);
  assert.match(remainingHardeningMigration, /detect_post_date_half_verdict_timeouts/);
  assert.match(pendingVerdictObservabilityMigration, /post_date_half_verdict_saved/);
  assert.match(pendingVerdictObservabilityMigration, /post_date_pending_verdict_completed/);
  assert.match(pendingVerdictObservabilityMigration, /FOR UPDATE/);
  assert.match(pendingVerdictObservabilityMigration, /ON CONFLICT \(session_id, user_id\)/);
  assert.match(pendingVerdictObservabilityMigration, /check_mutual_vibe_and_match\(p_session_id\)/);
  assert.match(pendingVerdictObservabilityMigration, /partner_verdict_recorded/);
  assert.match(webPostDateSurvey, /POST_DATE_VERDICT_SUBMIT_RETRY/);
  assert.match(webPostDateSurvey, /POST_DATE_VERDICT_SUBMIT_FAILED/);
  assert.match(webPostDateSurvey, /POST_DATE_VERDICT_PENDING_PARTNER/);
  assert.match(webPostDateSurvey, /POST_DATE_HALF_VERDICT_SAVED/);
  assert.match(webPostDateSurvey, /POST_DATE_PENDING_VERDICT_COMPLETED/);
  assert.match(webPostDateSurvey, /lastVerdictAttempt/);
  assert.match(webPostDateSurvey, /Try again/);
  assert.match(webPostDateSurvey, /Awaiting your match&apos;s verdict/);
  assert.match(nativePostDateSurvey, /POST_DATE_VERDICT_SUBMIT_RETRY/);
  assert.match(nativePostDateSurvey, /POST_DATE_VERDICT_SUBMIT_FAILED/);
  assert.match(nativePostDateSurvey, /POST_DATE_VERDICT_PENDING_PARTNER/);
  assert.match(nativePostDateSurvey, /POST_DATE_HALF_VERDICT_SAVED/);
  assert.match(nativePostDateSurvey, /POST_DATE_PENDING_VERDICT_COMPLETED/);
  assert.match(nativePostDateSurvey, /lastVerdictAttempt/);
  assert.match(nativePostDateSurvey, /Try again/);
  assert.match(nativePostDateSurvey, /Awaiting your match&apos;s verdict/);
});

test("native post-date survey drains queued ready gates across the whole survey lifecycle", () => {
  assert.match(nativePostDateSurvey, /queuedNavigationStartedRef/);
  assert.match(nativePostDateSurvey, /queuedDrainAttemptKeyRef/);
  assert.match(nativePostDateSurvey, /const drainKey = `\$\{sessionId\}:\$\{eventId\}:\$\{userId\}:\$\{drainQueueV2\.enabled \? 'v2' : 'legacy'\}`/);
  assert.match(nativePostDateSurvey, /const result = await drainMatchQueue\(eventId, userId, \{/);
  assert.match(nativePostDateSurvey, /drainMatchQueueV2: drainQueueV2\.enabled/);
  assert.match(nativePostDateSurvey, /sourceSurface: 'post_date_survey'/);
  assert.match(nativePostDateSurvey, /onQueuedVideoSessionReady\?\.\(nextSessionId\)/);
  assert.match(nativePostDateSurvey, /\}, \[drainQueueV2\.enabled, eventId, onQueuedVideoSessionReady, sessionId, userId\]\);/);
  assert.doesNotMatch(nativePostDateSurvey, /step !== 'safety'/);
  assert.doesNotMatch(nativePostDateSurvey, /drainMatchQueue\(eventId, userId\)[\s\S]{0,900}\[eventId, onQueuedVideoSessionReady, step, userId\]/);
});

test("post-date queued matches route directly to standalone Ready Gate on web and native", () => {
  assert.match(webPostDateSurvey, /const target = `\/ready\/\$\{encodeURIComponent\(videoSessionId\)\}`/);
  assert.match(webPostDateSurvey, /const target = `\/ready\/\$\{encodeURIComponent\(nextSessionId\)\}`/);
  assert.match(webPostDateSurvey, /serverNext\.action === "ready_gate" && nextSessionId/);
  assert.match(webPostDateSurvey, /navigate\(target, \{ replace: true \}\)/);
  assert.match(webPostDateSurvey, /route: "ready_gate"/);
  assert.doesNotMatch(webPostDateSurvey, /buildEventLobbyPendingSessionUrl|event_lobby_pending_ready_gate/);

  assert.match(nativePostDateSurvey, /route: 'ready_gate'/);
  assert.doesNotMatch(nativePostDateSurvey, /event_lobby_pending_ready_gate/);
  assert.match(nativeVideoDateRoute, /const target = readyGateHref\(videoSessionId\)/);
  assert.doesNotMatch(nativeVideoDateRoute, /eventLobbyHrefPendingVideoSession/);
});

test("backend post-date router returns the standalone Ready Gate route label", () => {
  assert.match(readyGateRouteLabelCleanupMigration, /CREATE OR REPLACE FUNCTION public\.resolve_post_date_next_surface/);
  assert.match(readyGateRouteLabelCleanupMigration, /'action', 'ready_gate'[\s\S]*'route', 'ready_gate'/);
  assert.doesNotMatch(readyGateRouteLabelCleanupMigration, /event_lobby_pending_ready_gate/);
  assert.match(readyGateRouteLabelCleanupMigration, /REVOKE ALL ON FUNCTION public\.resolve_post_date_next_surface\(uuid\) FROM PUBLIC, anon/);
  assert.match(readyGateRouteLabelCleanupMigration, /GRANT EXECUTE ON FUNCTION public\.resolve_post_date_next_surface\(uuid\) TO authenticated, service_role/);
});

test("web standalone Ready Gate hosts the overlay instead of bouncing through lobby", () => {
  assert.match(webReadyRedirect, /import ReadyGateOverlay/);
  assert.match(webReadyRedirect, /recovery\.action === "go_ready_gate"[\s\S]+setRouteState\(\{ kind: "hosting", eventId: recovery\.eventId \}\)/);
  assert.match(webReadyRedirect, /adviseVideoSessionTruthRecovery/);
  assert.match(webReadyRedirect, /if \(recovery\.action === "go_ready_gate"\) \{[\s\S]*setRouteState\(\{ kind: "hosting", eventId: session\.event_id \}\)/);
  assert.doesNotMatch(webReadyRedirect, /READY_GATE_HOSTABLE_STATUSES/);
  assert.doesNotMatch(webReadyRedirect, /reg\?\.queue_status === "in_ready_gate"/);
  assert.match(webReadyRedirect, /persistReadyGateSuppressionV2/);
  assert.match(webReadyRedirect, /<ReadyGateOverlay/);
  assert.match(webReadyRedirect, /onNavigateToDate=\{\(nextSessionId\) => navigateToDate\(nextSessionId\)\}/);
  assert.match(webReadyRedirect, /onManualExitConfirmed=\{suppressReadyGateSessionAfterManualExit\}/);
  assert.doesNotMatch(webReadyRedirect, /recovery\.action === "go_ready_gate" \|\| recovery\.action === "go_lobby"/);
});

test("notification date deep links require provider-prepared truth before routing to date", () => {
  assert.match(notificationDeepLinkHandler, /markVideoDateEntryPipelineStarted/);
  assert.match(
    notificationDeepLinkHandler,
    /if \(recovery\.action === 'go_date'\) \{[\s\S]*markVideoDateEntryPipelineStarted\(sid\)[\s\S]*return videoDateHref\(sid\);/s,
  );
  assert.match(notificationDeepLinkHandler, /adviseVideoSessionTruthRecovery/);
  assert.match(notificationDeepLinkHandler, /if \(!vs\) return tabsRootHref\(\);/);
  assert.match(notificationDeepLinkHandler, /if \(!isParticipant\) return tabsRootHref\(\);/);
  assert.match(notificationDeepLinkHandler, /ended_reason, state, phase, handshake_started_at, date_started_at, participant_1_joined_at, participant_2_joined_at/);
  assert.match(notificationDeepLinkHandler, /videoSessionHasPostDateSurveyTruth\(vs\)/);
  assert.match(notificationDeepLinkHandler, /pending_survey_terminal_encounter/);
  assert.match(notificationDeepLinkHandler, /return videoDateHref\(sid\);/);
  assert.match(notificationDeepLinkHandler, /unknown_video_truth_decision/);
});

test("active-session resolvers emit canonical stale-session analytics for stale registration pointers", () => {
  for (const source of [webActiveSessionHook, nativeActiveSessionHook]) {
    assert.match(source, /STALE_ACTIVE_SESSION_DETECTED/);
    assert.match(source, /staleActiveSessionEventKeyRef/);
    assert.match(source, /registration_points_to_missing_session|registration_session_query_failed/);
    assert.match(source, /registration_points_to_ended_session/);
    assert.match(source, /different_event_registration_room/);
    assert.match(source, /pending_survey_recovery_stale/);
    assert.match(source, /direct_video_session_fallback_stale/);
  }
});

test("duplicate active-session conflicts use the canonical audit event on web and native", () => {
  assert.match(webSwipeActionHook, /DUPLICATE_ACTIVE_SESSION_CONFLICT/);
  assert.match(webSwipeActionHook, /outcome === "participant_has_active_session_conflict"/);
  assert.match(nativeEventLobby, /DUPLICATE_ACTIVE_SESSION_CONFLICT/);
  assert.match(nativeEventLobby, /outcome === 'participant_has_active_session_conflict'/);
});

test("video-date Daily room and token TTL use explicit finite phase-bounded constants separate from match calls", () => {
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS = 2 \* 60 \* 1000/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS = 180/);
  assert.match(dailyRoomFunction, /DAILY_MATCH_CALL_TOKEN_TTL_SECONDS = 30 \* 60/);
  assert.match(dailyRoomFunction, /DAILY_MATCH_CALL_ROOM_TTL_SECONDS = 60 \* 60/);
  assert.match(dailyRoomFunction, /enable_recording: false/);
  assert.match(dailyRoomFunction, /eject_at_room_exp: true/);
  assert.match(dailyRoomFunction, /function resolveVideoDateMeetingTokenWindow/);
  assert.match(dailyRoomFunction, /phaseDeadlineAtMs \+ DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS/);
  assert.match(dailyRoomFunction, /targetExpiresAtMs = Math\.min\(targetExpiresAtMs, params\.nowMs \+ maxTtlMs\)/);
  assert.match(dailyRoomFunction, videoDateRoomNameTokenWithExpiryEject);
  assert.match(dailyRoomFunction, videoDateRoomProofTokenWithExpiryEject);
  assert.match(dailyRoomFunction, /token_expires_at: tokenExpiresAt/);
  assert.match(dailyRoomFunction, /token_ttl_seconds: tokenWindow\.ttlSeconds/);
  assert.match(dailyRoomFunction, /token_expiry_reason: tokenWindow\.reason/);
  assert.match(dailyRoomFunction, /exp: Math\.floor\(Date\.now\(\) \/ 1000\) \+ DAILY_VIDEO_DATE_ROOM_TTL_SECONDS/);
});

test("prepare-entry documents its deterministic provider-idempotent concurrency contract", () => {
  assert.match(dailyRoomFunction, /Provider-idempotent prepare-entry contract/);
  assert.match(dailyRoomFunction, /deterministic room name/);
  assert.match(dailyRoomFunction, /already exists/);
  assert.match(dailyRoomFunction, /same-value DB writes/);
});

test("stale video-date cleanup is bounded and preserves joined or date evidence", () => {
  assert.match(cleanupProviderPresenceMigration, /CREATE OR REPLACE FUNCTION public\.expire_stale_video_sessions_bounded/);
  assert.match(cleanupProviderPresenceMigration, /CREATE OR REPLACE FUNCTION public\.expire_stale_video_date_phases_bounded/);
  assert.match(cleanupProviderPresenceMigration, /RETURN public\.expire_stale_video_sessions_bounded\(100\)/);
  assert.doesNotMatch(cleanupProviderPresenceMigration, /expire_stale_video_sessions_20260501103000_unbounded\(/);
  assert.match(cleanupProviderPresenceMigration, /v_limit integer := GREATEST\(1, LEAST\(COALESCE\(p_limit, 100\), 500\)\)/);
  assert.match(cleanupProviderPresenceMigration, /LIMIT v_limit[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(cleanupProviderPresenceMigration, /ready_gate_status IN \('ready', 'ready_a', 'ready_b'\)[\s\S]*date_started_at IS NULL[\s\S]*daily_room_name IS NULL[\s\S]*participant_1_joined_at IS NULL[\s\S]*participant_2_joined_at IS NULL/s);
  assert.match(cleanupProviderPresenceMigration, /ready_gate_status = 'both_ready'[\s\S]*date_started_at IS NULL[\s\S]*daily_room_name IS NULL[\s\S]*participant_1_joined_at IS NULL[\s\S]*participant_2_joined_at IS NULL/s);
  assert.match(cleanupProviderPresenceMigration, /ended_reason = 'ready_gate_expired'[\s\S]*date_started_at IS NULL[\s\S]*daily_room_name IS NULL[\s\S]*participant_1_joined_at IS NULL[\s\S]*participant_2_joined_at IS NULL/s);
  assert.match(cleanupProviderPresenceMigration, /state = 'handshake'::public\.video_date_state[\s\S]*date_started_at IS NULL[\s\S]*participant_1_joined_at IS NULL[\s\S]*participant_2_joined_at IS NULL/s);
  assert.match(cleanupProviderPresenceMigration, /state = 'date'::public\.video_date_state[\s\S]*date_started_at IS NOT NULL[\s\S]*queue_status = 'in_survey'/s);
  assert.match(cleanupProviderPresenceMigration, /survey_candidates[\s\S]*queue_status = 'in_survey'/s);
  assert.match(cleanupProviderPresenceMigration, /'bounded', true/);
});

test("partial Daily joins get a backend-owned peer-timeout terminal reason", () => {
  assert.match(partialJoinTimeoutMigration, /ALTER FUNCTION public\.expire_stale_video_date_phases_bounded\(integer\)\s+RENAME TO expire_stale_video_date_phases_bounded_20260501143000_partial_join_base/s);
  assert.match(partialJoinTimeoutMigration, /CREATE OR REPLACE FUNCTION public\.expire_stale_video_date_partial_joins_bounded/);
  assert.match(partialJoinTimeoutMigration, /state = 'handshake'::public\.video_date_state[\s\S]*date_started_at IS NULL[\s\S]*\(\(participant_1_joined_at IS NULL\) <> \(participant_2_joined_at IS NULL\)\)/s);
  assert.match(partialJoinTimeoutMigration, /GREATEST\([\s\S]*participant_1_joined_at[\s\S]*participant_2_joined_at[\s\S]*handshake_started_at[\s\S]*started_at[\s\S]*\) \+ interval '90 seconds' <= v_now/s);
  assert.match(partialJoinTimeoutMigration, /AND NOT \([\s\S]*reconnect_grace_ends_at IS NOT NULL[\s\S]*reconnect_grace_ends_at > v_now[\s\S]*\)/s);
  assert.match(partialJoinTimeoutMigration, /ended_reason = 'partial_join_peer_timeout'/);
  assert.match(partialJoinTimeoutMigration, /queue_status = 'idle'[\s\S]*AND current_room_id = r\.id/s);
  assert.match(partialJoinTimeoutMigration, /record_event_loop_observability\([\s\S]*'expire_stale_video_sessions'[\s\S]*'partial_join_peer_timeout'[\s\S]*'joined_evidence'/s);
  assert.match(partialJoinTimeoutMigration, /'timeout_source', 'expire_stale_video_date_phases_bounded'/);
  assert.match(partialJoinTimeoutMigration, /'watchdog_source', 'server_cleanup'/);
  assert.match(partialJoinTimeoutMigration, /CREATE OR REPLACE FUNCTION public\.expire_stale_video_date_phases_bounded/);
  assert.match(partialJoinTimeoutMigration, /v_base := public\.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base\(v_limit\)/);
  assert.match(partialJoinTimeoutMigration, /'partial_join_peer_timeout', COALESCE\(\(v_partial->>'partial_join_peer_timeout'\)::int, 0\)/);
});

test("partial join cleanup polish removes accidental identifier truncation and exposes cleanup timeline rows", () => {
  assert.match(
    partialJoinObservabilityPolishMigration,
    /ALTER FUNCTION public\.expire_stale_video_date_phases_bounded_20260501143000_partial_j\(integer\)\s+RENAME TO expire_vd_phases_base_20260501133000/s,
  );
  assert.match(
    partialJoinObservabilityPolishMigration,
    /v_base := public\.expire_vd_phases_base_20260501133000\(v_limit\)/,
  );
  assert.match(partialJoinObservabilityPolishMigration, /'expire_stale_video_sessions'/);
  assert.match(partialJoinObservabilityPolishMigration, /stale cleanup/);
  assert.doesNotMatch(
    partialJoinObservabilityPolishMigration,
    /v_base := public\.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base/,
  );
  assert.match(videoDateValidationSql, /partial_join_cleanup_helper_has_intentional_name/);
  assert.match(videoDateValidationSql, /timeline_includes_stale_cleanup_events/);
});

test("handshake deadline finalizer removes grace and finalizes all due decision states", () => {
  assert.match(handshakeDeadlineFinalizerMigration, /CREATE OR REPLACE FUNCTION public\.finalize_video_date_handshake_deadline/);
  assert.match(handshakeDeadlineFinalizerMigration, /handshake_started_at \+ interval '60 seconds' <= v_now/);
  assert.match(handshakeDeadlineFinalizerMigration, /v_terminal_reason := 'handshake_not_mutual'/);
  assert.match(handshakeDeadlineFinalizerMigration, /v_terminal_reason := 'handshake_timeout'/);
  assert.match(handshakeDeadlineFinalizerMigration, /handshake_deadline_completed_mutual/);
  assert.match(handshakeDeadlineFinalizerMigration, /handshake_deadline_not_mutual/);
  assert.match(handshakeDeadlineFinalizerMigration, /handshake_deadline_timeout/);
  assert.match(handshakeDeadlineFinalizerMigration, /handshake_grace_removed', true/);
  assert.doesNotMatch(handshakeDeadlineFinalizerMigration, /v_now \+ interval '10 seconds'/);
  assert.doesNotMatch(handshakeDeadlineFinalizerMigration, /handshake_grace_started/);
});

test("both-joined handshakes past the 60s deadline are no longer preserved forever", () => {
  assert.match(handshakeDeadlineFinalizerMigration, /CREATE OR REPLACE FUNCTION public\.expire_due_joined_video_date_handshakes_bounded/);
  assert.match(
    handshakeDeadlineFinalizerMigration,
    /participant_1_joined_at IS NOT NULL[\s\S]*participant_2_joined_at IS NOT NULL[\s\S]*handshake_started_at \+ interval '60 seconds' <= v_now/s,
  );
  assert.match(
    handshakeDeadlineFinalizerMigration,
    /v_due := public\.expire_due_joined_video_date_handshakes_bounded\(v_limit\)/,
  );
  assert.match(
    handshakeDeadlineFinalizerMigration,
    /'handshake_deadline_timeout', COALESCE\(\(v_due->>'handshake_deadline_timeout'\)::int, 0\)/,
  );
  assert.match(handshakeDeadlineFinalizerMigration, /server_cleanup_due_joined_handshake/);
});

test("handshake deadline cleanup polish removes accidental identifier truncation", () => {
  assert.match(
    handshakeDeadlinePolishMigration,
    /ALTER FUNCTION public\.expire_stale_video_date_phases_bounded_20260502143000_handshake\(integer\)\s+RENAME TO expire_vd_phases_base_20260502143000/s,
  );
  assert.match(handshakeDeadlinePolishMigration, /v_base := public\.expire_vd_phases_base_20260502143000\(v_limit\)/);
  assert.match(handshakeDeadlinePolishMigration, /expire_due_joined_video_date_handshakes_bounded\(v_limit\)/);
  assert.doesNotMatch(
    handshakeDeadlinePolishMigration,
    /expire_stale_video_date_phases_bounded_20260502143000_handshake_deadline_base/,
  );
  assert.match(videoDateValidationSql, /handshake_deadline_cleanup_helper_has_intentional_name/);
});

test("web and native countdown-zero paths complete handshake and last-10s urgency is bounded to handshake", () => {
  assert.match(webVideoDatePage, /handshake_visible_countdown_elapsed[\s\S]{0,220}trigger: "complete_handshake"/);
  assert.match(webVideoDatePage, /checkMutualVibeRef\.current\?\.\("handshake_visible_countdown_elapsed"\)/);
  assert.match(webVideoDatePage, /countdownCompletionKeyRef/);
  assert.doesNotMatch(webVideoDatePage, /handshake_grace_expiry/);
  assert.match(nativeVideoDateRoute, /handshake_visible_countdown_elapsed[\s\S]{0,220}trigger: 'complete_handshake'/);
  assert.match(nativeVideoDateRoute, /completeHandshakeFromServerDeadline\('handshake_visible_countdown_elapsed'\)/);
  assert.match(nativeVideoDateRoute, /countdownCompletionKeyRef/);
  assert.doesNotMatch(nativeVideoDateRoute, /handshake_grace_expiry/);
  assert.match(webVibeCheckButton, /const isFinalTenSeconds = timeLeft <= 10/);
  assert.match(webVibeCheckButton, /Continue when ready/);
  assert.doesNotMatch(webVibeCheckButton, /Soft nudge/);
  assert.doesNotMatch(webVibeCheckButton, /Choose from the feeling/);
  assert.match(webHandshakeTimer, /const isUrgent = timeLeft <= 10/);
  assert.match(nativeVideoDateRoute, /phase === 'handshake' && handshakeTimerStarted && displayTimeLeft <= 10/);
  assert.match(nativeVibeCheckButton, /const isFinalTenSeconds = timeLeft <= 10/);
  assert.match(nativeVibeCheckButton, /Continue when ready/);
  assert.doesNotMatch(nativeVibeCheckButton, /Your choice only continues after it saves/);
  assert.doesNotMatch(nativeVibeCheckButton, /Soft nudge/);
  assert.doesNotMatch(nativeVibeCheckButton, /Choose from the feeling/);
  assert.doesNotMatch(nativeVideoDateRoute, /addTimeFab/);
});

test("partial join terminal reason is excluded from post-date survey contracts", () => {
  assert.match(sharedActiveSession, /"partial_join_peer_timeout"/);
  assert.match(partialJoinTimeoutMigration, /'partial_join_peer_timeout'/);
  assert.match(partialJoinManualEndMigration, /'partial_join_peer_timeout'/);
  assert.match(videoDateValidationSql, /'partial_join_peer_timeout'/);
});

test("peer-missing user exit preserves the canonical partial-join terminal reason", () => {
  assert.match(partialJoinManualEndMigration, /CREATE OR REPLACE FUNCTION public\.video_date_transition/);
  assert.match(
    partialJoinManualEndMigration,
    /v_requested_reason IN \('partial_join_peer_timeout', 'peer_missing_timeout'\)/,
  );
  assert.match(
    partialJoinManualEndMigration,
    /v_exactly_one_joined := \([\s\S]*participant_1_joined_at IS NULL[\s\S]*<>[\s\S]*participant_2_joined_at IS NULL[\s\S]*\)/,
  );
  assert.match(partialJoinManualEndMigration, /v_reached_date_phase OR NOT v_exactly_one_joined/);
  assert.match(partialJoinManualEndMigration, /'ended_from_client'/);
  assert.match(partialJoinManualEndMigration, /ended_reason = 'partial_join_peer_timeout'/);
  assert.match(partialJoinManualEndMigration, /'watchdog_source', 'client_peer_missing_exit'/);
  assert.match(partialJoinManualEndMigration, /'survey_eligible', false/);
  assert.match(partialJoinManualEndMigration, /'joined_evidence'/);
  assert.match(
    webVideoDatePage,
    /handlePreDateExit\(\{ reason: "partial_join_peer_timeout", source: "peer_missing_back_to_lobby" \}\)/,
  );
  assert.match(nativeVideoDateRoute, /endVideoDate\(sessionId, 'partial_join_peer_timeout'\)/);
});

test("web and native expose clear peer-missing choices instead of toast-only timeout copy", () => {
  assert.match(webVideoCallHook, /setPeerMissing\(\{ terminal: true \}\)/);
  assert.match(webConnectionOverlay, /They may need a little more time\./);
  assert.match(webConnectionOverlay, /keep waiting a little longer/);
  assert.match(webConnectionOverlay, /Keep waiting/);
  assert.match(webConnectionOverlay, /Try reconnecting/);
  assert.match(webVideoCallHook, /noRemoteAutoRecoveryCountRef\.current < 2/);
  assert.match(webVideoCallHook, /cleanupCallObject\("startCall", "no_remote_auto_recovery"\)/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_WAIT_STARTED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_RETRY_TAP/);
  assert.match(webVideoDatePage, /endCall\("peer_missing_retry"\)/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_NO_REMOTE_USER_EXIT/);
  assert.match(nativeVideoDateRoute, /They may need a little more time\./);
  assert.match(nativeVideoDateRoute, /keep waiting a little longer/);
  assert.match(nativeVideoDateRoute, /Try reconnecting/);
  assert.match(nativeVideoDateRoute, /Keep waiting/);
  assert.match(nativeVideoDateRoute, /Back to lobby/);
});

test("web video date access recovery covers permission denial and playback-blocked CTAs", () => {
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_MEDIA_PERMISSION_DENIED: 'video_date_media_permission_denied'/);
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_MEDIA_PERMISSION_RETRY: 'video_date_media_permission_retry'/);
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_MEDIA_PERMISSION_RECOVERED: 'video_date_media_permission_recovered'/);
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_PLAYBACK_BLOCKED: 'video_date_playback_blocked'/);
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_PLAYBACK_RETRY: 'video_date_playback_retry'/);
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_PLAYBACK_RECOVERED: 'video_date_playback_recovered'/);
  assert.match(webVideoCallHook, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(webVideoCallHook, /preflightMediaPermission/);
  assert.match(webVideoCallHook, /failure: \{ kind: "media_permission_denied", retryable: true \}/);
  assert.match(webVideoCallHook, /VIDEO_DATE_MEDIA_PERMISSION_DENIED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_MEDIA_PERMISSION_RECOVERED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_PLAYBACK_BLOCKED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_PLAYBACK_RETRY/);
  assert.match(webVideoCallHook, /VIDEO_DATE_PLAYBACK_RECOVERED/);
  assert.match(webSelfViewPip, /VIDEO_DATE_PLAYBACK_BLOCKED/);
  assert.match(webSelfViewPip, /VIDEO_DATE_PLAYBACK_RETRY/);
  assert.match(webSelfViewPip, /VIDEO_DATE_PLAYBACK_RECOVERED/);
  assert.match(webSelfViewPip, /Tap to resume video/);
  assert.match(webVideoDatePage, /Allow access so your date can begin softly with audio and video/);
  assert.match(webVideoDatePage, /VIDEO_DATE_MEDIA_PERMISSION_RETRY/);
  assert.match(webVideoDatePage, /clearMediaPermissionError\(\)/);
  assert.match(webConnectionOverlay, /Resume audio\/video/);
  assert.match(webConnectionOverlay, /browser paused the video or audio/);
});

test("web Daily reconnect states cannot suppress the connection overlay forever", () => {
  assert.match(
    webVideoCallHook,
    /if \(!reconnectGraceActiveRef\.current\) \{[\s\S]*setReconnectGraceTimeLeft\(0\);[\s\S]*setDailyReconnectState\("connected"\);[\s\S]*return;/,
  );
  assert.match(
    webVideoCallHook,
    /if \(event\?\.event === "reconnecting"\) \{[\s\S]*startReconnectGrace\("network_reconnecting"\);[\s\S]*setDailyReconnectState\("partner_reconnecting"\);/,
  );
  assert.match(
    webVideoCallHook,
    /if \(event\?\.event === "reconnected" \|\| event\?\.event === "connected"\) \{[\s\S]*recoverTransport\(`network_\$\{event\.event\}`\);/,
  );
});

test("web video-date loading guard emits production-safe slow-path diagnostics", () => {
  assert.match(lobbyToPostDateJourney, /VIDEO_DATE_ROUTE_GUARD_SLOW: 'video_date_route_guard_slow'/);
  assert.match(webVideoDatePage, /VIDEO_DATE_ACCESS_LOADING_WATCHDOG_MS = 8_000/);
  assert.match(webVideoDatePage, /VIDEO_DATE_ROUTE_GUARD_SLOW/);
  assert.match(webVideoDatePage, /video_date_route_guard_slow/);
  assert.match(webVideoDatePage, /date_guard_loading_watchdog/);
  assert.match(webVideoDatePage, /setVideoDateAccess\("allowed"\);[\s\S]*get_profile_for_viewer/);
  assert.match(webVideoDatePage, /date_guard_partner_profile_failed/);
});

test("observability v1 logs ready-gate transitions without owning semantics", () => {
  assert.match(
    videoDateObservabilityV1Migration,
    /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260501135000_observability_base/s,
  );
  assert.match(
    videoDateObservabilityV1Migration,
    /v_result := public\.ready_gate_transition_20260501135000_observability_base\(\s*p_session_id,\s*p_action,\s*p_reason\s*\)/s,
  );
  assert.match(videoDateObservabilityV1Migration, /'ready_gate_transition'/);
  assert.match(videoDateObservabilityV1Migration, /WHEN p_action = 'mark_ready' AND v_status_after = 'both_ready' THEN 'both_ready'/);
  assert.match(videoDateObservabilityV1Migration, /WHEN p_action = 'mark_ready' THEN 'mark_ready'/);
  assert.match(videoDateObservabilityV1Migration, /WHEN p_action = 'snooze' THEN 'snooze'/);
  assert.match(videoDateObservabilityV1Migration, /WHEN p_action = 'forfeit' THEN 'forfeit'/);
  assert.match(videoDateObservabilityV1Migration, /WHEN p_action = 'sync' AND v_status_after = 'expired' THEN 'sync_expired'/);
  assert.match(videoDateObservabilityV1Migration, /'status_before', v_before\.ready_gate_status/);
  assert.match(videoDateObservabilityV1Migration, /'status_after', v_status_after/);
  assert.match(videoDateObservabilityV1Migration, /'state_before', v_before\.state::text/);
  assert.match(videoDateObservabilityV1Migration, /'state_after', v_after\.state::text/);
  assert.match(videoDateObservabilityV1Migration, /'ready_gate_expires_at_before', v_before\.ready_gate_expires_at/);
  assert.match(videoDateObservabilityV1Migration, /'ready_gate_expires_at_after', v_after\.ready_gate_expires_at/);
  assert.match(videoDateObservabilityV1Migration, /RETURN v_result;/);
  assert.match(videoDateObservabilityV1Migration, /REVOKE ALL ON FUNCTION public\.ready_gate_transition_20260501135000_observability_base\(uuid, text, text\)\s+FROM PUBLIC, anon, authenticated/);
  assert.match(videoDateObservabilityV1Migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\) TO anon, authenticated, service_role/);
  assert.doesNotMatch(videoDateObservabilityV1Migration, /RAISE\s+EXCEPTION/i);
});

test("observability v1 exposes a service-role-only ordered session timeline", () => {
  assert.match(videoDateObservabilityV1Migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_session_timeline\(p_session_id uuid\)/);
  assert.match(videoDateObservabilityV1Migration, /RETURNS TABLE \([\s\S]*timeline_seq bigint[\s\S]*occurred_at timestamptz[\s\S]*detail jsonb/s);
  assert.match(videoDateObservabilityV1Migration, /WHERE eo\.session_id = p_session_id/);
  assert.match(videoDateObservabilityV1Migration, /'ready_gate_transition'/);
  assert.match(videoDateObservabilityV1Migration, /'video_date_transition'/);
  assert.match(videoDateObservabilityV1Migration, /'post_date_pending_verdict_completed'/);
  assert.match(videoDateObservabilityV1Migration, /'video_sessions'/);
  assert.match(videoDateObservabilityV1Migration, /'participant_1_daily_joined'/);
  assert.match(videoDateObservabilityV1Migration, /'participant_2_daily_joined'/);
  assert.match(videoDateObservabilityV1Migration, /'date_started'/);
  assert.match(videoDateObservabilityV1Migration, /row_number\(\) OVER \(ORDER BY tr\.occurred_at ASC, tr\.sort_order ASC, tr\.operation ASC\)/);
  assert.match(videoDateObservabilityV1Migration, /ORDER BY tr\.occurred_at ASC, tr\.sort_order ASC, tr\.operation ASC/);
  assert.match(videoDateObservabilityV1Migration, /REVOKE ALL ON FUNCTION public\.get_video_date_session_timeline\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(videoDateObservabilityV1Migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_session_timeline\(uuid\) TO service_role/);
});

test("observability v2 adds Daily provider lifecycle rows to the service-role timeline", () => {
  for (const operation of [
    "create_date_room_attempt",
    "create_date_room_reused_existing_db_room",
    "create_date_room_provider_already_exists",
    "create_date_room_provider_created",
    "create_date_room_provider_recovered_or_recreated",
    "create_date_room_token_issued",
    "create_date_room_blocked_session_ended",
    "create_date_room_blocked_access_denied",
    "create_date_room_provider_error",
  ]) {
    assert.match(videoDateObservabilityV2Migration, new RegExp(`'${operation}'`));
    assert.match(dailyRoomFunction, new RegExp(`"${operation}"`));
  }

  assert.match(videoDateObservabilityV2Migration, /GRANT EXECUTE ON FUNCTION public\.record_event_loop_observability\(text, text, text, integer, uuid, uuid, uuid, jsonb\)\s+TO service_role/);
  assert.match(videoDateObservabilityV2Migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_session_timeline\(p_session_id uuid\)/);
  assert.match(videoDateObservabilityV2Migration, /WHERE eo\.session_id = p_session_id/);
  assert.match(videoDateObservabilityV2Migration, /row_number\(\) OVER \(ORDER BY tr\.occurred_at ASC, tr\.sort_order ASC, tr\.operation ASC\)/);
  assert.match(videoDateObservabilityV2Migration, /REVOKE ALL ON FUNCTION public\.get_video_date_session_timeline\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(videoDateObservabilityV2Migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_session_timeline\(uuid\) TO service_role/);
});

test("client stuck observability is authenticated, allowlisted, deduped, and timeline-visible", () => {
  assert.match(
    clientStuckObservabilityMigration,
    /CREATE OR REPLACE FUNCTION public\.record_video_date_client_stuck_observability/,
  );
  assert.match(clientStuckObservabilityMigration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(clientStuckObservabilityMigration, /participant_1_id IS DISTINCT FROM v_actor/);
  assert.match(clientStuckObservabilityMigration, /participant_2_id IS DISTINCT FROM v_actor/);
  for (const eventName of [
    "ready_gate_handoff_slow",
    "prepare_date_entry_failed",
    "daily_join_confirmation_failed",
    "peer_missing_terminal",
    "native_background_recovery_started",
    "native_background_recovery_failed",
    "native_background_expired",
  ]) {
    assert.match(clientStuckObservabilityMigration, new RegExp(`'${eventName}'`));
  }
  assert.match(clientStuckObservabilityMigration, /'unknown_event_name'/);
  assert.match(clientStuckObservabilityMigration, /event_loop_obs_video_date_client_stuck_once_idx/);
  assert.match(
    clientStuckObservabilityMigration,
    /ON CONFLICT \(session_id, actor_id, operation, reason_code\)[\s\S]*WHERE operation = 'video_date_client_stuck_state'/,
  );
  assert.match(clientStuckObservabilityMigration, /REVOKE ALL ON FUNCTION public\.record_video_date_client_stuck_observability\(uuid, text, jsonb, integer\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(clientStuckObservabilityMigration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_client_stuck_observability\(uuid, text, jsonb, integer\)[\s\S]*TO authenticated/);
  assert.match(clientStuckObservabilityMigration, /'video_date_client_stuck_state'/);
  assert.match(clientStuckObservabilityMigration, /video_date_client_stuck_safe_text/);
  assert.match(clientStuckObservabilityMigration, /video_date_client_stuck_safe_int/);
  assert.match(clientStuckObservabilityMigration, /video_date_client_stuck_safe_bool/);
  assert.match(readyGateOverlay, /emitWebVideoDateClientStuckState/);
  assert.match(readyGateOverlay, /ready_gate_handoff_slow/);
  assert.match(readyGateOverlay, /prepare_date_entry_failed/);
  assert.match(nativeReadyGateOverlay, /emitNativeVideoDateClientStuckState/);
  assert.match(nativeReadyGateOverlay, /ready_gate_handoff_slow/);
  assert.match(nativeReadyGateOverlay, /prepare_date_entry_failed/);
  assert.match(webVideoCallHook, /daily_join_confirmation_failed/);
  assert.match(webVideoCallHook, /peer_missing_terminal/);
  assert.match(nativeVideoDateRoute, /daily_join_confirmation_failed/);
  assert.match(nativeVideoDateRoute, /peer_missing_terminal/);
  assert.match(nativeVideoDateRoute, /native_background_recovery_started/);
  assert.match(nativeVideoDateRoute, /native_background_recovery_failed/);
  assert.match(nativeVideoDateRoute, /native_background_expired/);
  assert.match(videoDateValidationSql, /client_stuck_observability_rpc_granted_authenticated_only/);
  assert.match(videoDateValidationSql, /timeline_includes_client_stuck_events/);
});

test("launch latency checkpoints are durable, allowlisted, and admin-visible", () => {
  assert.match(
    launchLatencyCheckpointObservabilityMigration,
    /CREATE OR REPLACE FUNCTION public\.record_video_date_launch_latency_checkpoint/,
  );
  assert.match(launchLatencyCheckpointObservabilityMigration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /participant_1_id IS DISTINCT FROM v_actor/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /participant_2_id IS DISTINCT FROM v_actor/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'video_date_launch_latency_checkpoint'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'first_remote_frame'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'ready_tap_to_first_remote_frame_ms'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'date_route_bootstrap_ms'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'daily_join_to_remote_seen_ms'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'cached_prepare_entry'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'provider_verify_skipped'/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /'permission_handoff_used'/);
  assert.match(launchLatencyPrepareTimingSlicesMigration, /record_video_date_launch_latency_checkpoint_20260506101000_prepare_timing_base/);
  assert.match(launchLatencyPrepareTimingBaseNamePolishMigration, /record_vd_launch_latency_202605061020_base/);
  assert.match(videoDateValidationSql, /record_vd_launch_latency_202605061020_base/);
  for (const field of [
    "auth_ms",
    "prepare_rpc_ms",
    "room_create_or_verify_ms",
    "token_ms",
    "confirm_prepare_ms",
    "edge_total_ms",
    "provider_verify_reason",
  ]) {
    assert.match(launchLatencyCheckpointObservability, new RegExp(`"${field}"`));
    assert.match(launchLatencyPrepareTimingSlicesMigration, new RegExp(`'${field}'`));
    assert.match(launchLatencyPrepareTimingBaseNamePolishMigration, new RegExp(`'${field}'`));
    assert.match(videoDateValidationSql, new RegExp(field));
  }
  assert.match(launchLatencyCheckpointObservabilityMigration, /v_ready_actor_order/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /TO authenticated/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /video_date_launch_latency_checkpoint/);
  assert.match(launchLatencyCheckpointObservabilityMigration, /get_video_date_session_timeline/);
  assert.match(launchLatencyCheckpointObservability, /emitVideoDateLaunchLatencyCheckpointObservability/);
  assert.match(launchLatencyCheckpointObservability, /ready_tap_to_first_remote_frame_ms/);
  for (const checkpoint of [
    "daily_prewarm_join_started",
    "daily_prewarm_join_success",
    "daily_prewarm_join_failure",
    "daily_prewarm_solo_join_started",
    "daily_prewarm_solo_join_success",
    "daily_prewarm_solo_join_failure",
    "video_date_route_preload_started",
    "video_date_route_preload_success",
  ]) {
    assert.match(videoDateOperatorMetrics, new RegExp(`"${checkpoint}"`));
    assert.match(launchLatencyCheckpointObservability, new RegExp(`"${checkpoint}"`));
    assert.match(launchLatencyJoinPrewarmCheckpointsMigration, new RegExp(`'${checkpoint}'`));
  }
  assert.match(videoDateOperatorMetrics, /"permission_check_skipped"/);
  assert.match(launchLatencyCheckpointObservability, /"permission_check_skipped"/);
  assert.match(launchLatencyPermissionPrewarmSkipCheckpointMigration, /'permission_check_skipped'/);
  assert.match(webAnalytics, /emitVideoDateLaunchLatencyCheckpointObservability/);
  assert.match(nativeAnalytics, /emitVideoDateLaunchLatencyCheckpointObservability/);
  assert.match(webAnalytics, /recordOperationalLaunchLatencyCheckpoint/);
  assert.match(nativeAnalytics, /recordOperationalLaunchLatencyCheckpoint/);
  assert.doesNotMatch(webAnalytics, /setTimeout\(emit, 0\)/);
  assert.doesNotMatch(nativeAnalytics, /setTimeout\(emit, 0\)/);
  for (const prepareEntrySource of [webPrepareEntry, nativePrepareEntry]) {
    assert.equal(prepareEntrySource.match(/\bprepareBackendTimingExtra\b/g)?.length, 2);
    assert.match(prepareEntrySource, /const providerVerifyExtra = \{[\s\S]*provider_verify_reason/);
    assert.match(prepareEntrySource, /const prepareEntrySuccessExtra = result\.cached \? providerVerifyExtra : prepareBackendTimingExtra/);
    assert.match(prepareEntrySource, /['"]prepare_entry_success['"][\s\S]*prepareEntrySuccessExtra/);
    assert.doesNotMatch(prepareEntrySource, /trackLatencyCheckpoint\(\s*providerVerifyCheckpoint[\s\S]*?prepareBackendTimingExtra/);
    assert.doesNotMatch(prepareEntrySource, /['"]enter_handshake_success['"][\s\S]{0,250}prepareBackendTimingExtra/);
    assert.doesNotMatch(prepareEntrySource, /['"]daily_token_success['"][\s\S]{0,250}prepareBackendTimingExtra/);
    assert.doesNotMatch(prepareEntrySource, /checkpoint: ['"]token_created['"][\s\S]*?extra: prepareBackendTimingExtra/);
  }
  assert.match(launchLatencyBaselineSql, /backend_timing_rows AS \(/);
  assert.match(launchLatencyBaselineSql, /WHERE checkpoint = 'prepare_entry_success'/);
  assert.match(launchLatencyBaselineSql, /FROM backend_timing_rows GROUP BY platform/);
  assert.match(webAnalytics, /operational reliability telemetry/);
  assert.match(nativeAnalytics, /operational reliability telemetry/);
  assert.match(webVideoDatePage, /date_guard_registration_status_failed/);
  assert.match(webVideoCallHook, /activePreparedEntryCacheHitRef/);
  assert.doesNotMatch(webVideoCallHook, /cachedPrepareEntry:\s*Boolean\(entry\)/);
  assert.doesNotMatch(nativeVideoDateRoute, /cachedPrepareEntry:\s*Boolean\(activePreparedEntryCacheRef\.current\)/);
  assert.match(nativeVideoDateApi, /cached_prepare_entry: result\.cached/);
  assert.match(adminVideoDateOpsFunction, /getReadyTapToFirstRemoteFrameLatency/);
  assert.match(adminVideoDateOpsFunction, /ready_tap_to_first_remote_frame_latency/);
  assert.match(adminVideoDateOpsFunction, /segment_breakdown/);
  assert.match(adminVideoDateOpsFunction, /cohort_breakdown/);
  assert.match(adminVideoDateOpsFunction, /slowest_sessions/);
  assert.match(adminVideoDateOpsFunction, /attachSlowLaunchTimelines/);
  assert.match(adminVideoDateOpsFunction, /get_video_date_session_timeline/);
  assert.match(adminVideoDateOpsFunction, /SLOW_LAUNCH_TIMELINE_SESSION_LIMIT = 5/);
  assert.match(adminVideoDateOpsFunction, /SLOW_LAUNCH_TIMELINE_ROW_LIMIT = 12/);
  assert.match(adminVideoDateOpsFunction, /\.slice\(0, SLOW_LAUNCH_TIMELINE_SESSION_LIMIT\)/);
  assert.match(adminVideoDateOpsFunction, /\.slice\(-SLOW_LAUNCH_TIMELINE_ROW_LIMIT\)/);
  assert.match(adminLiveEventMetrics, /Slowest sessions/);
  assert.match(adminVideoDateOpsFunction, /daily_prewarm_consumed/);
  assert.match(adminVideoDateOpsFunction, /daily_prewarm_fallback/);
  assert.match(videoDateValidationSql, /launch_latency_checkpoint_rpc_granted_authenticated_only/);
  assert.match(videoDateValidationSql, /launch_latency_checkpoint_primary_fields_allowlisted/);
  assert.match(videoDateValidationSql, /record_video_date_launch_latency_checkpoint_20260505214500_rpc_short_circuit_base/);
  assert.match(videoDateValidationSql, /permission_check_skipped/);
  assert.match(videoDateValidationSql, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(videoDateValidationSql, /timeline_includes_launch_latency_checkpoints/);
});

test("Daily prewarm is platform-owned, flag-gated, consumable once, and instrumented", () => {
  assert.match(webDailyPrewarm, /VITE_VIDEO_DATE_DAILY_PREWARM/);
  assert.match(webDailyPrewarm, /VITE_VIDEO_DATE_DAILY_JOIN_PREWARM/);
  assert.match(nativeDailyPrewarm, /EXPO_PUBLIC_VIDEO_DATE_DAILY_PREWARM/);
  assert.match(nativeDailyPrewarm, /EXPO_PUBLIC_VIDEO_DATE_DAILY_JOIN_PREWARM/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_ROOM_WARMUP_AFTER_READY=true/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_DAILY_PREWARM=true/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_DAILY_JOIN_PREWARM=true/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_DAILY_SOLO_PREJOIN=false/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_DAILY_BANDWIDTH_OPTIMIZED=false/);
  assert.match(webEnvExample, /VITE_VIDEO_DATE_DAILY_DEVICE_PREFERENCE_COOKIES=false/);
  assert.match(nativeEnvExample, /EXPO_PUBLIC_VIDEO_DATE_ROOM_WARMUP_AFTER_READY=true/);
  assert.match(nativeEnvExample, /EXPO_PUBLIC_VIDEO_DATE_DAILY_PREWARM=true/);
  assert.match(nativeEnvExample, /EXPO_PUBLIC_VIDEO_DATE_DAILY_JOIN_PREWARM=true/);
  assert.match(nativeEnvExample, /EXPO_PUBLIC_VIDEO_DATE_DAILY_SOLO_PREJOIN=false/);
  assert.match(nativeEnvExample, /EXPO_PUBLIC_VIDEO_DATE_DAILY_BANDWIDTH_OPTIMIZED=false/);
  assert.match(webDailyPrewarm, /WEB_DAILY_PREWARM_JOIN_NAV_WAIT_MS = 250/);
  assert.match(nativeDailyPrewarm, /NATIVE_DAILY_PREWARM_JOIN_NAV_WAIT_MS = 250/);
  for (const source of [webDailyPrewarm, nativeDailyPrewarm]) {
    assert.match(source, /45_000/);
    assert.match(source, /daily_prewarm_started/);
    assert.match(source, /daily_prewarm_camera_ready/);
    assert.match(source, /daily_prewarm_preauth_success/);
    assert.match(source, /daily_prewarm_join_started/);
    assert.match(source, /daily_prewarm_join_success/);
    assert.match(source, /daily_prewarm_join_failure/);
    assert.match(source, /daily_prewarm_solo_join_started/);
    assert.match(source, /daily_prewarm_solo_join_success/);
    assert.match(source, /daily_prewarm_solo_join_failure/);
    assert.match(source, /daily_prewarm_consumed/);
    assert.match(source, /daily_prewarm_fallback/);
    assert.match(source, /daily_prewarm_destroyed/);
    assert.match(source, /fallbackEntry/);
    assert.match(source, /function publicEntry/);
    assert.match(source, /function joinPrewarmEnabled\([^)]*joinSource/);
    assert.match(source, /joinSource === ['"]solo_prejoin['"]/);
    assert.match(source, /if \(\s*entry\.status === ['"]joined['"]\s*\)\s*\{\s*return true;/s);
    assert.doesNotMatch(source, /return \{ ok: true, entry: existing \}/);
    assert.doesNotMatch(source, /return \{ ok: true, entry \}/);
    assert.match(source, /fallbackEntry\(entry, ['"]daily_prewarm_expired['"]\)/);
    assert.match(source, /fallbackEntry\(entry, ['"]daily_prewarm_room_mismatch['"]\)/);
    assert.match(source, /fallbackEntry\(entry, ['"]daily_prewarm_capture_profile_mismatch['"]\)/);
    assert.match(source, /startCamera\(\{ url: params\.roomUrl \}\)/);
    assert.match(source, /preAuth\(\{ url: params\.roomUrl, token: params\.token \}\)/);
    assert.match(source, /\.join\(\{ url: params\.roomUrl, token: params\.token \}\)/);
    assert.match(source, /entry\.status !== ['"]consumed['"]/);
    assert.match(source, /entry\.status === ['"]consumed['"]/);
    assert.match(source, /prewarmEntries\.delete\(key\)/);
    assert.match(source, /captureProfile !== params\.captureProfile/);
    assert.match(source, /roomUrl !== params\.roomUrl/);
  }
  assert.match(webDailyPrewarm, /DailyIframe\.createCallObject\(/);
  assert.match(webDailyPrewarm, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia\(captureProfile/);
  assert.match(webDailyPrewarm, /dailyVideoDateCallObjectOptions\(captureProfile\)/);
  assert.match(webDailyPrewarm, /firstLiveTrack\(appAcquiredMedia\.stream\.getVideoTracks\(\)\)/);
  assert.match(webDailyPrewarm, /finally\s*\{[\s\S]*stopMediaStreamTracks\(entry\.appAcquiredMedia\?\.stream\)/);
  assert.match(nativeDailyPrewarm, /createVideoDateDailyCallObject\(captureProfile\)/);
  assert.match(readyGateOverlay, /startWebVideoDateDailyPrewarm/);
  assert.match(readyGateOverlay, /startRoomWarmupAfterReady\("ready_tap_mark_ready_success"/);
  assert.match(readyGateOverlay, /WEB_READY_GATE_SILENT_PERMISSION_FALLBACK_WAIT_MS = 100/);
  assert.match(readyGateOverlay, /permission_check_skipped/);
  assert.match(readyGateOverlay, /skipped_no_permissions_api/);
  assert.match(readyGateOverlay, /const \[cameraStatus, microphoneStatus\]/);
  assert.match(readyGateOverlay, /cameraStatus\.state !== "granted" \|\| microphoneStatus\.state !== "granted"/);
  assert.match(readyGateOverlay, /hasPriorGrantedVideoDateDeviceLabels/);
  assert.match(readyGateOverlay, /enumerateDevices/);
  assert.match(readyGateOverlay, /permission_prewarm_silent_no_permissions_api/);
  assert.match(readyGateOverlay, /waitForMediaStreamWithTimeout/);
  assert.match(readyGateOverlay, /stopMediaStreamTracks\(stream(?:\.stream)?\)/);
  assert.match(readyGateOverlay, /preAuthWebVideoDateDailyPrewarm/);
  assert.match(readyGateOverlay, /joinWebVideoDateDailyPrewarm/);
  assert.match(readyGateOverlay, /prepareVideoDateSoloEntry/);
  assert.match(readyGateOverlay, /videoDateDailySoloPrejoinEnabled/);
  assert.match(readyGateOverlay, /preloadVideoDateRoute/);
  assert.match(nativeReadyGateOverlay, /preloadVideoDateRoute/);
  assert.match(nativeReadyGateOverlay, /router\.prefetch\(`\/date\/\$\{sessionId\}` as Href\)/);
  assert.match(readyGateOverlay, /destroyWebVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /startRoomWarmupAfterReady\('ready_tap_mark_ready_success'/);
  assert.match(nativeReadyGateOverlay, /preAuthNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /joinNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /prepareVideoDateSoloEntry/);
  assert.match(nativeReadyGateOverlay, /videoDateDailySoloPrejoinEnabled/);
  assert.match(nativeReadyGateOverlay, /destroyNativeVideoDateDailyPrewarm/);
  assert.match(webVideoCallHook, /consumeWebVideoDateDailyPrewarm/);
  assert.match(webVideoCallHook, /provider_verify_skipped: handoff\.cacheEntry\.value\.provider_verify_skipped/);
  assert.match(webVideoCallHook, /daily_join_skipped_prewarmed_already_joined/);
  assert.match(webVideoCallHook, /daily_join_completed_by_prewarm_inflight/);
  assert.match(webVideoCallHook, /reusedCallObject: singletonCall\.ok === true \|\| prewarmedCall\.ok === true/);
  assert.match(nativeVideoDateRoute, /consumeNativeVideoDateDailyPrewarm/);
  assert.match(nativeVideoDateRoute, /daily_join_skipped_prewarmed_already_joined/);
  assert.match(nativeVideoDateRoute, /daily_join_completed_by_prewarm_inflight/);
  assert.match(nativeVideoDateRoute, /dailyPrewarmConsumedForJoin = reusedPrewarmed/);
  assert.match(nativeVideoDateRoute, /reusedCallObject: Boolean\(existingCall\)/);
  assert.match(readyGateOverlay, /latestUnmountCleanupContextRef/);
  assert.match(
    readyGateOverlay,
    /useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]*mountedRef\.current = false[\s\S]*latestUnmountCleanupContextRef\.current[\s\S]*\};\s*\}, \[\]\);/,
  );
  assert.doesNotMatch(
    readyGateOverlay,
    /ready_gate_unmount_before_date_navigation[\s\S]{0,500}\}, \[sessionId, user\?\.id\]\);/,
  );
});

test("video date trace id is propagated through prepare entry analytics and Daily-room payloads", () => {
  for (const source of [webPrepareEntry, nativePrepareEntry]) {
    assert.match(source, /const videoDateTraceId = entryAttemptId/);
    assert.match(source, /video_date_trace_id: videoDateTraceId/);
    assert.match(source, /videoDateTraceId/);
    assert.match(source, /video_date_trace_id: attemptId/);
    assert.match(source, /result\.data\.video_date_trace_id \?\? result\.data\.entry_attempt_id \?\? videoDateTraceId/);
  }

  assert.match(dailyRoomFunction, /function readVideoDateTraceContext/);
  assert.match(dailyRoomFunction, /body\?\.video_date_trace_id \?\? body\?\.videoDateTraceId/);
  assert.match(dailyRoomFunction, /providedTraceId \?\? providedEntryAttemptId \?\? \(shouldGenerateTrace \? createServerVideoDateTraceId\(\) : null\)/);
  assert.match(dailyRoomFunction, /video_date_trace_id: videoDateTraceId/);
  assert.match(webVideoCallHook, /const videoDateTraceId = roomData\.video_date_trace_id \?\? entryAttemptId/);
  assert.match(webVideoCallHook, /VIDEO_DATE_DAILY_JOIN_STARTED[\s\S]*video_date_trace_id: videoDateTraceId/);
  assert.match(webVideoCallHook, /VIDEO_DATE_DAILY_JOIN_SUCCESS[\s\S]*video_date_trace_id: videoDateTraceId/);
  assert.match(webVideoCallHook, /VIDEO_DATE_DAILY_JOIN_FAILURE[\s\S]*video_date_trace_id: preparedEntryAtFailure\?\.value\.video_date_trace_id/);
  assert.match(nativeVideoDateApi, /video_date_trace_id: result\.data\.video_date_trace_id \?\? result\.data\.entry_attempt_id \?\? null/);
  assert.match(nativeVideoDateRoute, /const videoDateTraceId =[\s\S]*tokenResult\.video_date_trace_id/s);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_DAILY_JOIN_STARTED[\s\S]*video_date_trace_id: videoDateTraceId/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_DAILY_JOIN_SUCCESS[\s\S]*video_date_trace_id: videoDateTraceId/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_DAILY_JOIN_FAILURE[\s\S]*video_date_trace_id: preparedEntryAtFailure\?\.value\.video_date_trace_id/);
});

test("Daily provider observability is fail-soft and redacts token material", () => {
  const helperBody = dailyRoomFunction.match(
    /async function recordVideoDateProviderObservability[\s\S]*?\n}\n\nfunction createBlockedDateRoomResponse/,
  )?.[0] ?? "";
  assert.match(helperBody, /try \{/);
  assert.match(helperBody, /catch \(error\)/);
  assert.match(helperBody, /video_date_provider_observability_failed/);
  assert.doesNotMatch(helperBody, /\btoken\b/i);

  assert.match(dailyRoomFunction, /operation: "create_date_room_token_issued"[\s\S]*detail: \{[\s\S]*provider_room_reused/s);
});

test("operator timeline UI uses admin Edge Function instead of direct browser RPC", () => {
  assert.match(adminDashboardPage, /video-date-timeline/);
  assert.match(adminDashboardPage, /useSearchParams/);
  assert.match(adminDashboardPage, /panelFromSearchParams/);
  assert.match(adminDashboardPage, /nextSearchParams\.delete\("session_id"\)/);
  assert.match(adminDashboardPage, /<AdminVideoDateTimelinePanel \/>/);
  assert.match(adminLiveEventMetrics, /Open timeline/);
  assert.match(adminLiveEventMetrics, /panel=video-date-timeline&session_id=/);
  assert.match(adminVideoDateTimelinePanel, /functions\.invoke<AdminVideoDateTimelineResponse>\(\s*"admin-video-date-ops"/);
  assert.match(adminVideoDateTimelinePanel, /action: "get_session_timeline"/);
  assert.match(adminVideoDateTimelinePanel, /searchParams\.get\("session_id"\)/);
  assert.match(adminVideoDateTimelinePanel, /nextSearchParams\.set\("session_id", nextSessionId\)/);
  assert.match(adminVideoDateTimelinePanel, /const handleSessionInputChange = \(value: string\) => \{/);
  assert.match(adminVideoDateTimelinePanel, /value\.trim\(\) !== submittedSessionId[\s\S]*setSubmittedSessionId\(""\)/);
  assert.match(adminVideoDateTimelinePanel, /onChange=\{\(event\) => handleSessionInputChange\(event\.target\.value\)\}/);
  assert.match(adminVideoDateTimelinePanel, /if \(!navigator\.clipboard\)/);
  assert.match(adminVideoDateTimelinePanel, /await navigator\.clipboard\.writeText\(value\)/);
  assert.match(adminVideoDateTimelinePanel, /Could not copy/);
  assert.match(adminVideoDateTimelinePanel, /formatTimestamp/);
  assert.match(adminVideoDateTimelinePanel, /\{rows\.length\} rows/);
  assert.match(adminVideoDateTimelinePanel, /redactVideoDateTimelineDetail/);
  assert.match(adminVideoDateTimelinePanel, /extractVideoDateTimelineTraceIds/);
  assert.doesNotMatch(adminVideoDateTimelinePanel, /rpc\(["']get_video_date_session_timeline/);
});

test("admin-video-date-ops gates service-role timeline access behind role and session validation", () => {
  assert.match(adminVideoDateOpsFunction, /action === "get_session_timeline"/);
  assert.match(adminVideoDateOpsFunction, /isValidUuid\(sessionId\)/);
  assert.match(adminVideoDateOpsFunction, /typedErrorResponse\("invalid_session_id"/);
  assert.match(adminVideoDateOpsFunction, /hasVideoDateTimelineRole\(roleRows\)/);
  assert.match(adminVideoDateOpsFunction, /const allowedRoles = \["admin"\]/);
  assert.doesNotMatch(adminVideoDateOpsFunction, /"moderator"/);
  assert.match(adminVideoDateOpsFunction, /\.in\("role", allowedRoles\)/);
  assert.match(adminVideoDateOpsFunction, /const service = createClient\(supabaseUrl, serviceKey\)/);
  assert.match(adminVideoDateOpsFunction, /service\.rpc\("get_video_date_session_timeline"/);
  assert.match(adminVideoDateOpsFunction, /typedErrorResponse\(timeline\.code, timeline\.error, timeline\.status\)/);
  assert.match(adminVideoDateOpsFunction, /code: "not_found"/);
  assert.match(adminVideoDateOpsFunction, /safeVideoDateTimelineRows/);
});

test("Sprint E missing observability events are typed and wired", () => {
  for (const eventName of [
    "REALTIME_FALLBACK_TO_POLL",
    "MARK_VIDEO_DATE_DAILY_JOINED_FAILED",
    "VIDEO_DATE_SYNC_RECONNECT_FAILED",
    "STALE_ACTIVE_SESSION_DETECTED",
    "DUPLICATE_ACTIVE_SESSION_CONFLICT",
    "VIDEO_DATE_NO_REMOTE_WAIT_STARTED",
    "VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT",
    "VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED",
    "VIDEO_DATE_NO_REMOTE_USER_EXIT",
  ]) {
    assert.match(lobbyToPostDateJourney, new RegExp(`${eventName}:`));
  }
  assert.match(readyGateOverlay, /REALTIME_FALLBACK_TO_POLL/);
  assert.match(webVideoCallHook, /MARK_VIDEO_DATE_DAILY_JOINED_FAILED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_SYNC_RECONNECT_FAILED/);
  assert.match(webActiveSessionHook, /STALE_ACTIVE_SESSION_DETECTED/);
  assert.match(webSwipeActionHook, /DUPLICATE_ACTIVE_SESSION_CONFLICT/);
});

test("Sprint 1H journey trace map covers critical Video Date release signals", () => {
  for (const stage of [
    "swipe_result",
    "ready_gate_opened",
    "ready_gate_ready_tap",
    "ready_gate_terminal_action",
    "both_ready_observed",
    "prepare_entry_started",
    "prepare_entry_success",
    "prepare_entry_failure",
    "daily_join_started",
    "daily_join_success",
    "daily_join_failure",
    "remote_participant_seen",
    "survey_shown",
    "survey_recovered",
    "verdict_submitted",
    "mutual_result",
    "cleanup_deferred_or_deleted",
  ]) {
    assert.match(videoDateJourneyTraceMap, new RegExp(`stage: "${stage}"`));
  }

  for (const eventName of [
    "READY_GATE_HANDOFF_RECOVERY",
    "READY_GATE_TERMINAL_ACTION_SUCCESS",
    "READY_GATE_TERMINAL_ACTION_FAILURE",
    "VIDEO_DATE_PREPARE_ENTRY_STARTED",
    "VIDEO_DATE_PREPARE_ENTRY_SUCCESS",
    "VIDEO_DATE_PREPARE_ENTRY_FAILURE",
    "VIDEO_DATE_DAILY_JOIN_STARTED",
    "VIDEO_DATE_DAILY_JOIN_SUCCESS",
    "VIDEO_DATE_DAILY_JOIN_FAILURE",
    "VIDEO_DATE_REMOTE_SEEN",
    "VIDEO_DATE_SURVEY_OPENED",
    "VIDEO_DATE_SURVEY_RECOVERED",
    "VIDEO_DATE_SURVEY_SUBMITTED",
    "MUTUAL_VIBE_OUTCOME",
    "CLEANUP_DEFERRED_ACTIVE_PARTICIPANTS",
    "CLEANUP_DEFERRED_PROVIDER_CHECK_FAILED",
  ]) {
    assert.match(lobbyToPostDateJourney, new RegExp(`${eventName}:`));
    assert.match(videoDateJourneyTraceMap, new RegExp(`LobbyPostDateEvents\\.${eventName}`));
  }

  for (const key of ["session_id", "event_id", "source_surface", "source_action", "outcome"]) {
    assert.match(videoDateJourneyTraceMap, new RegExp(`"${key}"`));
  }
  assert.match(videoDateJourneyTraceMap, /correlationKeys: \["session_id", "room_name", "provider_status", "reason", "ended_reason"\]/);
  assert.match(videoDateJourneyTraceMap, /Cleanup signals are structured Edge logs, not PostHog events/);
  assert.doesNotMatch(videoDateJourneyTraceMap, /correlationKeys:\s*\[[^\]]*(token|secret|credential|authorization)/i);
});

test("Sprint 1H added recovery trace points are wired with safe correlation metadata", () => {
  assert.match(eventLobby, /READY_GATE_HANDOFF_RECOVERY/);
  assert.match(eventLobby, /source_surface: "event_lobby"/);
  assert.match(eventLobby, /source_action: `\$\{source\}_prepare_failed_ready_gate_recovery`/);
  assert.match(eventLobby, /outcome: "recovered"/);
  assert.match(eventLobby, /reason_code: result\.code/);
  assert.match(eventLobby, /retryable: result\.retryable/);

  for (const readyGateSource of [readyGateOverlay, nativeReadyGateOverlay]) {
    assert.match(readyGateSource, /READY_GATE_TERMINAL_ACTION_SUCCESS/);
    assert.match(readyGateSource, /READY_GATE_TERMINAL_ACTION_FAILURE/);
    assert.match(readyGateSource, /source_surface: ['"]ready_gate_overlay['"]/);
    assert.match(readyGateSource, /outcome: ['"]success['"]/);
    assert.match(readyGateSource, /outcome: ['"]failure['"]/);
    assert.match(readyGateSource, /reason_code: ['"]ready_gate_forfeit_failed['"]/);
    assert.match(readyGateSource, /retryable: true/);
  }

  for (const dateRouteSource of [webVideoDatePage, nativeVideoDateRoute]) {
    assert.match(dateRouteSource, /VIDEO_DATE_SURVEY_RECOVERED/);
    assert.match(dateRouteSource, /source_surface: ['"]video_date_route['"]/);
    assert.match(dateRouteSource, /outcome: ['"]recovered['"]/);
    assert.match(dateRouteSource, /reason_code/);
  }

  assert.match(dailyRoomFunction, /event: "video_date_provider_room_missing_or_expired_recovering"/);
  assert.match(dailyRoomFunction, /provider_room_recovered/);
  assert.match(videoDateRoomCleanupFunction, /event: "cleanup_deferred_active_participants"/);
  assert.match(videoDateRoomCleanupFunction, /event: "cleanup_deferred_provider_check_failed"/);
  assert.match(videoDateRoomCleanupFunction, /event: "cleanup_room_not_found"/);
  assert.match(videoDateRoomCleanupFunction, /event: "cleanup_delete_failed"/);
  assert.match(videoDateRoomCleanupFunction, /reason: presence\.reason/);

  for (const source of [
    eventLobby,
    readyGateOverlay,
    nativeReadyGateOverlay,
    webVideoDatePage,
    nativeVideoDateRoute,
    videoDateRoomCleanupFunction,
  ]) {
    assert.doesNotMatch(source, /(READY_GATE_HANDOFF_RECOVERY|READY_GATE_TERMINAL_ACTION_|VIDEO_DATE_SURVEY_RECOVERED)[\s\S]{0,700}(token|secret|credential|authorization)/i);
  }
});

test("persistent Ready Gate polling fallback becomes user-visible without blocking the gate", () => {
  assert.match(readyGateOverlay, /REALTIME_FALLBACK_TO_POLL/);
  assert.match(readyGateOverlay, /setTimeout\(\(\) => \{[\s\S]*setShowRealtimeFallbackCopy\(true\)[\s\S]*\}, 6_000\)/);
  assert.match(readyGateOverlay, /Syncing your date status/);
});

test("native video dates configure supported Expo Audio mode without expo-av", () => {
  assert.doesNotMatch(nativePackageJson, /"expo-av"/);
  assert.doesNotMatch(nativeSafeAudioMode, /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/);
  assert.match(nativeSafeAudioMode, /from 'expo-audio'/);
  assert.match(nativeSafeAudioMode, /setAudioModeAsync/);
  assert.match(nativeSafeAudioMode, /shouldRouteThroughEarpiece: false/);
  assert.match(nativeVideoDateRoute, /setSafeAudioMode\(\{[\s\S]*playsInSilentModeIOS: true[\s\S]*allowsRecordingIOS: true/s);
});

test("native AppState background path remains statically covered for away, return, and timeout", () => {
  assert.match(nativeVideoDateRoute, /NATIVE_BACKGROUND_GRACE_MS = 12_000/);
  assert.match(nativeVideoDateRoute, /appStateBackgroundStartedAtRef/);
  assert.match(nativeVideoDateRoute, /backgroundElapsedMs >= NATIVE_BACKGROUND_GRACE_MS/);
  assert.match(nativeVideoDateRoute, /signalVideoDateLeave\(sessionId, 'app_background'\)/);
  assert.match(nativeVideoDateRoute, /cleanupDailyAndLocalState\(\)/);
  assert.match(nativeVideoDateRoute, /markReconnectReturn\(sessionId\)/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_GRACE_STARTED/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_RECOVERED/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_EXPIRED/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_LEAVE_SIGNAL_FAILED/);
  assert.match(nativeVideoDateRoute, /Pausing your date/);
  assert.match(nativeVideoDateRoute, /Reconnected/);
  assert.match(nativeVideoDateRoute, /app_background_timeout/);
  assert.match(nativeVideoDateRoute, /setTimeout\(\(\) => \{[\s\S]*endVideoDate\(sessionId, 'app_background_timeout'\)[\s\S]*\}, NATIVE_BACKGROUND_GRACE_MS\)/);
});

test("half-verdict timeout detector is scheduled through optional pg_cron", () => {
  assert.match(halfVerdictTimeoutCronMigration, /post-date-half-verdict-timeout-detection/);
  assert.match(halfVerdictTimeoutCronMigration, /cron\.schedule/);
  assert.match(halfVerdictTimeoutCronMigration, /detect_post_date_half_verdict_timeouts\(interval ''24 hours'', 100\)/);
});

test("pending post-date verdict reminder automation is server-owned and idempotent", () => {
  assert.match(pendingVerdictReminderMigration, /CREATE TABLE IF NOT EXISTS public\.post_date_pending_verdicts/);
  assert.match(pendingVerdictReminderMigration, /session_id uuid PRIMARY KEY/);
  assert.match(pendingVerdictReminderMigration, /reminder_eligible_at timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '5 minutes'\)/);
  assert.match(pendingVerdictReminderMigration, /reminder_sent_at timestamptz/);
  assert.match(pendingVerdictReminderMigration, /stale_at timestamptz/);
  assert.match(pendingVerdictReminderMigration, /completed_at timestamptz/);
  assert.match(pendingVerdictReminderMigration, /ALTER TABLE public\.post_date_pending_verdicts ENABLE ROW LEVEL SECURITY/);
  assert.match(pendingVerdictReminderMigration, /REVOKE ALL ON TABLE public\.post_date_pending_verdicts FROM anon/);
  assert.match(pendingVerdictReminderMigration, /CREATE POLICY "Admins can view pending post-date verdicts"/);
  assert.match(pendingVerdictReminderMigration, /claim_post_date_pending_verdict_reminders/);
  assert.match(pendingVerdictReminderMigration, /FOR UPDATE OF pd SKIP LOCKED/);
  assert.match(pendingVerdictReminderMigration, /pd\.reminder_sent_at IS NULL/);
  assert.match(pendingVerdictReminderMigration, /NOT EXISTS \([\s\S]*df\.user_id = pd\.missing_user_id/);
  assert.match(pendingVerdictReminderMigration, /NOT public\.is_blocked\(pd\.submitted_by, pd\.missing_user_id\)/);
  assert.match(pendingVerdictReminderMigration, /FROM public\.user_reports ur[\s\S]*ur\.reporter_id = pd\.submitted_by[\s\S]*ur\.reported_id = pd\.missing_user_id/);
  assert.match(pendingVerdictReminderMigration, /status = 'reminded'/);
  assert.match(pendingVerdictReminderMigration, /GRANT EXECUTE ON FUNCTION public\.claim_post_date_pending_verdict_reminders\(integer\) TO service_role/);
});

test("pending post-date verdict stale and completion state stays observable", () => {
  assert.match(pendingVerdictReminderMigration, /mark_post_date_pending_verdicts_stale/);
  assert.match(pendingVerdictReminderMigration, /first_detected_at < now\(\) - COALESCE\(p_older_than, interval '24 hours'\)/);
  assert.match(pendingVerdictReminderMigration, /status = 'stale'/);
  assert.match(pendingVerdictReminderMigration, /post_date_pending_verdict_stale/);
  assert.match(pendingVerdictReminderMigration, /detect_post_date_half_verdict_timeouts/);
  assert.match(pendingVerdictReminderMigration, /RETURN public\.mark_post_date_pending_verdicts_stale\(p_older_than, p_limit\)/);
  assert.match(pendingVerdictReminderMigration, /INSERT INTO public\.post_date_pending_verdicts/);
  assert.match(pendingVerdictReminderMigration, /ON CONFLICT \(session_id\) DO UPDATE/);
  assert.match(pendingVerdictReminderMigration, /UPDATE public\.post_date_pending_verdicts[\s\S]*completed_at = COALESCE\(completed_at, now\(\)\)[\s\S]*status = 'completed'/);
  assert.match(pendingVerdictReminderMigration, /post_date_pending_verdict_completed/);
  assert.match(pendingVerdictReminderMigration, /CREATE OR REPLACE FUNCTION public\.check_mutual_vibe_and_match/);
  assert.match(pendingVerdictReminderMigration, /reported_pair/);
  assert.match(pendingVerdictReminderMigration, /neither blocked nor reported/);
  assert.match(lobbyToPostDateJourney, /POST_DATE_PENDING_VERDICT_REMINDER_SENT/);
  assert.match(lobbyToPostDateJourney, /POST_DATE_PENDING_VERDICT_REMINDER_FAILED/);
  assert.match(lobbyToPostDateJourney, /POST_DATE_PENDING_VERDICT_STALE/);
});

test("check_mutual_vibe_and_match blocks direct nonparticipant execution", () => {
  assert.match(checkMutualVibeLockdownMigration, /CREATE OR REPLACE FUNCTION public\.check_mutual_vibe_and_match/);
  assert.match(checkMutualVibeLockdownMigration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(checkMutualVibeLockdownMigration, /v_service_role boolean := auth\.role\(\) = 'service_role'/);
  assert.match(checkMutualVibeLockdownMigration, /WHERE id = p_session_id\s+FOR UPDATE/s);
  assert.match(
    checkMutualVibeLockdownMigration,
    /IF NOT v_service_role[\s\S]*v_session\.participant_1_id IS DISTINCT FROM v_actor[\s\S]*v_session\.participant_2_id IS DISTINCT FROM v_actor[\s\S]*'error', 'not_participant'/,
  );
  assert.match(
    checkMutualVibeLockdownMigration,
    /REVOKE ALL ON FUNCTION public\.check_mutual_vibe_and_match\(uuid\) FROM authenticated/,
  );
  assert.match(
    checkMutualVibeLockdownMigration,
    /GRANT EXECUTE ON FUNCTION public\.check_mutual_vibe_and_match\(uuid\) TO service_role/,
  );
  assert.match(pendingVerdictReminderMigration, /v_inner := public\.check_mutual_vibe_and_match\(p_session_id\)/);
});

test("post-date verdict reminder Edge worker is CRON_SECRET guarded and sends neutral payloads", () => {
  assert.match(supabaseConfig, /\[functions\.post-date-verdict-reminders\]\s+verify_jwt = false/);
  assert.match(pendingVerdictReminderMigration, /post-date-verdict-reminders/);
  assert.match(pendingVerdictReminderMigration, /cron\.schedule\(/);
  assert.match(pendingVerdictReminderMigration, /\/functions\/v1\/post-date-verdict-reminders/);
  assert.match(postDateVerdictRemindersFunction, /Deno\.env\.get\("CRON_SECRET"\)/);
  assert.match(postDateVerdictRemindersFunction, /incoming !== `Bearer \$\{cronSecret\}`/);
  assert.match(postDateVerdictRemindersFunction, /claim_post_date_pending_verdict_reminders/);
  assert.match(postDateVerdictRemindersFunction, /mark_post_date_pending_verdicts_stale/);
  assert.match(postDateVerdictRemindersFunction, /record_post_date_pending_verdict_reminder_result/);
  assert.match(postDateVerdictRemindersFunction, /category: "post_date_feedback_reminder"/);
  assert.match(postDateVerdictRemindersFunction, /Your video date is waiting for your feedback\./);
  assert.match(postDateVerdictRemindersFunction, /Share your post-date vibe to finish the flow\./);
  assert.match(postDateVerdictRemindersFunction, /deepLink = `\/date\/\$\{row\.session_id\}`/);
  assert.match(sendNotificationFunction, /post_date_feedback_reminder: 'notify_date_reminder'/);
  assert.match(sendNotificationFunction, /post_date_feedback_reminder: \{[\s\S]*Your video date is waiting for your feedback\./);
  assert.doesNotMatch(postDateVerdictRemindersFunction, /\bliked\b/);
  assert.doesNotMatch(postDateVerdictRemindersFunction, /data:\s*\{[\s\S]*submitted_by/);
});
