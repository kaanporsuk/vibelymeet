import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSpendVideoDateCreditExtensionPayload,
  remainingDatePhaseSeconds,
} from "./videoDateExtensionSpend";
import { VIDEO_DATE_HANDSHAKE_TRUTH_SELECT } from "./videoDateHandshakePersistence";
import {
  getPostDateLobbyContinuityDecision,
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  secondsUntilPostDateEventEnd,
} from "./postDateContinuity";

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
const readyGateOverlay = readFileSync(
  join(process.cwd(), "src/components/lobby/ReadyGateOverlay.tsx"),
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
const webActiveSessionHook = readFileSync(
  join(process.cwd(), "src/hooks/useActiveSession.ts"),
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
const webVideoDatePage = readFileSync(
  join(process.cwd(), "src/pages/VideoDate.tsx"),
  "utf8",
);
const nativeVideoDateRoute = readFileSync(
  join(process.cwd(), "apps/mobile/app/date/[id].tsx"),
  "utf8",
);
const adminVideoDateOpsFunction = readFileSync(
  join(process.cwd(), "supabase/functions/admin-video-date-ops/index.ts"),
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
  assert.match(migration, /v_now \+ interval '15 seconds'/);
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
  assert.match(dailyRoomFunction, /createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\)/);
  assert.match(dailyRoomFunction, /provider_verify_skipped/);
  assert.match(dailyRoomFunction, /reused_room: reusedRoom/);
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

test("daily-room prepare_date_entry verifies or recreates unsafe provider room state before token issuance", () => {
  assert.match(dailyRoomFunction, /async function ensureVideoDateProviderRoomForToken/);
  assert.match(dailyRoomFunction, /const providerRoomState = await getDailyRoomProviderState\(roomName\)/);
  assert.match(dailyRoomFunction, /const recoveryPlan = planDailyProviderRoomRecovery\(providerRoomState\)/);
  assert.match(dailyRoomFunction, /if \(recoveryPlan\.shouldCreate\) \{/);
  assert.match(dailyRoomFunction, /video_date_provider_room_missing_or_expired_recovering/);
  assert.match(dailyRoomFunction, /await createDailyRoom\(roomName, videoDateRoomProperties\(\)\)/);
  assert.match(dailyRoomFunction, /providerRoomRecovered = Boolean\(existingRoomName\) \|\| providerRoomState\.expired/);
  assert.match(dailyRoomFunction, /providerVerifySkipped: false/);
  assert.doesNotMatch(dailyRoomFunction, /shouldSkipDailyProviderVerifyForVideoDate/);
  assert.doesNotMatch(dailyRoomFunction, /provider_verify_skipped",/);

  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  const prepareTokenIndex = dailyRoomFunction.indexOf(
    "const token = await createMeetingToken(roomName, user.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS);",
    prepareIndex,
  );
  const prepareVerifyIndex = dailyRoomFunction.indexOf("ensureVideoDateProviderRoomForToken", prepareIndex);
  assert.ok(prepareVerifyIndex > prepareIndex);
  assert.ok(prepareTokenIndex > prepareVerifyIndex);
});

test("legacy join_date_room verifies or recovers provider room before token issuance", () => {
  const joinIndex = dailyRoomFunction.indexOf('if (action === "join_date_room")');
  const nextActionIndex = dailyRoomFunction.indexOf("if (action === \"create_match_call\")", joinIndex);
  const joinBlock = dailyRoomFunction.slice(joinIndex, nextActionIndex);

  assert.match(joinBlock, /daily_room_name, daily_room_url/);
  assert.match(joinBlock, /if \(session\.ended_at\)[\s\S]*code: "SESSION_ENDED"/);
  assert.match(joinBlock, /if \(!canIssueVideoDateRoomToken\(session\)\)[\s\S]*code: "READY_GATE_NOT_READY"/);
  assert.doesNotMatch(joinBlock, /if \(!session\.daily_room_name\)[\s\S]*code: "ROOM_NOT_FOUND"/);
  assert.doesNotMatch(joinBlock, /daily_room_name_guard/);
  assert.match(joinBlock, /const roomProof = await ensureVideoDateProviderRoomForToken/);
  assert.match(joinBlock, /createMeetingToken\(\s*roomProof\.roomName,\s*user\.id,\s*DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS/s);
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
    /onVideoSessionReady:\s*\(videoSessionId\)\s*=>\s*\{[\s\S]*openReadyGateSession\(videoSessionId, "swipe_result"\)[\s\S]*refetchScopedSession\(\)/,
  );
});

test("native ready-gate paths are success-gated with no timer fallback route", () => {
  assert.doesNotMatch(nativeReadyGateOverlay, /PREPARE_ENTRY_NAV_GRACE_MS/);
  assert.doesNotMatch(nativeReadyGateOverlay, /both_ready_prepare_grace|prepare_grace/);
  assert.doesNotMatch(nativeReadyGateOverlay, /setTimeout\(\s*\(\)\s*=>[\s\S]{0,200}onNavigateToDate/s);
  assert.match(nativeReadyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_SLOW_WAIT/);
  assert.match(nativeReadyGateOverlay, /VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV/);
  assert.match(nativeReadyGateOverlay, /if \(result\.ok === true\) \{[\s\S]*navigateWithLatency\(`\$\{source\}_prepare_success`\)/s);
  assert.match(nativeReadyGateOverlay, /setPrepareEntryStatus\('failed'\)/);
  assert.match(nativeReadyGateOverlay, /retryPrepareEntry/);
});

test("ready-gate terminal actions wait for server forfeit before closing", () => {
  assert.match(webReadyGateHook, /type ReadyGateTransitionAction = "mark_ready" \| "forfeit" \| "snooze" \| "sync"/);
  assert.match(webReadyGateHook, /const runReadyGateTransition = useCallback\(async \(action: ReadyGateTransitionAction\): Promise<boolean> =>/);
  assert.match(webReadyGateHook, /const skip = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(webReadyGateHook, /const \{ error \} = await supabase\.rpc\("ready_gate_transition"/);
  assert.match(webReadyGateHook, /const syncSession = useCallback\(async \(\): Promise<ReadyGateSyncResult> =>/);
  assert.match(webReadyGateHook, /p_action: "sync" satisfies ReadyGateTransitionAction/);
  assert.match(webReadyGateHook, /return applyReadyGateTruth\(\{[\s\S]*ready_gate_status: payload\.status \?\? payload\.ready_gate_status/s);
  assert.match(webReadyGateHook, /return false;[\s\S]*return true;/);
  assert.match(readyGateOverlay, /const runTerminalAction = useCallback\(/);
  assert.match(readyGateOverlay, /const ok = await skip\(\)/);
  assert.match(readyGateOverlay, /if \(!ok\) \{[\s\S]*ready_gate_forfeit_failed/s);
  assert.match(readyGateOverlay, /setTerminalActionError\(message\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("skip_this_one"\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("cancel_go_back"\)/);
  assert.match(readyGateOverlay, /void runTerminalAction\("prepare_failed_back"\)/);
  assert.doesNotMatch(
    readyGateOverlay,
    /closedRef\.current = true;\s*skip\(\);\s*setStatus\("browsing"\);\s*onClose\(\);/,
  );

  assert.match(nativeReadyGateApi, /type ReadyGateTransitionAction = 'mark_ready' \| 'forfeit' \| 'snooze'/);
  assert.match(nativeReadyGateApi, /const runReadyGateTransition = useCallback\(async \(action: ReadyGateTransitionAction\): Promise<boolean> =>/);
  assert.match(nativeReadyGateApi, /const forfeit = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(nativeReadyGateApi, /const \{ error \} = await supabase\.rpc\('ready_gate_transition'/);
  assert.match(nativeReadyGateApi, /return false;[\s\S]*return true;/);
  assert.match(nativeReadyGateOverlay, /const handleSkip = useCallback\(async \(reason: 'timeout' \| 'skip' = 'skip'\) =>/);
  assert.match(nativeReadyGateOverlay, /const ok = await forfeit\(\)/);
  assert.match(nativeReadyGateOverlay, /if \(!ok\) throw new Error\('ready_gate_forfeit_failed'\)/);
  assert.match(nativeReadyGateOverlay, /setTerminalActionError\(message\)/);
  assert.match(nativeReadyGateOverlay, /pendingForfeitReasonRef\.current = reason/);
  assert.doesNotMatch(
    nativeReadyGateOverlay,
    /closedRef\.current = true;\s*void forfeit\(\);\s*void updateParticipantStatus\(eventId, 'browsing'\);\s*onClose\(\);/,
  );
});

test("ready-gate RPC failures surface retryable UI and web expiry syncs server truth", () => {
  assert.match(webReadyGateHook, /const markReady = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(webReadyGateHook, /const snooze = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(webReadyGateHook, /runReadyGateTransition\("mark_ready"\)/);
  assert.match(webReadyGateHook, /runReadyGateTransition\("snooze"\)/);
  assert.match(readyGateOverlay, /const ok = await markReady\(\)/);
  assert.match(readyGateOverlay, /throw new Error\("ready_gate_mark_ready_failed"\)/);
  assert.match(readyGateOverlay, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(readyGateOverlay, /const ok = await snooze\(\)/);
  assert.match(readyGateOverlay, /throw new Error\("ready_gate_snooze_failed"\)/);
  assert.match(readyGateOverlay, /We couldn't snooze this match\. Check your connection and try again\./);
  assert.match(readyGateOverlay, /EXPIRY_SYNC_RETRY_DELAY_MS/);
  assert.match(readyGateOverlay, /source === "initial" \|\| source === "poll"[\s\S]*const syncResult = await syncSession\(\)/);
  assert.match(readyGateOverlay, /void syncSession\(\)[\s\S]*countdown expiry sync deferred after RPC error/s);
  assert.doesNotMatch(readyGateOverlay, /timeout_auto_forfeit|timeoutForfeitSentRef|TIMEOUT_FORFEIT/);
  assert.doesNotMatch(readyGateOverlay, /next <= 0[\s\S]{0,320}skip\(\)/);

  assert.match(nativeReadyGateApi, /const markReady = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(nativeReadyGateApi, /const snooze = useCallback\(async \(\): Promise<boolean> =>/);
  assert.match(nativeReadyGateApi, /runReadyGateTransition\('mark_ready'\)/);
  assert.match(nativeReadyGateApi, /runReadyGateTransition\('snooze'\)/);
  assert.match(nativeReadyGateOverlay, /const ok = await markReady\(\)/);
  assert.match(nativeReadyGateOverlay, /throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyGateOverlay, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(nativeReadyGateOverlay, /const ok = await snooze\(\)/);
  assert.match(nativeReadyGateOverlay, /throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyGateOverlay, /We couldn't snooze this match\. Check your connection and try again\./);
  assert.match(nativeReadyGateOverlay, /TIMEOUT_FORFEIT_RETRY_DELAY_MS/);
  assert.match(nativeReadyGateOverlay, /TIMEOUT_FORFEIT_MAX_AUTO_ATTEMPTS/);
  assert.match(nativeReadyGateOverlay, /void handleSkip\('timeout'\)/);
  assert.match(nativeReadyGateOverlay, /timeoutForfeitSentRef\.current = false[\s\S]*timeoutForfeitRetryAtMsRef\.current = Date\.now\(\) \+ TIMEOUT_FORFEIT_RETRY_DELAY_MS/);
  assert.doesNotMatch(nativeReadyGateOverlay, /timeoutForfeitSentRef\.current = true;\s*void forfeit\(\)/);

  assert.match(nativeReadyRoute, /const runReadyGateForfeit = useCallback\(/);
  assert.match(nativeReadyRoute, /const ok = await forfeit\(\)/);
  assert.match(nativeReadyRoute, /if \(!ok\) throw new Error\('ready_gate_forfeit_failed'\)/);
  assert.match(nativeReadyRoute, /setTerminalActionError\(message\)/);
  assert.match(nativeReadyRoute, /timeoutForfeitSentRef\.current = false[\s\S]*timeoutForfeitRetryAtMsRef\.current = Date\.now\(\) \+ TIMEOUT_FORFEIT_RETRY_DELAY_MS/);
  assert.match(nativeReadyRoute, /void runReadyGateForfeit\('timeout'\)/);
  assert.match(nativeReadyRoute, /primaryAction: \{ label: 'Step away', onPress: \(\) => \{ void runReadyGateForfeit\('skip'\); \} \}/);
  assert.doesNotMatch(nativeReadyRoute, /forfeit\(\);\s*return 0/);
  assert.match(nativeReadyRoute, /const ok = await markReady\(\)/);
  assert.match(nativeReadyRoute, /throw new Error\('ready_gate_mark_ready_failed'\)/);
  assert.match(nativeReadyRoute, /We couldn't mark you ready\. Check your connection and try again\./);
  assert.match(nativeReadyRoute, /const ok = await snooze\(\)/);
  assert.match(nativeReadyRoute, /throw new Error\('ready_gate_snooze_failed'\)/);
  assert.match(nativeReadyRoute, /We couldn't snooze this match\. Check your connection and try again\./);
});

test("daily-room classifies Daily provider failures without leaking raw response bodies", () => {
  assert.match(dailyRoomFunction, /status === 401 \|\| status === 403[\s\S]*DAILY_AUTH_FAILED/s);
  assert.match(dailyRoomFunction, /status === 429[\s\S]*DAILY_RATE_LIMIT/s);
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
  assert.match(videoDateRoomCleanupFunction, /const ok = await deleteDailyRoom\(name\);[\s\S]*markRoomCleaned\(supabase, row\.id, name, endedAt\)/s);
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

test("queue_status reaches in_handshake only after provider confirm succeeds", () => {
  assert.match(providerAtomicEntryMigration, /'registration_status', 'deferred_until_confirm_prepare_entry'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_preflight_ok[\s\S]{0,1200}queue_status = 'in_handshake'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_preflight_ok[\s\S]{0,1200}queue_status = v_queue_status/);
  assert.match(
    providerAtomicEntryMigration,
    /v_queue_status := CASE[\s\S]*ELSE 'in_handshake'[\s\S]*UPDATE public\.event_registrations[\s\S]*queue_status = v_queue_status/s,
  );
  assert.match(dailyRoomFunction, /const token = await createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\);[\s\S]*confirmVideoDateEntryPrepared\(serviceClient/s);
  assert.match(dailyRoomFunction, /confirmPayload\?\.code \?\? \(confirmError \? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN"\)/);
  const tokenCreate = dailyRoomFunction.indexOf(
    "const token = await createMeetingToken(roomName, user.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS);",
  );
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

test("daily-room hard-fails room and registration persistence before returning tokens", () => {
  assert.match(dailyRoomFunction, /persistVideoDateRoomMetadata\(params\.serviceClient/);
  assert.match(dailyRoomFunction, /code: "DB_ROOM_PERSIST_FAILED"/);
  assert.match(dailyRoomFunction, /video_date_room_metadata_persist_failed/);
  assert.match(
    dailyRoomFunction,
    /ensureVideoDateProviderRoomForToken[\s\S]*const token = await createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\);[\s\S]*confirmVideoDateEntryPrepared\(serviceClient/s,
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
  assert.match(sharedActiveSession, /function videoSessionHasRecoverablePostDateSurveyTruth/);
  assert.match(sharedActiveSession, /function getVideoSessionPartnerIdForUser/);
  assert.match(sharedActiveSession, /function pickRecoverablePendingPostDateSurveySession/);
  assert.match(sharedActiveSession, /feedbackSessionIdsForUser\.has\(row\.id\)/);

  for (const source of [webActiveSessionHook, nativeActiveSessionHook]) {
    assert.match(source, /findPendingPostDateSurveySession/);
    assert.match(source, /\.not\(["']ended_at["'], ["']is["'], null\)/);
    assert.match(source, /\.not\(["']date_started_at["'], ["']is["'], null\)/);
    assert.match(source, /videoSessionHasRecoverablePostDateSurveyTruth/);
    assert.match(source, /pickRecoverablePendingPostDateSurveySession/);
    assert.match(source, /\.from\(["']date_feedback["']\)[\s\S]*\.select\(["']session_id["']\)[\s\S]*\.eq\(["']user_id["'], userId\)[\s\S]*\.in\(["']session_id["'], candidateSessionIds\)/);
    assert.match(source, /queueStatus: ["']in_survey["']/);
  }
});

test("native date route opens recovered pending surveys after current_room_id is cleared", () => {
  assert.match(nativeVideoDateRoute, /function shouldRecoverPendingPostDateSurvey/);
  assert.match(nativeVideoDateRoute, /getVideoSessionPartnerIdForUser/);
  assert.match(nativeVideoDateRoute, /videoSessionHasRecoverablePostDateSurveyTruth/);
  assert.match(nativeVideoDateRoute, /\.eq\('event_id', vs\.event_id as string\)/);
  assert.match(nativeVideoDateRoute, /\.eq\('event_id', regEventId\)/);
  assert.match(nativeVideoDateRoute, /pendingPostDateSurveyDue/);
  assert.match(nativeVideoDateRoute, /if \(pendingPostDateSurveyDue\) \{/);
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
  assert.match(nativeVideoDateRoute, /if \(truthDecision === 'ended'\) \{[\s\S]*setDateEntryPermissionEligible\(false\);[\s\S]*pendingPostDateSurveyDue[\s\S]*setShowFeedback\(true\);/);
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
  assert.match(dailyRoomFunction, /const token = await createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\);[\s\S]*confirmVideoDateEntryPrepared/s);
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
  assert.match(webVideoCallHook, /We're reconnecting your date state/);
  assert.match(webVideoCallHook, /mark_video_date_daily_joined_retry_after_failure/);
  assert.match(nativeVideoDateApi, /action: 'video_date_leave'/);
  assert.match(nativeVideoDateRoute, /signalVideoDateLeave\(sessionId, 'app_background'\)/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_GRACE_STARTED/);
  assert.match(nativeVideoDateRoute, /VIDEO_DATE_NATIVE_BACKGROUND_LEAVE_SIGNAL_FAILED/);
  assert.match(nativeVideoDateRoute, /app_background_timeout/);
  assert.match(nativeVideoDateRoute, /We're reconnecting your date state/);
  assert.match(nativeVideoDateRoute, /markVideoDateDailyJoined\(sessionId\)\.then\(\(retryOk\)/);
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
    /let terminalConfirmed = false;[\s\S]*terminalConfirmed = await endVideoDate\(sessionId\);[\s\S]*terminalConfirmed = await fetchServerTerminalTruth\(\);[\s\S]*if \(!terminalConfirmed\) \{[\s\S]*setShowFeedback\(false\)[\s\S]*Alert\.alert\('Could not end date yet'[\s\S]*return;[\s\S]*logJourney\('survey_opened', \{ source: 'local_end_confirmed' \}/s,
  );
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
  assert.match(webReconnectionOverlay, /Trying to reconnect/);
  assert.match(webReconnectionOverlay, /Your match disconnected\. We'll keep the room open for a few seconds\./);
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

test("notification date deep links require provider-prepared truth before routing to date", () => {
  assert.match(notificationDeepLinkHandler, /markVideoDateEntryPipelineStarted/);
  assert.match(
    notificationDeepLinkHandler,
    /if \(canAttemptDaily \|\| truthDecision === 'navigate_date'\) \{[\s\S]*markVideoDateEntryPipelineStarted\(sid\)[\s\S]*return videoDateHref\(sid\);/s,
  );
  assert.match(notificationDeepLinkHandler, /if \(!vs\) return tabsRootHref\(\);/);
  assert.match(notificationDeepLinkHandler, /if \(!isParticipant\) return tabsRootHref\(\);/);
  assert.match(notificationDeepLinkHandler, /unknown_video_truth_decision/);
});

test("active-session resolvers emit canonical stale-session analytics for stale registration pointers", () => {
  for (const source of [webActiveSessionHook, nativeActiveSessionHook]) {
    assert.match(source, /STALE_ACTIVE_SESSION_DETECTED/);
    assert.match(source, /staleActiveSessionEventKeyRef/);
    assert.match(source, /registration_points_to_missing_session|registration_session_query_failed/);
    assert.match(source, /registration_points_to_ended_session/);
    assert.match(source, /different_event_registration_room/);
  }
});

test("duplicate active-session conflicts use the canonical audit event on web and native", () => {
  assert.match(webSwipeActionHook, /DUPLICATE_ACTIVE_SESSION_CONFLICT/);
  assert.match(webSwipeActionHook, /outcome === "participant_has_active_session_conflict"/);
  assert.match(nativeEventLobby, /DUPLICATE_ACTIVE_SESSION_CONFLICT/);
  assert.match(nativeEventLobby, /outcome === 'participant_has_active_session_conflict'/);
});

test("video-date Daily room and token TTL use explicit finite constants separate from match calls", () => {
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = 14_400/);
  assert.match(dailyRoomFunction, /DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400/);
  assert.match(dailyRoomFunction, /DAILY_MATCH_CALL_TOKEN_TTL_SECONDS = 7_200/);
  assert.match(dailyRoomFunction, /createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\)/);
  assert.match(dailyRoomFunction, /createMeetingToken\(\s*roomProof\.roomName,\s*user\.id,\s*DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS/s);
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
  assert.match(webVideoDatePage, /handleLeave\(\{ reason: "partial_join_peer_timeout" \}\)/);
  assert.match(nativeVideoDateRoute, /endVideoDate\(sessionId, 'partial_join_peer_timeout'\)/);
});

test("web and native expose clear peer-missing choices instead of toast-only timeout copy", () => {
  assert.match(webVideoCallHook, /setPeerMissing\(\{ terminal: true \}\)/);
  assert.match(webConnectionOverlay, /They didn't make it in time\./);
  assert.match(webConnectionOverlay, /We couldn't connect them in time/);
  assert.match(webConnectionOverlay, /Keep waiting/);
  assert.match(webConnectionOverlay, /Try reconnecting/);
  assert.match(webVideoCallHook, /noRemoteAutoRecoveryCountRef\.current < 2/);
  assert.match(webVideoCallHook, /cleanupCallObject\("startCall", "no_remote_auto_recovery"\)/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_WAIT_STARTED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT/);
  assert.match(webVideoCallHook, /VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_RETRY_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_NO_REMOTE_USER_EXIT/);
  assert.match(nativeVideoDateRoute, /They didn't make it in time\./);
  assert.match(nativeVideoDateRoute, /We couldn't connect them in time/);
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
  assert.match(webVideoDatePage, /Camera and microphone access are needed for your video date/);
  assert.match(webVideoDatePage, /VIDEO_DATE_MEDIA_PERMISSION_RETRY/);
  assert.match(webVideoDatePage, /clearMediaPermissionError\(\)/);
  assert.match(webConnectionOverlay, /Tap to resume video\/audio/);
  assert.match(webConnectionOverlay, /browser paused the video or audio/);
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
  assert.match(adminDashboardPage, /<AdminVideoDateTimelinePanel \/>/);
  assert.match(adminVideoDateTimelinePanel, /functions\.invoke<AdminVideoDateTimelineResponse>\(\s*"admin-video-date-ops"/);
  assert.match(adminVideoDateTimelinePanel, /action: "get_session_timeline"/);
  assert.match(adminVideoDateTimelinePanel, /redactVideoDateTimelineDetail/);
  assert.match(adminVideoDateTimelinePanel, /extractVideoDateTimelineTraceIds/);
  assert.doesNotMatch(adminVideoDateTimelinePanel, /rpc\(["']get_video_date_session_timeline/);
});

test("admin-video-date-ops gates service-role timeline access behind role and session validation", () => {
  assert.match(adminVideoDateOpsFunction, /action === "get_session_timeline"/);
  assert.match(adminVideoDateOpsFunction, /isValidUuid\(sessionId\)/);
  assert.match(adminVideoDateOpsFunction, /typedErrorResponse\("invalid_session_id"/);
  assert.match(adminVideoDateOpsFunction, /hasVideoDateTimelineRole\(roleRows\)/);
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
