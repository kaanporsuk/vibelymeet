import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSpendVideoDateCreditExtensionPayload,
  remainingDatePhaseSeconds,
} from "./videoDateExtensionSpend";
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
const swipePresenceMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260501092000_handle_swipe_presence_and_already_matched_session.sql"),
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

test("swipe presence migration keeps already-matched clients routable", () => {
  assert.match(swipePresenceMigration, /handle_swipe_mutual_pair/);
  assert.match(swipePresenceMigration, /last_lobby_foregrounded_at = v_now/);
  assert.match(swipePresenceMigration, /SELECT id, ready_gate_status[\s\S]*ORDER BY started_at DESC/s);
  assert.match(swipePresenceMigration, /'result', 'already_matched'[\s\S]*'video_session_id', v_session_id/s);
  assert.match(swipePresenceMigration, /queue_status = 'in_ready_gate'/);
});

test("swipe presence migration serializes pair before mutual visibility check", () => {
  const pairLockIndex = swipePresenceMigration.indexOf("handle_swipe_mutual_pair:");
  const recordSwipeIndex = swipePresenceMigration.indexOf(
    "INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)\n  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)",
  );
  const mutualCheckIndex = swipePresenceMigration.indexOf("SELECT EXISTS (", recordSwipeIndex);
  assert.ok(pairLockIndex >= 0, "pair lock is present");
  assert.ok(recordSwipeIndex >= 0, "non-pass swipe insert is present");
  assert.ok(mutualCheckIndex >= 0, "mutual check is present");
  assert.ok(pairLockIndex < recordSwipeIndex, "pair lock must be taken before recording the swipe");
  assert.ok(recordSwipeIndex < mutualCheckIndex, "swipe must be recorded before checking mutuality");
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
