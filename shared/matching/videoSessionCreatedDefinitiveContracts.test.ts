import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeSessionDirectFallbackStaleReason,
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  isActiveSessionDirectFallbackFresh,
} from "./activeSession";
import {
  decideCanonicalVideoDateRoute,
  type VideoDateRouteSessionTruth,
} from "./videoDateRouteDecision";

const root = process.cwd();
const NOW_MS = Date.parse("2026-06-07T12:00:00.000Z");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const activeSession = read("shared/matching/activeSession.ts");
const webActiveSession = read("src/hooks/useActiveSession.ts");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");
const generatedTypes = read("src/integrations/supabase/types.ts");
const mutualMatchHandoff = read("supabase/migrations/20260607103000_video_date_mutual_match_handoff_closure.sql");
const finalContractsMigration = read("supabase/migrations/20260607152000_video_session_created_definitive_contracts.sql");
const mysteryMatchRemoval = read("supabase/migrations/20260609152000_remove_mystery_match.sql");
const sessionSourceRemoval = read("supabase/migrations/20260609171950_remove_video_sessions_session_source.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");

function session(
  overrides: Partial<VideoDateRouteSessionTruth> = {},
): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    ended_at: null,
    state: "ready_gate",
    phase: "ready_gate",
    ready_gate_status: "ready",
    ready_gate_expires_at: "2026-06-07T12:00:30.000Z",
    daily_room_name: null,
    daily_room_url: null,
    ...overrides,
  };
}

test("both_ready provider-pending truth is fresh date owner for active-session recovery", () => {
  const row = session({
    ready_gate_status: "both_ready",
    ready_gate_expires_at: "2026-06-07T11:59:00.000Z",
    state: "ready_gate",
    phase: "ready_gate",
    daily_room_name: null,
    daily_room_url: null,
    handshake_started_at: null,
    date_started_at: null,
  });

  assert.equal(decideVideoSessionRouteFromTruth(row, NOW_MS), "navigate_date");
  assert.equal(canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS), false);
  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);
  assert.equal(activeSessionDirectFallbackStaleReason(row, NOW_MS), null);
  assert.match(activeSession, /videoSessionRowIsBothReadyDateOwner/);
});

test("queued session with current_room_id remains lobby/syncing, not Ready Gate or Date", () => {
  const queued = session({
    ready_gate_status: "queued",
    ready_gate_expires_at: "2026-06-07T12:05:00.000Z",
  });

  for (const action of [undefined, "ready_gate", "video_date"] as const) {
    const decision = decideCanonicalVideoDateRoute({
      sessionId: SESSION_ID,
      eventId: EVENT_ID,
      truth: queued,
      registration: {
        event_id: EVENT_ID,
        current_room_id: SESSION_ID,
        queue_status: "in_ready_gate",
      },
      serverNextSurface: action
        ? { action, eventId: EVENT_ID, nextSessionId: SESSION_ID }
        : null,
      nowMs: NOW_MS,
    });
    assert.equal(decision.target, "lobby", action ?? "no server action");
  }

  assert.equal(decideVideoSessionRouteFromTruth(queued, NOW_MS), "stay_lobby");
  assert.equal(isActiveSessionDirectFallbackFresh(queued, NOW_MS), false);
  assert.match(webActiveSession, /\.in\("queue_status", \["in_handshake", "in_date", "in_survey", "in_ready_gate"\]\)/);
  assert.match(nativeActiveSession, /\.in\('queue_status', \['in_handshake', 'in_date', 'in_survey', 'in_ready_gate'\]\)/);
  assert.doesNotMatch(nativeActiveSession, /kind: 'syncing'/);
});

test("Mystery Match payload compatibility is superseded by hard removal", () => {
  assert.match(mysteryMatchRemoval, /DROP FUNCTION IF EXISTS public\.find_mystery_match\(uuid, uuid\)/);
  assert.match(mysteryMatchRemoval, /session_source = 'mystery_match'/);
  assert.match(mysteryMatchRemoval, /session_source = 'reciprocal_swipe'/);
  assert.match(mysteryMatchRemoval, /video_sessions_session_source_rec_swipe_only/);
  assert.match(sessionSourceRemoval, /DROP COLUMN IF EXISTS session_source/);
  assert.doesNotMatch(generatedTypes, /find_mystery_match/);
});

test("generated Supabase video_sessions table contract omits removed session_source", () => {
  const videoSessionsStart = generatedTypes.indexOf("      video_sessions: {");
  const relationshipsStart = generatedTypes.indexOf("        Relationships:", videoSessionsStart);
  assert.ok(videoSessionsStart >= 0 && relationshipsStart > videoSessionsStart);
  const videoSessionsBlock = generatedTypes.slice(videoSessionsStart, relationshipsStart);

  assert.doesNotMatch(videoSessionsBlock, /session_source/);
});

test("service-only drift validation and dry-run repair cover queued and Ready Gate session linkage", () => {
  assert.match(finalContractsMigration, /CREATE OR REPLACE FUNCTION public\.validate_video_date_registration_session_drift_v1/);
  assert.match(finalContractsMigration, /CREATE OR REPLACE FUNCTION public\.repair_video_date_registration_session_drift_v1/);
  assert.match(finalContractsMigration, /p_dry_run boolean DEFAULT true/);
  assert.match(finalContractsMigration, /ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(finalContractsMigration, /participant_1_current_room_mismatch/);
  assert.match(finalContractsMigration, /participant_2_partner_mismatch/);
  assert.match(finalContractsMigration, /WHEN v_row\.ready_gate_status = 'queued' THEN er\.queue_status/);
  assert.match(finalContractsMigration, /GRANT EXECUTE ON FUNCTION public\.validate_video_date_registration_session_drift_v1\(uuid, integer\)[\s\S]*TO service_role/);
  assert.match(finalContractsMigration, /GRANT EXECUTE ON FUNCTION public\.repair_video_date_registration_session_drift_v1\(uuid, integer, boolean\)[\s\S]*TO service_role/);
  assert.doesNotMatch(finalContractsMigration, /GRANT EXECUTE ON FUNCTION public\.repair_video_date_registration_session_drift_v1\(uuid, integer, boolean\)[\s\S]*TO authenticated/);
});

test("Daily/provider/notification side effects stay fail-soft after decisive session creation", () => {
  assert.match(mutualMatchHandoff, /EXCEPTION\s+WHEN OTHERS THEN[\s\S]*'error', 'outbox_enqueue_failed'/);
  assert.match(mutualMatchHandoff, /Auxiliary provider\/notification enqueue failures return structured JSON and must not poison decisive session commits/);
  assert.match(swipeActions, /result\.result === "match" && sessionId[\s\S]*catch \(e\)[\s\S]*notification_suppressed_reason: "notify_error"/);
  assert.doesNotMatch(swipeActions, /result\.result === "match_queued" && sessionId/);
  assert.match(swipeActions, /return new Response\(\s*JSON\.stringify\(\{ success: true, \.\.\.result \}\)/);
});

test("both_ready entry protection is routeable while provider verification is pending", () => {
  assert.match(finalContractsMigration, /routeable_for_date_owner', true/);
  assert.match(finalContractsMigration, /provider_ready', v_after\.daily_room_verified_at IS NOT NULL/);
  assert.match(finalContractsMigration, /daily_metadata_authoritative_before_both_ready', false/);
  assert.doesNotMatch(finalContractsMigration, /'routeable', false/);
});
