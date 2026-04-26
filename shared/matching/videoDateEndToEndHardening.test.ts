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
const webVideoCallHook = readFileSync(
  join(process.cwd(), "src/hooks/useVideoCall.ts"),
  "utf8",
);
const nativeVideoDateRoute = readFileSync(
  join(process.cwd(), "apps/mobile/app/date/[id].tsx"),
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
  assert.match(dailyRoomFunction, /createMeetingToken\(roomName, user\.id, 7200\)/);
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
    /if \(existingRoomName !== roomName \|\| existingRoomUrl !== roomUrl\) \{[\s\S]*getDailyRoomProviderState\(roomName\)[\s\S]*createDailyRoom\(roomName, videoDateRoomProperties\(\)\)[\s\S]*daily_room_name: roomName, daily_room_url: roomUrl/s,
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

test("web and native reject cached prewarmed token after Daily join failure and retry prepare", () => {
  assert.match(webVideoCallHook, /rejectPreparedVideoDateEntry\(sessionId, userId, "daily_join_failed", eventId\)/);
  assert.match(webVideoCallHook, /return startCall\(sessionId, \{ internalRetry: true \}\)/);
  assert.match(nativeVideoDateRoute, /rejectPreparedVideoDateEntry\(sessionId, user\.id, 'daily_join_failed', eventId \|\| null\)/);
  assert.match(nativeVideoDateRoute, /setJoinAttemptNonce\(\(n\) => n \+ 1\)/);
});
