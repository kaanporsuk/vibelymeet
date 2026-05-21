import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeVideoDateSnapshot } from "./videoDateSnapshot";
import {
  VIDEO_DATE_DIAGNOSTIC_THROTTLE_MS,
  shouldRunVideoDateDiagnostic,
} from "./videoDateReadinessV2";

const root = process.cwd();
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const phase1Migration = readFileSync(
  join(root, "supabase/migrations/20260521172000_video_date_phase1_client_wiring.sql"),
  "utf8",
);
const readyGateSuppressionHardeningMigration = readFileSync(
  join(root, "supabase/migrations/20260522004000_ready_gate_suppression_active_gate_only.sql"),
  "utf8",
);
const snapshotEventIdMigration = readFileSync(
  join(root, "supabase/migrations/20260521193000_video_date_phase1_snapshot_event_id.sql"),
  "utf8",
);
const snapshotFunction = readFileSync(
  join(root, "supabase/functions/video-date-snapshot/index.ts"),
  "utf8",
);
const webSnapshotLib = readFileSync(join(root, "src/lib/videoDateSnapshot.ts"), "utf8");
const nativeSnapshotLib = readFileSync(join(root, "apps/mobile/lib/videoDateSnapshot.ts"), "utf8");
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
const webReadyRedirect = readFileSync(join(root, "src/pages/ReadyRedirect.tsx"), "utf8");
const nativeReadyRoute = readFileSync(join(root, "apps/mobile/app/ready/[id].tsx"), "utf8");
const webActiveSession = readFileSync(join(root, "src/hooks/useActiveSession.ts"), "utf8");
const nativeActiveSession = readFileSync(join(root, "apps/mobile/lib/useActiveSession.ts"), "utf8");
const webSurvey = readFileSync(join(root, "src/components/video-date/PostDateSurvey.tsx"), "utf8");
const nativeSurvey = readFileSync(join(root, "apps/mobile/components/video-date/PostDateSurvey.tsx"), "utf8");

test("PR 1.1 snapshot wrapper keeps tokens in Edge only", () => {
  assert.match(config, /\[functions\.video-date-snapshot\]\s+verify_jwt = true/);
  assert.match(snapshotFunction, /get_video_date_snapshot_core/);
  assert.match(snapshotFunction, /DAILY_API_KEY/);
  assert.match(snapshotFunction, /\/meeting-tokens/);
  assert.match(snapshotFunction, /include_token/);
  assert.match(snapshotFunction, /if \(!includeToken\)/);
  assert.match(snapshotFunction, /ejectAtTokenExp: true/);
  assert.match(snapshotFunction, /tokenExpiresAt/);
  assert.match(snapshotFunction, /"Cache-Control": "no-store"/);
  assert.match(snapshotFunction, /UUID_PATTERN/);
  assert.match(snapshotFunction, /invalid_session_id/);
  assert.match(snapshotFunction, /phase !== "handshake" && phase !== "date"/);
  assert.doesNotMatch(snapshotFunction, /\.from\(/);
  assert.doesNotMatch(snapshotFunction, /outbox/i);
  assert.doesNotMatch(phase1Migration, /token/i);
  assert.match(snapshotEventIdMigration, /'eventId', v_session\.event_id/);
  assert.doesNotMatch(snapshotEventIdMigration, /\/meeting-tokens|DAILY_API_KEY|video_date_outbox/i);
  assert.match(webReadyRedirect, /video_date\.snapshot_v2/);
  assert.match(webReadyRedirect, /fetchVideoDateSnapshot/);
  assert.match(webReadyRedirect, /includeToken: false/);
  assert.match(webReadyRedirect, /snapshot\.eventId/);
  assert.match(webSnapshotLib, /try\s*{[\s\S]+functions\.invoke/);
  assert.match(webSnapshotLib, /include_token: options\.includeToken !== false/);
  assert.match(webSnapshotLib, /snapshot_function_failed/);
  assert.match(nativeReadyRoute, /video_date\.snapshot_v2/);
  assert.match(nativeReadyRoute, /fetchVideoDateSnapshot/);
  assert.match(nativeReadyRoute, /includeToken: false/);
  assert.match(nativeReadyRoute, /snapshot\.eventId/);
  assert.match(nativeSnapshotLib, /try\s*{[\s\S]+functions\.invoke/);
  assert.match(nativeSnapshotLib, /include_token: options\.includeToken !== false/);
  assert.match(nativeSnapshotLib, /snapshot_function_failed/);
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
  assert.match(webReadinessHook, /shouldRunVideoDateDiagnostic/);
  assert.match(webReadinessHook, /permissionsGranted[\s\S]+hasCameraDevice === false/);
  assert.match(webReadinessHook, /diagnosticRoomPathDefined: true/);
  assert.match(webReadinessHook, /dailyDiagnostic/);
  assert.match(webReadinessHook, /diagnostic_entry_exception/);
  assert.doesNotMatch(webReadinessHook, /token:\s*diagnostic\.token/);
  assert.match(webReadinessLib, /try\s*{[\s\S]+prepare_diagnostic_entry/);
  assert.match(webReadinessLib, /diagnostic_entry_invalid_response/);
  assert.match(nativeReadiness, /record_readiness_check_v2/);
  assert.match(nativeReadiness, /shouldRunVideoDateDiagnostic/);
  assert.match(nativeReadiness, /diagnosticRoomPathDefined: true/);
  assert.match(nativeReadiness, /dailyDiagnostic/);
  assert.match(nativeReadiness, /diagnostic_entry_exception/);
  assert.doesNotMatch(nativeReadiness, /token:\s*diagnostic\.token/);
  assert.match(nativeReadiness, /try\s*{[\s\S]+prepare_diagnostic_entry/);
  assert.match(nativeReadiness, /diagnostic_entry_invalid_response/);
  assert.match(webLobby, /canAttemptPairing: !readinessV2\.enabled \|\| videoDateReadiness\.canAttemptPairing/);
  assert.match(nativeLobby, /swipeType !== 'pass' && readinessV2\.enabled && !videoDateReadiness\.canAttemptPairing/);
});

test("PR 1.3 deck v2 and persistent ready-gate suppression are adopted behind flags", () => {
  assert.match(webDeckHook, /video_date\.deck_deal_v2/);
  assert.match(webDeckHook, /get_event_deck_v2/);
  assert.match(webDeckHook, /p_limit: deckDealV2\.enabled \? 1 : 50/);
  assert.match(webDeckHook, /query\.isFetching && profiles\.length === 0/);
  assert.match(nativeEventsApi, /video_date\.deck_deal_v2/);
  assert.match(nativeEventsApi, /get_event_deck_v2/);
  assert.match(nativeEventsApi, /p_limit: deckDealV2\.enabled \? 1 : 50/);
  assert.match(nativeEventsApi, /query\.isFetching && profiles\.length === 0/);
  assert.match(webLobby, /deckDealV2\.enabled[\s\S]+\?\s*\[\.\.\.profiles\]/);
  assert.match(nativeLobby, /deckDealV2\.enabled[\s\S]+\?\s*\[\.\.\.profiles\]/);
  assert.match(webLobby, /setQueryData<DeckProfile\[\]>\(\s*\["event-deck", eventId, user\?\.id, "deck_v2"\]/);
  assert.match(nativeLobby, /setQueryData<DeckProfile\[\]>\(\s*\['event-deck', id, user\?\.id, 'deck_v2'\]/);
  assert.match(webLobby, /deckDealV2\.enabled[\s\S]+invalidateQueries\(\{ queryKey: \["event-deck", eventId, user\?\.id\] \}\)/);
  assert.match(nativeLobby, /deckDealV2\.enabled[\s\S]+invalidateQueries\(\{ queryKey: \['event-deck', id, user\?\.id\] \}\)/);
  assert.match(phase1Migration, /CREATE OR REPLACE FUNCTION public\.persist_ready_gate_suppression_v2/);
  assert.match(phase1Migration, /ADD COLUMN IF NOT EXISTS ready_gate_suppressed_session_id uuid/);
  assert.match(phase1Migration, /FOR UPDATE/);
  assert.match(phase1Migration, /ready_gate_status/);
  assert.match(phase1Migration, /ready_gate_status,?[\s\S]+handshake_started_at/);
  assert.match(phase1Migration, /state::text IS DISTINCT FROM 'ready_gate'[\s\S]+COALESCE\(v_session\.phase, ''\) IS DISTINCT FROM 'ready_gate'/);
  assert.match(phase1Migration, /COALESCE\(v_session\.ready_gate_status, ''\) NOT IN \('ready', 'ready_a', 'ready_b', 'snoozed'\)/);
  assert.match(phase1Migration, /WHEN ready_gate_suppressed_session_id = p_session_id THEN GREATEST/);
  assert.match(phase1Migration, /ready_gate_suppressed_session_id = p_session_id/);
  assert.match(phase1Migration, /error', 'not_ready_gate'/);
  assert.match(phase1Migration, /current_room_id = p_session_id AND queue_status = 'in_ready_gate'/);
  assert.match(phase1Migration, /participant_1_id[\s\S]+participant_2_id/);
  assert.match(phase1Migration, /ready_gate_suppressed_until/);
  assert.match(readyGateSuppressionHardeningMigration, /CREATE OR REPLACE FUNCTION public\.persist_ready_gate_suppression_v2/);
  assert.match(readyGateSuppressionHardeningMigration, /COALESCE\(v_session\.ready_gate_status, ''\) NOT IN \('ready', 'ready_a', 'ready_b', 'snoozed'\)/);
  assert.match(readyGateSuppressionHardeningMigration, /Rejects queued\/pre-gate sessions/);
  assert.match(readyGateSuppressionHardeningMigration, /NOTIFY pgrst, 'reload schema'/);
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
    eventId: "22222222-2222-4222-8222-222222222222",
    phase: "handshake",
    allowedActions: ["continue", null, "end_call"],
    participants: [{ id: "self", isSelf: true, isPartner: false, mediaJoinedAt: 123 }],
    room: { name: "date-room", url: "https://example.daily.co/date-room", tokenRequired: true },
  });

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.sessionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(normalized.eventId, "22222222-2222-4222-8222-222222222222");
    assert.deepEqual(normalized.allowedActions, ["continue", "end_call"]);
    assert.equal(normalized.room?.token, null);
  }
});

test("readiness diagnostics run in the background only when useful and throttled", () => {
  const nowMs = 1_000_000;
  assert.equal(shouldRunVideoDateDiagnostic("blocked", null, nowMs), false);
  assert.equal(shouldRunVideoDateDiagnostic("unchecked", null, nowMs), false);
  assert.equal(shouldRunVideoDateDiagnostic("warning", null, nowMs), true);
  assert.equal(shouldRunVideoDateDiagnostic("ready", nowMs - 1000, nowMs), false);
  assert.equal(
    shouldRunVideoDateDiagnostic("ready", nowMs - VIDEO_DATE_DIAGNOSTIC_THROTTLE_MS, nowMs),
    true,
  );
});
