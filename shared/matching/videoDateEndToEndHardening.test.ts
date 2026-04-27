import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const halfVerdictTimeoutCronMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501104000_schedule_post_date_half_verdict_timeout_cron.sql"),
  "utf8",
);
const expireStaleBoundingDeferralDoc = readFileSync(
  join(process.cwd(), "docs/video-date-expire-stale-bounding-deferral.md"),
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
const nativeActiveSessionHook = readFileSync(
  join(process.cwd(), "apps/mobile/lib/useActiveSession.ts"),
  "utf8",
);
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
const webConnectionOverlay = readFileSync(
  join(process.cwd(), "src/components/video-date/ConnectionOverlay.tsx"),
  "utf8",
);
const nativeEventLobby = readFileSync(
  join(process.cwd(), "apps/mobile/app/event/[eventId]/lobby.tsx"),
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
const notificationDeepLinkHandler = readFileSync(
  join(process.cwd(), "apps/mobile/components/NotificationDeepLinkHandler.tsx"),
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
  assert.match(dailyRoomFunction, /const roomName = `date-\$\{sessionId\.replace\(\s*\/-\/g, ""\)\}`/);
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
  assert.match(dailyRoomFunction, /if \(action === "delete_room"\)[\s\S]*roomType === "video_date"[\s\S]*VIDEO_DATE_CLEANUP_OWNED_BY_CRON/s);
});

test("daily-room prepare_date_entry verifies or recreates unsafe provider room state before token issuance", () => {
  assert.match(
    dailyRoomFunction,
    /if \(existingRoomName !== roomName \|\| existingRoomUrl !== roomUrl\) \{[\s\S]*getDailyRoomProviderState\(roomName\)[\s\S]*createDailyRoom\(roomName, videoDateRoomProperties\(\)\)[\s\S]*persistVideoDateRoomMetadata\(serviceClient/s,
  );
  assert.match(
    dailyRoomFunction,
    /else if \(shouldSkipDailyProviderVerifyForVideoDate\(sessionForLog\)\)[\s\S]*providerVerifySkipped = true/s,
  );
  assert.match(
    dailyRoomFunction,
    /else \{[\s\S]*getDailyRoomProviderState\(roomName\)[\s\S]*!providerRoomState\.exists \|\| providerRoomState\.expired[\s\S]*providerRoomRecreated = true/s,
  );
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

test("video-date room cleanup checks Daily presence before destructive delete", () => {
  assert.match(videoDateRoomCleanupFunction, /\/rooms\/\$\{encodeURIComponent\(roomName\)\}\/presence/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_deferred_active_participants/);
  assert.match(videoDateRoomCleanupFunction, /cleanup_deferred_provider_check_failed/);
  assert.match(videoDateRoomCleanupFunction, /if \(presence\.ok && presence\.activeCount > 0\)[\s\S]*continue;/s);
  assert.match(videoDateRoomCleanupFunction, /if \(!presence\.ok\)[\s\S]*cleanup_deferred_provider_check_failed[\s\S]*continue;/s);
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

test("provider-atomic entry keeps prepare_entry non-routeable until Daily proof is confirmed", () => {
  assert.match(providerAtomicEntryMigration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260501110000_provider_atomic_base/s);
  assert.match(providerAtomicEntryMigration, /IF p_action IS DISTINCT FROM 'prepare_entry' THEN[\s\S]*video_date_transition_20260501110000_provider_atomic_base/s);
  assert.match(providerAtomicEntryMigration, /'preflight_only', true/);
  assert.match(providerAtomicEntryMigration, /'registration_status', 'deferred_until_confirm_prepare_entry'/);
  assert.doesNotMatch(providerAtomicEntryMigration, /queue_status = v_registration_status/);
  assert.doesNotMatch(providerAtomicEntryMigration, /prepare_entry_entered/);
  assert.doesNotMatch(providerAtomicEntryMigration, /state = CASE[\s\S]*'handshake'::public\.video_date_state[\s\S]*WHERE id = p_session_id[\s\S]*p_action/s);
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
  assert.match(dailyRoomFunction, /persistVideoDateRoomMetadata\(serviceClient/);
  assert.match(dailyRoomFunction, /code: "DB_ROOM_PERSIST_FAILED"/);
  assert.match(dailyRoomFunction, /video_date_room_metadata_persist_failed/);
  assert.match(dailyRoomFunction, /const token = await createMeetingToken\(roomName, user\.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS\);[\s\S]*confirmVideoDateEntryPrepared\(serviceClient/s);
  assert.match(dailyRoomFunction, /confirmPayload\?\.code \?\? \(confirmError \? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN"\)/);
  assert.doesNotMatch(dailyRoomFunction, /markVideoDateEntryPrepared\(serviceClient/);
  assert.doesNotMatch(dailyRoomFunction, /Registration status update after token success failed/);
});

test("entry_attempt_id is generated client-side and carried through Edge logs and responses", () => {
  assert.match(webPrepareEntry, /createVideoDateEntryAttemptId\(startedAt\)/);
  assert.match(nativePrepareEntry, /createVideoDateEntryAttemptId\(startedAt\)/);
  assert.match(webPrepareEntry, /body: \{ action: PREPARE_VIDEO_DATE_ENTRY_ACTION, sessionId, entry_attempt_id: attemptId \}/);
  assert.match(nativePrepareEntry, /body: \{ action: PREPARE_VIDEO_DATE_ENTRY_ACTION, sessionId, entry_attempt_id: attemptId \}/);
  assert.match(dailyRoomFunction, /sanitizeEntryAttemptId\(body\?\.entry_attempt_id \?\? body\?\.entryAttemptId\)/);
  assert.match(dailyRoomFunction, /entry_attempt_id: entryAttemptId/);
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
  assert.match(
    webVideoDatePage,
    /source === "visibilitychange"[\s\S]*p_action: "mark_reconnect_return"[\s\S]*p_action: "sync_reconnect"/,
  );
  assert.match(webVideoDatePage, /setTimeout\(\(\) => sendLeaveSignal\("visibilitychange"\), 1200\)/);
  assert.match(webVideoCallHook, /CAMERA_PERMISSION_DENIED/);
  assert.match(webVideoCallHook, /VIDEO_DATE_REMOTE_PLAYBACK_REQUIRES_GESTURE/);
  assert.match(webVideoCallHook, /noRemoteAutoRecoveryCountRef\.current < 2/);
  assert.match(webVideoCallHook, /We're reconnecting your date state/);
  assert.match(webVideoCallHook, /mark_video_date_daily_joined_retry_after_failure/);
  assert.match(nativeVideoDateRoute, /markReconnectSelfAway\(sessionId, 'app_background'\)/);
  assert.match(nativeVideoDateRoute, /app_background_timeout/);
  assert.match(nativeVideoDateRoute, /We're reconnecting your date state/);
  assert.match(nativeVideoDateRoute, /markVideoDateDailyJoined\(sessionId\)\.then\(\(retryOk\)/);
});

test("post-date survey retries verdicts and exposes half-verdict pending state on both clients", () => {
  assert.match(remainingHardeningMigration, /awaiting_partner_verdict/);
  assert.match(remainingHardeningMigration, /post_date_half_verdict_pending/);
  assert.match(remainingHardeningMigration, /detect_post_date_half_verdict_timeouts/);
  assert.match(webPostDateSurvey, /POST_DATE_VERDICT_SUBMIT_RETRY/);
  assert.match(webPostDateSurvey, /POST_DATE_VERDICT_SUBMIT_FAILED/);
  assert.match(webPostDateSurvey, /Awaiting your match&apos;s verdict/);
  assert.match(nativePostDateSurvey, /POST_DATE_VERDICT_SUBMIT_RETRY/);
  assert.match(nativePostDateSurvey, /POST_DATE_VERDICT_SUBMIT_FAILED/);
  assert.match(nativePostDateSurvey, /Awaiting your match&apos;s verdict/);
});

test("notification date deep links mark the date-entry latch before routing to date", () => {
  assert.match(notificationDeepLinkHandler, /markVideoDateEntryPipelineStarted/);
  assert.match(
    notificationDeepLinkHandler,
    /if \(canAttemptDaily \|\| truthDecision === 'navigate_date'\) \{[\s\S]*markVideoDateEntryPipelineStarted\(sid\)[\s\S]*return videoDateHref\(sid\);/s,
  );
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
  assert.match(dailyRoomFunction, /createMeetingToken\(\s*session\.daily_room_name,\s*user\.id,\s*DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS/s);
  assert.match(dailyRoomFunction, /exp: Math\.floor\(Date\.now\(\) \/ 1000\) \+ DAILY_VIDEO_DATE_ROOM_TTL_SECONDS/);
});

test("prepare-entry documents its deterministic provider-idempotent concurrency contract", () => {
  assert.match(dailyRoomFunction, /Provider-idempotent prepare-entry contract/);
  assert.match(dailyRoomFunction, /deterministic room name/);
  assert.match(dailyRoomFunction, /already exists/);
  assert.match(dailyRoomFunction, /same-value DB writes/);
});

test("historical expire-stale bounding remains explicitly tracked instead of falsely closed", () => {
  assert.match(remainingHardeningMigration, /Historical expire_stale_video_sessions body remains delegated\/unbounded/);
  assert.match(expireStaleBoundingDeferralDoc, /tracked operational risk, not a closed item/);
  assert.match(expireStaleBoundingDeferralDoc, /DB-executed migration rehearsal/);
  assert.match(expireStaleBoundingDeferralDoc, /FOR UPDATE SKIP LOCKED/);
});

test("web and native expose clear peer-missing choices instead of toast-only timeout copy", () => {
  assert.match(webVideoCallHook, /setPeerMissing\(\{ terminal: true \}\)/);
  assert.match(webConnectionOverlay, /Your match hasn&apos;t joined yet|Your match hasn't joined yet/);
  assert.match(webConnectionOverlay, /Keep waiting/);
  assert.match(webConnectionOverlay, /Try reconnecting/);
  assert.match(webConnectionOverlay, /head back to the lobby/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_RETRY_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP/);
  assert.match(nativeVideoDateRoute, /Your match has not joined yet/);
  assert.match(nativeVideoDateRoute, /Try reconnecting/);
  assert.match(nativeVideoDateRoute, /Keep waiting/);
  assert.match(nativeVideoDateRoute, /Back to lobby/);
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
  assert.match(nativeVideoDateRoute, /markReconnectSelfAway\(sessionId, 'app_background'\)/);
  assert.match(nativeVideoDateRoute, /markReconnectReturn\(sessionId\)/);
  assert.match(nativeVideoDateRoute, /app_background_timeout/);
  assert.match(nativeVideoDateRoute, /setTimeout\(\(\) => \{[\s\S]*endVideoDate\(sessionId, 'app_background_timeout'\)[\s\S]*\}, 30_000\)/);
});

test("half-verdict timeout detector is scheduled through optional pg_cron", () => {
  assert.match(halfVerdictTimeoutCronMigration, /post-date-half-verdict-timeout-detection/);
  assert.match(halfVerdictTimeoutCronMigration, /cron\.schedule/);
  assert.match(halfVerdictTimeoutCronMigration, /detect_post_date_half_verdict_timeouts\(interval ''24 hours'', 100\)/);
});
