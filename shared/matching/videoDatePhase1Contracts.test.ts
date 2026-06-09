import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeVideoDateSnapshot, normalizeVideoDateSnapshotInvokeError } from "./videoDateSnapshot";
import { resolveVideoDateReadinessDiagnostic } from "./videoDateReadinessV2";
import {
  isVideoDateDailyTokenJoinError,
  normalizeVideoDateQueueHint,
  shouldRefreshVideoDateTokenBeforeJoin,
} from "./videoDatePublicApi";

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
const publicApiMigration = readFileSync(
  join(root, "supabase/migrations/20260523123000_public_api_interface_changes.sql"),
  "utf8",
);
const tokenRefreshFunction = readFileSync(
  join(root, "supabase/functions/video-date-token-refresh/index.ts"),
  "utf8",
);
const webSnapshotLib = readFileSync(join(root, "src/lib/videoDateSnapshot.ts"), "utf8");
const nativeSnapshotLib = readFileSync(join(root, "apps/mobile/lib/videoDateSnapshot.ts"), "utf8");
const webTokenRefreshLib = readFileSync(join(root, "src/lib/videoDateTokenRefresh.ts"), "utf8");
const nativeTokenRefreshLib = readFileSync(join(root, "apps/mobile/lib/videoDateTokenRefresh.ts"), "utf8");
const webQueueHintLib = readFileSync(join(root, "src/lib/videoDateQueueHint.ts"), "utf8");
const nativeQueueHintLib = readFileSync(join(root, "apps/mobile/lib/videoDateQueueHint.ts"), "utf8");
const publicApiLib = readFileSync(join(root, "shared/matching/videoDatePublicApi.ts"), "utf8");
const phase4UxLib = readFileSync(join(root, "shared/matching/videoDatePhase4Ux.ts"), "utf8");
const eventProfileAdapters = readFileSync(join(root, "supabase/functions/_shared/eventProfileAdapters.ts"), "utf8");
const webPaymentStatusLib = readFileSync(join(root, "src/lib/eventTicketPaymentStatus.ts"), "utf8");
const nativePaymentStatusLib = readFileSync(join(root, "apps/mobile/lib/eventTicketPaymentStatus.ts"), "utf8");
const webPaymentSuccess = readFileSync(join(root, "src/pages/EventPaymentSuccess.tsx"), "utf8");
const nativePaymentSuccess = readFileSync(join(root, "apps/mobile/app/event-payment-success.tsx"), "utf8");
const webVideoCall = readFileSync(join(root, "src/hooks/useVideoCall.ts"), "utf8");
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const dailyRoomIndex = readFileSync(join(root, "supabase/functions/daily-room/index.ts"), "utf8");
const dailyRoomContracts = readFileSync(join(root, "supabase/functions/daily-room/dailyRoomContracts.ts"), "utf8");
const webDeckHook = readFileSync(join(root, "src/hooks/useEventDeck.ts"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const instantExperience = readFileSync(join(root, "shared/matching/videoDateInstantExperience.ts"), "utf8");
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
  assert.match(snapshotFunction, /const includeToken = body\?\.include_token === true \|\| body\?\.includeToken === true/);
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
  assert.match(webSnapshotLib, /include_token: options\.includeToken === true/);
  assert.match(webSnapshotLib, /normalizeVideoDateSnapshotInvokeError\(error\)/);
  assert.match(webSnapshotLib, /snapshot_function_failed/);
  assert.match(nativeReadyRoute, /video_date\.snapshot_v2/);
  assert.match(nativeReadyRoute, /fetchVideoDateSnapshot/);
  assert.match(nativeReadyRoute, /includeToken: false/);
  assert.match(nativeReadyRoute, /snapshot\.eventId/);
  assert.match(nativeSnapshotLib, /try\s*{[\s\S]+functions\.invoke/);
  assert.match(nativeSnapshotLib, /include_token: options\.includeToken === true/);
  assert.match(nativeSnapshotLib, /normalizeVideoDateSnapshotInvokeError\(error\)/);
  assert.match(nativeSnapshotLib, /snapshot_function_failed/);
});

test("snapshot invoke errors preserve typed Edge function failures", async () => {
  const typed = await normalizeVideoDateSnapshotInvokeError({
    context: new Response(JSON.stringify({ ok: false, error: "not_participant", retryable: false }), {
      status: 403,
    }),
  });
  assert.deepEqual(typed, { ok: false, error: "not_participant", retryable: false });

  const invalid = await normalizeVideoDateSnapshotInvokeError({
    context: new Response("not json", { status: 500 }),
  });
  assert.deepEqual(invalid, { ok: false, error: "snapshot_function_failed", retryable: true });
});

test("PR 1.2 runtime readiness keeps local capability checks without Daily diagnostic rooms", () => {
  assert.doesNotMatch(dailyRoomContracts, /prepare_diagnostic_entry/);
  assert.doesNotMatch(dailyRoomContracts, /videoDateDiagnosticRoomNameForUser/);
  assert.doesNotMatch(dailyRoomIndex, /ACTION: prepare_diagnostic_entry/);
  assert.doesNotMatch(dailyRoomIndex, /DAILY_VIDEO_DATE_DIAGNOSTIC_TOKEN_TTL_SECONDS/);
  assert.doesNotMatch(dailyRoomIndex, /videoDateDiagnosticRoomProperties/);
  assert.match(webStatusHook, /recordVideoDateHeartbeatV2/);
  assert.match(nativeStatusHook, /recordVideoDateHeartbeatV2/);
  assert.match(webReadinessHook, /recordVideoDateReadinessCheckV2/);
  assert.match(webReadinessHook, /permissionsGranted[\s\S]+hasCameraDevice === false/);
  assert.match(webReadinessHook, /dailyRoomDiagnosticRemoved: true/);
  assert.doesNotMatch(webReadinessHook, /shouldRunVideoDateDiagnostic/);
  assert.doesNotMatch(webReadinessHook, /diagnosticRoomPathDefined: true/);
  assert.doesNotMatch(webReadinessHook, /dailyDiagnostic/);
  assert.doesNotMatch(webReadinessHook, /diagnostic_entry_exception/);
  assert.doesNotMatch(webReadinessLib, /prepare_diagnostic_entry/);
  assert.doesNotMatch(webReadinessLib, /diagnostic_entry_invalid_response/);
  assert.match(nativeReadiness, /record_readiness_check_v2/);
  assert.match(nativeReadiness, /dailyRoomDiagnosticRemoved: true/);
  assert.doesNotMatch(nativeReadiness, /shouldRunVideoDateDiagnostic/);
  assert.doesNotMatch(nativeReadiness, /diagnosticRoomPathDefined: true/);
  assert.doesNotMatch(nativeReadiness, /dailyDiagnostic/);
  assert.doesNotMatch(nativeReadiness, /diagnostic_entry_exception/);
  assert.doesNotMatch(nativeReadiness, /prepare_diagnostic_entry/);
  assert.doesNotMatch(nativeReadiness, /diagnostic_entry_invalid_response/);
  assert.match(webLobby, /useNonBlockingVideoDateReadiness\(\s*eventId,/);
  assert.match(nativeLobby, /useNonBlockingVideoDateReadiness\(\s*id,/);
  assert.doesNotMatch(webLobby, /canAttemptPairing|readinessBlockMessage|pairingReadinessMessage|rightSwipeDisabled/);
  assert.doesNotMatch(nativeLobby, /canAttemptPairing|pairingReadinessMessage|options\.bypassReadiness/);
});

test("PR 1.3 deck v3 and persistent ready-gate suppression are adopted; Phase 8 uses the public deck envelope", () => {
  assert.match(webDeckHook, /get_event_deck_v3/);
  assert.match(webDeckHook, /parseEventDeckResponse/);
  assert.match(webDeckHook, /VIDEO_DATE_DECK_BUFFER_LIMIT/);
  assert.match(instantExperience, /VIDEO_DATE_DECK_BUFFER_LIMIT = 5/);
  assert.match(instantExperience, /VIDEO_DATE_DECK_TOP_UP_THRESHOLD = 2/);
  assert.match(webDeckHook, /isLoading:\s*query\.isLoading/);
  assert.match(webDeckHook, /isRefreshing:\s*query\.isRefetching/);
  assert.match(webDeckHook, /isError:\s*query\.isLoadingError/);
  assert.doesNotMatch(webDeckHook, /query\.isFetching && profiles\.length === 0/);
  assert.doesNotMatch(webDeckHook, /deck_v1|["']get_event_deck["']|video_date\.deck_deal_v2/);
  assert.match(nativeEventsApi, /get_event_deck_v3/);
  assert.match(nativeEventsApi, /parseEventDeckResponse/);
  assert.match(nativeEventsApi, /VIDEO_DATE_DECK_BUFFER_LIMIT/);
  assert.match(nativeEventsApi, /isLoading:\s*query\.isLoading/);
  assert.match(nativeEventsApi, /isRefreshing:\s*query\.isRefetching/);
  assert.match(nativeEventsApi, /isError:\s*query\.isLoadingError/);
  assert.doesNotMatch(nativeEventsApi, /query\.isFetching && profiles\.length === 0/);
  assert.doesNotMatch(nativeEventsApi, /deck_v1|["']get_event_deck["']|video_date\.deck_deal_v2/);
  assert.match(webLobby, /Server-dealt deck v3 is the only active source of deck exclusion truth/);
  assert.match(nativeLobby, /Server-dealt deck v3 is the only active source of deck exclusion truth/);
  assert.doesNotMatch(webLobby, /seenProfileIds|deckDealV2|deckNonce/);
  assert.doesNotMatch(nativeLobby, /seenProfileIdsRef|deckDealV2|deckNonce/);
  assert.match(webLobby, /setQueryData<EventDeckFetchResult>\(\s*\["event-deck", eventId, user\?\.id, "deck_v3"\]/);
  assert.match(nativeLobby, /setQueryData<EventDeckFetchResult>\(\s*\[["']event-deck["'], id, user\?\.id, ["']deck_v3["']\]/);
  assert.match(webLobby, /sortedProfiles\.slice\(0, 3\)[\s\S]+new Image\(\)/);
  assert.match(nativeLobby, /sortedProfiles\.slice\(0, 3\)[\s\S]+prefetchNativeDeckImage\(src\)/);
  assert.match(nativeLobby, /ExpoImage\.prefetch\(uri,[\s\S]+RNImage\.prefetch\(uri\)/);
  assert.match(webLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
  assert.match(nativeLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)/);
  assert.match(
    webLobby,
    /invalidateQueries\(\{\s*queryKey: \[["']event-deck["'], eventId, user\?\.id\],\s*\}\)/,
  );
  assert.match(
    nativeLobby,
    /invalidateQueries\(\{\s*queryKey: \[["']event-deck["'], id, user\?\.id\],\s*\}\)/,
  );
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

test("public API interface changes are exposed for deck state, queue hints, payment status, and token refresh", () => {
  assert.match(config, /\[functions\.video-date-token-refresh\]\s+verify_jwt = true/);
  assert.match(publicApiMigration, /CREATE OR REPLACE FUNCTION public\.get_event_deck_v3/);
  assert.match(publicApiMigration, /'deck_state'/);
  assert.match(publicApiMigration, /'get_event_deck_v3_buffer'/);
  assert.match(publicApiMigration, /has_profiles/);
  assert.match(publicApiMigration, /viewer_paused/);
  assert.match(publicApiMigration, /no_remaining_profiles/);
  assert.doesNotMatch(publicApiMigration, /'scan_window_exhausted'/);
  assert.doesNotMatch(publicApiMigration, /'no_confirmed_candidates'/);
  assert.match(publicApiMigration, /v_scan_limit integer := 5000/);
  assert.match(eventProfileAdapters, /scan_limit: number \| null/);
  assert.match(publicApiMigration, /CREATE OR REPLACE FUNCTION public\.get_video_date_queue_hint_v1/);
  assert.match(publicApiMigration, /v_video_date_queue_fairness_candidates/);
  assert.match(publicApiMigration, /relief_active/);
  assert.match(publicApiMigration, /estimated_wait_seconds/);
  assert.match(publicApiMigration, /COALESCE\(vs\.queued_expires_at, COALESCE\(vs\.started_at, now\(\)\) \+ interval '10 minutes'\) > now\(\)/);
  assert.match(publicApiMigration, /CREATE OR REPLACE FUNCTION public\.get_event_ticket_payment_status_v1/);
  assert.match(publicApiMigration, /stripe_event_ticket_settlements/);
  assert.match(publicApiMigration, /ORDER BY er\.registered_at DESC NULLS LAST/);
  assert.match(publicApiMigration, /NOTIFY pgrst, 'reload schema'/);
  assert.match(tokenRefreshFunction, /get_video_date_snapshot_core/);
  assert.match(tokenRefreshFunction, /\/meeting-tokens/);
  assert.match(tokenRefreshFunction, /DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT/);
  assert.match(tokenRefreshFunction, /DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS/);
  assert.match(tokenRefreshFunction, /ejectAtTokenExp: true/);
  assert.match(webTokenRefreshLib, /VIDEO_DATE_TOKEN_REFRESH_FUNCTION_NAME/);
  assert.match(nativeTokenRefreshLib, /VIDEO_DATE_TOKEN_REFRESH_FUNCTION_NAME/);
  assert.match(webQueueHintLib, /get_video_date_queue_hint_v1/);
  assert.match(nativeQueueHintLib, /get_video_date_queue_hint_v1/);
  assert.match(webPaymentStatusLib, /get_event_ticket_payment_status_v1/);
  assert.match(nativePaymentStatusLib, /get_event_ticket_payment_status_v1/);
  assert.match(webPaymentSuccess, /fetchEventTicketPaymentStatus/);
  assert.match(nativePaymentSuccess, /fetchEventTicketPaymentStatus/);
  assert.match(publicApiLib, /MONTHLY_EVENT_JOIN_LIMIT_REACHED/);
  assert.match(publicApiLib, /eventTicketPaymentSuccessCopy/);
  assert.match(publicApiLib, /estimatedWaitSeconds/);
  assert.match(publicApiLib, /estimated_wait_seconds/);
  assert.match(publicApiLib, /shouldRefreshVideoDateTokenBeforeJoin/);
  assert.match(publicApiLib, /isVideoDateDailyTokenJoinError/);
  assert.doesNotMatch(webDeckHook, /fetchEventDeckProfiles/);
  assert.doesNotMatch(nativeEventsApi, /fetchEventDeckProfiles/);
  assert.match(webVideoCall, /refreshVideoDateToken/);
  assert.match(webVideoCall, /daily_token_refresh_join_retry/);
  assert.match(webVideoCall, /adviseVideoDateTokenRecovery/);
  assert.match(webVideoCall, /trigger: "before_join"/);
  assert.match(nativeVideoDate, /refreshVideoDateToken/);
  assert.match(nativeVideoDate, /daily_token_refresh_join_retry/);
  assert.match(nativeVideoDate, /adviseVideoDateTokenRecovery/);
  assert.match(nativeVideoDate, /trigger: ["']before_join["']/);
  assert.match(webLobby, /fetchVideoDateQueueHint/);
  assert.match(webLobby, /resolveEventDeckPhase4UiState/);
  assert.match(webLobby, /deckState\?\.reason === "event_not_active"/);
  assert.match(webLobby, /deckState\?\.inactive_reason/);
  assert.match(phase4UxLib, /no_confirmed_candidates/);
  assert.match(phase4UxLib, /scan_window_exhausted/);
  assert.match(phase4UxLib, /formatVideoDateQueueEtaLabel/);
  assert.match(nativeLobby, /fetchVideoDateQueueHint/);
  assert.match(nativeLobby, /const deckQueryEnabled = Boolean\([\s\S]+resolvedEventLifecycle\?\.isLive/);
  assert.match(nativeLobby, /deckState\?\.reason !== ['"]event_not_active['"]/);
  assert.match(
    nativeLobby,
    /deckState\.reason !== ['"]event_not_active['"][\s\S]+setServerInactiveEventReasonWithSource\(null, null\)/,
  );
  assert.match(nativeLobby, /resolveEventDeckPhase4UiState/);
  assert.match(nativeLobby, /deckState\?\.inactive_reason/);
  assert.match(webLobby, /resolveVideoDateQueueCopy/);
  assert.match(nativeLobby, /resolveVideoDateQueueCopy/);
  assert.match(phase4UxLib, /formatVideoDateQueueHintLabel/);
  assert.match(phase4UxLib, /priority boost/);
  assert.match(nativeActiveSession, /fetchVideoDateQueueHint/);
  assert.doesNotMatch(nativeActiveSession, /\.eq\('ready_gate_status', 'queued'\)/);
});

test("public API helpers handle malformed edge cases conservatively", () => {
  assert.equal(
    shouldRefreshVideoDateTokenBeforeJoin("2026-05-23T10:01:30.000Z", Date.parse("2026-05-23T10:00:00.000Z")),
    true,
  );
  assert.equal(
    shouldRefreshVideoDateTokenBeforeJoin("2026-05-23T10:05:00.000Z", Date.parse("2026-05-23T10:00:00.000Z")),
    false,
  );
  assert.equal(shouldRefreshVideoDateTokenBeforeJoin("not-a-date", Date.parse("2026-05-23T10:00:00.000Z")), true);
  assert.equal(isVideoDateDailyTokenJoinError({ errorMsg: "Meeting token expired" }), true);
  assert.equal(isVideoDateDailyTokenJoinError({ message: "Camera permission denied" }), false);

  const queueHint = normalizeVideoDateQueueHint({
    ok: true,
    queued: true,
    estimated_wait_seconds: 45,
    relief_active: true,
  });
  assert.equal(queueHint.estimatedWaitSeconds, 45);
  assert.equal(queueHint.reliefActive, true);
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

test("readiness diagnostics resolve copy without a Daily-room throttle path", () => {
  assert.deepEqual(resolveVideoDateReadinessDiagnostic("blocked"), {
    status: "blocked",
    diagnosticMessage: "Camera and microphone access are needed before you can join a video date.",
  });
  assert.deepEqual(resolveVideoDateReadinessDiagnostic("ready"), {
    status: "ready",
    diagnosticMessage: null,
  });
});
