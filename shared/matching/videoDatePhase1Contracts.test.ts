import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeVideoDateSnapshot } from "./videoDateSnapshot";

const root = process.cwd();
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const phase1Migration = readFileSync(
  join(root, "supabase/migrations/20260521172000_video_date_phase1_client_wiring.sql"),
  "utf8",
);
const snapshotFunction = readFileSync(
  join(root, "supabase/functions/video-date-snapshot/index.ts"),
  "utf8",
);
const dailyRoomIndex = readFileSync(join(root, "supabase/functions/daily-room/index.ts"), "utf8");
const dailyRoomContracts = readFileSync(join(root, "supabase/functions/daily-room/dailyRoomContracts.ts"), "utf8");
const webDeckHook = readFileSync(join(root, "src/hooks/useEventDeck.ts"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const webStatusHook = readFileSync(join(root, "src/hooks/useEventStatus.ts"), "utf8");
const nativeStatusHook = readFileSync(join(root, "apps/mobile/lib/eventStatus.ts"), "utf8");
const webReadinessHook = readFileSync(join(root, "src/hooks/useVideoDateReadiness.ts"), "utf8");
const webReadinessLib = readFileSync(join(root, "src/lib/videoDateReadiness.ts"), "utf8");
const nativeReadiness = readFileSync(join(root, "apps/mobile/lib/videoDateReadiness.ts"), "utf8");
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const webActiveSession = readFileSync(join(root, "src/hooks/useActiveSession.ts"), "utf8");
const nativeActiveSession = readFileSync(join(root, "apps/mobile/lib/useActiveSession.ts"), "utf8");
const webSurvey = readFileSync(join(root, "src/components/video-date/PostDateSurvey.tsx"), "utf8");
const nativeSurvey = readFileSync(join(root, "apps/mobile/components/video-date/PostDateSurvey.tsx"), "utf8");

test("PR 1.1 snapshot wrapper keeps tokens in Edge only", () => {
  assert.match(config, /\[functions\.video-date-snapshot\]\s+verify_jwt = true/);
  assert.match(snapshotFunction, /get_video_date_snapshot_core/);
  assert.match(snapshotFunction, /DAILY_API_KEY/);
  assert.match(snapshotFunction, /\/meeting-tokens/);
  assert.match(snapshotFunction, /ejectAtTokenExp: true/);
  assert.match(snapshotFunction, /tokenExpiresAt/);
  assert.match(snapshotFunction, /"Cache-Control": "no-store"/);
  assert.match(snapshotFunction, /UUID_PATTERN/);
  assert.match(snapshotFunction, /invalid_session_id/);
  assert.match(snapshotFunction, /phase !== "handshake" && phase !== "date"/);
  assert.doesNotMatch(snapshotFunction, /\.from\(/);
  assert.doesNotMatch(snapshotFunction, /outbox/i);
  assert.doesNotMatch(phase1Migration, /token/i);
});

test("PR 1.2 dedicated diagnostics and runtime readiness are wired for web and native", () => {
  assert.match(dailyRoomContracts, /prepare_diagnostic_entry/);
  assert.match(dailyRoomContracts, /videoDateDiagnosticRoomNameForUser/);
  assert.match(dailyRoomIndex, /ACTION: prepare_diagnostic_entry/);
  assert.match(dailyRoomIndex, /max_participants: 1/);
  assert.match(dailyRoomIndex, /DAILY_VIDEO_DATE_DIAGNOSTIC_TOKEN_TTL_SECONDS[\s\S]+ejectAtTokenExp: true/);
  assert.match(dailyRoomIndex, /providerRoomExpiringSoon/);
  assert.match(dailyRoomIndex, /"Cache-Control": "no-store"/);
  assert.match(webStatusHook, /recordVideoDateHeartbeatV2/);
  assert.match(nativeStatusHook, /recordVideoDateHeartbeatV2/);
  assert.match(webReadinessHook, /recordVideoDateReadinessCheckV2/);
  assert.match(webReadinessHook, /permissionsGranted[\s\S]+hasCameraDevice === false/);
  assert.match(webReadinessHook, /diagnosticRoomPathDefined: true/);
  assert.match(webReadinessLib, /diagnostic_entry_invalid_response/);
  assert.match(nativeReadiness, /record_readiness_check_v2/);
  assert.match(nativeReadiness, /diagnosticRoomPathDefined: true/);
  assert.match(nativeReadiness, /diagnostic_entry_invalid_response/);
  assert.match(webLobby, /canAttemptPairing: !readinessV2\.enabled \|\| videoDateReadiness\.canAttemptPairing/);
  assert.match(nativeLobby, /swipeType !== 'pass' && readinessV2\.enabled && !videoDateReadiness\.canAttemptPairing/);
});

test("PR 1.3 deck v2 and persistent ready-gate suppression are adopted behind flags", () => {
  assert.match(webDeckHook, /video_date\.deck_deal_v2/);
  assert.match(webDeckHook, /get_event_deck_v2/);
  assert.match(nativeEventsApi, /video_date\.deck_deal_v2/);
  assert.match(nativeEventsApi, /get_event_deck_v2/);
  assert.match(phase1Migration, /CREATE OR REPLACE FUNCTION public\.persist_ready_gate_suppression_v2/);
  assert.match(phase1Migration, /ADD COLUMN IF NOT EXISTS ready_gate_suppressed_session_id uuid/);
  assert.match(phase1Migration, /FOR UPDATE/);
  assert.match(phase1Migration, /WHEN ready_gate_suppressed_session_id = p_session_id THEN GREATEST/);
  assert.match(phase1Migration, /ready_gate_suppressed_session_id = p_session_id/);
  assert.match(phase1Migration, /error', 'not_ready_gate'/);
  assert.match(phase1Migration, /current_room_id = p_session_id AND queue_status = 'in_ready_gate'/);
  assert.match(phase1Migration, /participant_1_id[\s\S]+participant_2_id/);
  assert.match(phase1Migration, /ready_gate_suppressed_until/);
  assert.match(webLobby, /persistReadyGateSuppressionV2/);
  assert.match(nativeLobby, /persistReadyGateSuppressionV2/);
  assert.match(webActiveSession, /ready_gate_suppressed_until/);
  assert.match(webActiveSession, /ready_gate_suppressed_session_id/);
  assert.match(webActiveSession, /if \(error\) return false/);
  assert.match(webActiveSession, /ready_gate_suppressed_after_manual_exit/);
  assert.match(nativeActiveSession, /ready_gate_suppressed_until/);
  assert.match(nativeActiveSession, /ready_gate_suppressed_session_id/);
  assert.match(nativeActiveSession, /if \(error\) return false/);
  assert.match(nativeActiveSession, /isReadyGateSuppressedForSession/);
});

test("PR 1.4 micro-verdict is UX-only and does not auto-submit verdicts", () => {
  assert.match(webSurvey, /video_date\.micro_verdict_v2/);
  assert.match(nativeSurvey, /video_date\.micro_verdict_v2/);
  assert.match(webSurvey, /getVideoDateMicroVerdictCopy/);
  assert.match(nativeSurvey, /getVideoDateMicroVerdictCopy/);
  assert.doesNotMatch(webSurvey, /setTimeout\(\s*\(\)\s*=>\s*(?:void\s*)?handleVerdict/);
  assert.doesNotMatch(nativeSurvey, /setTimeout\(\s*\(\)\s*=>\s*(?:void\s*)?handleVerdict/);
});

test("snapshot normalization rejects malformed ok payloads instead of hydrating ghost sessions", () => {
  assert.deepEqual(
    normalizeVideoDateSnapshot({ ok: true, seq: 1, serverNow: 123, phase: "ready_gate" }),
    { ok: false, error: "invalid_snapshot_payload", retryable: true },
  );

  const normalized = normalizeVideoDateSnapshot({
    ok: true,
    sessionId: "11111111-1111-4111-8111-111111111111",
    seq: 7,
    serverNow: 123,
    phase: "handshake",
    allowedActions: ["continue", null, "end_call"],
    participants: [{ id: "self", isSelf: true, isPartner: false, mediaJoinedAt: 123 }],
    room: { name: "date-room", url: "https://example.daily.co/date-room", tokenRequired: true },
  });

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.sessionId, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(normalized.allowedActions, ["continue", "end_call"]);
    assert.equal(normalized.room?.token, null);
  }
});
