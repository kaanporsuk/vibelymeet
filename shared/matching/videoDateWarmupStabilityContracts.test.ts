import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function block(source: string, start: RegExp, end: RegExp): string {
  const startMatch = source.match(start);
  assert.ok(startMatch?.index != null, `expected block start ${start}`);
  const tail = source.slice(startMatch.index);
  const endMatch = tail.match(end);
  assert.ok(endMatch?.index != null, `expected block end ${end}`);
  return tail.slice(0, endMatch.index);
}

const webVideoCall = readWebVideoCallFlowSource(root);
const webVideoDate = readWebVideoDatePageFlowSource(root);
const webDupTabGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const webReconnection = read("src/hooks/useReconnection.ts");
const readyRedirect = read("src/pages/ReadyRedirect.tsx");
const nativeDateRoute = readNativeVideoDateScreenFlowSource();
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const observability = read("shared/observability/videoDateClientStuckObservability.ts");
const warmupMigration = read("supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql");
const latestPresenceMigration = read("supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql");
const remoteSeenLatestMigration = read("supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql");
const beforeunloadLifecycleMigration = read(
  "supabase/migrations/20260605200729_video_date_beforeunload_active_presence_repair.sql",
);
const remoteSeenGracePayloadMigration = read(
  "supabase/migrations/20260605203904_video_date_remote_seen_grace_payload_preserve.sql",
);
const surfaceExpiryCurrentGuardMigration = read(
  "supabase/migrations/20260605211924_video_date_surface_claim_expiry_current_guard.sql",
);

test("web Daily participant-left waits for local transport grace before backend away mark", () => {
  const participantLeftBlock = block(
    webVideoCall,
    /bindDailyEvent\("participant-left"/,
    /bindDailyEvent\("error"/,
  );
  const expireGraceBlock = block(
    webVideoCall,
    /const expireGrace = \(\) =>/,
    /const recoverTransport = \(reason: string\) =>/,
  );

  assert.match(webVideoCall, /DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000/);
  assert.match(participantLeftBlock, /startReconnectGrace\("participant_left"\)/);
  assert.match(participantLeftBlock, /daily_partner_left_deferred_until_transport_grace/);
  assert.doesNotMatch(participantLeftBlock, /onPartnerLeft/);
  assert.match(expireGraceBlock, /optionsRef\.current\?\.onPartnerLeft\?\.\(\)/);
  assert.match(webReconnection, /p_reason: "daily_transport_grace_expired"/);
});

test("peer-missing watchdog suppresses terminal UI after survey or bilateral encounter truth", () => {
  assert.match(webVideoCall, /videoSessionHasPostDateSurveyTruth\(truth\)/);
  assert.match(webVideoCall, /videoSessionHasEncounterExposureTruth\(truth\)/);
  assert.match(webVideoCall, /peer_missing_suppressed_survey_truth/);
  assert.match(webVideoCall, /daily_no_remote_watchdog_historical_truth_suppressed/);
  assert.match(webVideoCall, /peer_missing_suppressed_remote_seen/);
  assert.match(webVideoCall, /onTerminalSurveyTruth\?\.\("peer_missing_watchdog_survey_truth"\)/);
  assert.match(nativeDateRoute, /videoSessionHasPostDateSurveyTruth\(\s*truth \?\? null,\s*\)/);
  assert.match(nativeDateRoute, /videoSessionHasEncounterExposureTruth\(truth \?\? null\)/);
  assert.match(nativeDateRoute, /peer_missing_terminal_suppressed/);
  assert.match(nativeDateRoute, /daily_no_remote_watchdog_historical_truth_suppressed/);
  assert.match(nativeDateRoute, /peer_missing_suppressed_remote_seen/);
  assert.match(nativeDateRoute, /openNativePostDateSurveyFromTerminalTruth\(\s*["']peer_missing_watchdog_survey_truth["']/);
  assert.match(observability, /"peer_missing_suppressed_remote_seen"/);
  assert.match(observability, /"peer_missing_suppressed_survey_truth"/);
  assert.doesNotMatch(webVideoCall, /daily_no_remote_watchdog_historical_truth_requires_current_peer/);
  assert.doesNotMatch(nativeDateRoute, /daily_no_remote_watchdog_historical_truth_requires_current_peer/);
});

test("terminal survey hard-stop gates Daily start, surface claims, and route-state recovery", () => {
  assert.match(webVideoDate, /terminalSurveyRecoveryInFlightRef/);
  assert.match(webVideoDate, /terminalSurveyRecoveryActive/);
  assert.match(webVideoDate, /terminalDailyStopRef/);
  assert.match(webVideoDate, /terminalDailyStopRequestedRef/);
  assert.match(webVideoDate, /const stopDailyForTerminal = terminalDailyStopRef\.current/);
  assert.match(webVideoDate, /stopDailyForTerminal\(reason\)/);
  assert.match(webVideoDate, /stopDailyForTerminal\("terminal_survey_ref_attached"\)/);
  assert.match(webVideoDate, /endCall\(`terminal_survey_hard_stop:\$\{reason\}`\)/);
  assert.match(webVideoDate, /const enterTerminalSurveyHardStop = useCallback/);
  assert.match(webVideoDate, /enterTerminalSurveyHardStop\(source\)[\s\S]{0,220}hydrateTerminalSurveyContext\(sessionRow, source\)/);
  assert.match(webVideoDate, /verdictFetchFailed[\s\S]{0,220}openPostDateSurvey\(source\)/);
  assert.match(webVideoDate, /onTerminalSurveyTruth: \(source\) =>/);
  assert.match(webVideoDate, /readyRedirectForceSurveyState\?\.forceSurvey/);
  assert.match(webVideoDate, /!terminalSurveyRecoveryActive[\s\S]{0,120}phase !== "ended"/);
  assert.match(
    webVideoDate,
    /phase === "ended"[\s\S]{0,80}showFeedback[\s\S]{0,80}terminalSurveyRecoveryActive[\s\S]{0,80}terminalSurveyRecoveryInFlightRef\.current/,
  );
  assert.match(readyRedirect, /forceSurvey = false/);
  assert.match(readyRedirect, /recovery\.action === "go_survey"/);
  assert.match(readyRedirect, /canonicalRoute\.target === "survey"/);
});

test("native Daily participant-left also waits for local transport grace", () => {
  assert.match(nativeDateRoute, /NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000/);
  assert.match(nativeDateRoute, /partnerAwayAfterTransportGraceTimerRef/);
  assert.match(nativeDateRoute, /clearPartnerAwayAfterTransportGrace\(["']participant_joined["']\)/);
  assert.match(nativeDateRoute, /clearPartnerAwayAfterTransportGrace\(["']participant_updated["']\)/);
  assert.match(nativeDateRoute, /daily_participant_left_transport_grace_started/);
  assert.match(nativeDateRoute, /daily_participant_left_transport_grace_expired/);
  assert.match(nativeDateRoute, /markReconnectPartnerAway\(\s*sessionId,\s*["']daily_transport_grace_expired["'],\s*\)/);
  assert.match(nativeVideoDateApi, /p_reason: reason/);
});

test("web Daily start is single-owned and same-session calls are reused instead of rebuilt", () => {
  assert.match(webVideoCall, /const \[dailyMeetingState, setDailyMeetingState\] = useState<string \| null>\(null\)/);
  assert.match(webVideoCall, /const \[localInDailyRoom, setLocalInDailyRoom\] = useState\(false\)/);
  assert.match(webVideoCall, /isTerminalDailyMeetingState\(meetingState\)/);
  assert.match(webVideoCall, /start_call_reuse_same_session/);
  assert.match(webVideoCall, /same_session_call_still_active/);
  assert.match(webVideoCall, /daily_call_busy_internal_retry/);
  assert.match(webVideoCall, /return await startCall\(sessionId,\s*\{\s*internalRetry: true/);
  assert.match(webVideoCall, /eventName: "daily_call_cleanup"/);
  assert.match(webVideoCall, /WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS: number \| null = null/);
  assert.match(webVideoCall, /parkingMode: "live_same_session_remount"/);
  assert.match(webVideoCall, /idleDestroyDisabled: idleMs == null/);
  assert.match(webVideoCall, /eventName: "daily_call_singleton_idle_destroy"/);
  assert.doesNotMatch(webVideoCall, /warm_handoff/);
  assert.match(webVideoCall, /sameSessionDailyContinuity =[\s\S]+dailyCallSingletonEligible[\s\S]+hasSameSessionDailyContinuity\(sessionId\)/);
  assert.match(webVideoCall, /sameSessionDailyContinuityLatched: hasSameSessionDailyContinuity\(sessionId\)/);
  assert.match(webVideoCall, /latchSameSessionDailyContinuity\(sessionId, "daily_join_success"\)/);
  assert.match(webVideoCall, /cleanupCallObjectRef\.current\("useVideoCall\.unmount", "component_unmount"\)/);
  assert.doesNotMatch(webVideoCall, /void cleanupCallObject\("useVideoCall\.unmount", "component_unmount"\);\s*\};\s*\}, \[cleanupCallObject\]\)/);
  assert.match(webVideoCall, /const singletonCall =\s*userId\s*\?\s*consumeWebDailyCallSingleton/);
  assert.match(webVideoCall, /const skipMediaPreflightForSingleton = userId\s*\?\s*hasReusableWebDailyCallSingleton/);
  assert.match(webVideoCall, /daily_call_live_remount_leave_destroy_skipped_for_singleton/);
  assert.match(webVideoCall, /leave_called: Boolean\(callObject\) && !shouldParkLiveSingleton/);
  assert.match(webVideoCall, /destroy_called: Boolean\(callObject\) && !shouldParkLiveSingleton/);
  assert.match(webVideoCall, /daily_join_skipped_singleton_already_joined/);
  assert.match(webVideoCall, /daily_join_completed_by_singleton_inflight/);
});

test("web lifecycle leaves are soft telemetry while Daily is active or starting", () => {
  const lifecycleBlock = block(
    webVideoDate,
    /Browser lifecycle/,
    /Record user's explicit handshake decision/,
  );

  assert.match(lifecycleBlock, /shouldTreatLifecycleAwayAsSoftTelemetry/);
  assert.match(webVideoDate, /WEB_SOFT_LIFECYCLE_LEAVE_SOURCES/);
  assert.match(webVideoDate, /"beforeunload"/);
  assert.match(webVideoDate, /"pagehide"/);
  assert.match(webVideoDate, /"visibilitychange"/);
  assert.match(webVideoDate, /"freeze"/);
  assert.doesNotMatch(lifecycleBlock, /source !== "visibilitychange"/);
  assert.match(lifecycleBlock, /localInDailyRoom \|\| isConnecting \|\| isConnected/);
  assert.match(lifecycleBlock, /dailyMeetingState === "joining-meeting"[\s\S]{0,40}dailyMeetingState === "joined-meeting"/);
  assert.match(lifecycleBlock, /web_lifecycle_away_suppressed_active_daily/);
  assert.match(lifecycleBlock, /send_suppressed/);
  assert.match(lifecycleBlock, /schedule_suppressed/);
  assert.match(lifecycleBlock, /beforeunload_suppressed/);
  assert.match(lifecycleBlock, /pagehide_suppressed/);
  assert.match(lifecycleBlock, /!softLifecycleAway && localVideoRef\.current\?\.srcObject/);
  assert.match(lifecycleBlock, /sendLeaveSignal\("pagehide"\)/);
});

test("web and native video-date surface claims survive launch route churn", () => {
  assert.match(webDupTabGuard, /const LEASE_MS = 15_000/);
  assert.match(webDupTabGuard, /const TICK_MS = 5_000/);
  assert.match(webDupTabGuard, /const SERVER_TTL_SECONDS = 30/);
  assert.match(webDupTabGuard, /serverClientStorageKey/);
  assert.match(
    webDupTabGuard,
    /vibely_vd_surface_client:\$\{profileId\}:\$\{sessionId\}/,
  );
  assert.match(webDupTabGuard, /serverClientInstanceId/);
  assert.match(webDupTabGuard, /activeServerSurfaceOwners/);
  assert.match(webDupTabGuard, /type ActiveServerSurfaceOwner/);
  assert.match(webDupTabGuard, /activeOwner\?\.owner === owner/);
  assert.match(
    webDupTabGuard,
    /activeServerSurfaceOwners\.get\(activeKey\)\?\.serverClientInstanceId/,
  );
  assert.match(webDupTabGuard, /SERVER_CLAIM_RELEASE_GRACE_MS = 1_000/);
  assert.match(webDupTabGuard, /getLocalStorage\(\)/);
  assert.match(nativeDateRoute, /const NATIVE_VIDEO_DATE_SURFACE_CLAIM_TTL_SECONDS = 30/);
  assert.match(nativeDateRoute, /const NATIVE_VIDEO_DATE_SURFACE_CLAIM_REFRESH_MS = 10_000/);
  assert.match(
    nativeDateRoute,
    /NATIVE_VIDEO_DATE_SURFACE_CLIENT_STORAGE_PREFIX/,
  );
  assert.match(nativeDateRoute, /AsyncStorage\.getItem\(storageKey\)/);
  assert.match(nativeDateRoute, /nativeVideoDateActiveSurfaceOwners/);
  assert.match(nativeDateRoute, /type NativeVideoDateActiveSurfaceOwner/);
  assert.match(nativeDateRoute, /getCachedNativeVideoDateClientInstanceId/);
  assert.match(nativeDateRoute, /nativeSurfaceClientReady/);
  assert.match(nativeDateRoute, /!nativeSurfaceClientReady/);
  assert.match(
    nativeDateRoute,
    /if \(!nativeSurfaceClientReady\) \{[\s\S]{0,500}confirmed: false/,
  );
  assert.match(nativeDateRoute, /videoDateSurfaceOwnerIdRef/);
  assert.match(nativeDateRoute, /activeOwner\?\.owner === surfaceOwnerId/);
  assert.match(nativeDateRoute, /\?\.clientInstanceId === clientInstanceId/);
  assert.match(
    nativeDateRoute,
    /NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS = 1_000/,
  );
  assert.match(nativeDateRoute, /p_client_instance_id:\s*clientInstanceId/);
});

test("native background only sends backend away after local grace expiry", () => {
  const backgroundBlock = block(
    nativeDateRoute,
    /if \(next === ["']background["'] \|\| next === ["']inactive["']\)/,
    /requestReconnectSyncRef\.current\(["']app_background["']\)/,
  );

  assert.match(backgroundBlock, /native_background_grace_started/);
  assert.match(backgroundBlock, /await cleanupDailyAndLocalState\(\{\s*mode: ["']destructive["'],\s*reason: ["']app_background["'],\s*\}\)/);
  assert.doesNotMatch(backgroundBlock, /signalVideoDateLeave\(\s*sessionId,\s*["']app_background["']/);
  assert.match(backgroundBlock, /signalVideoDateLeave\(\s*sessionId,\s*["']app_background_timeout["'],\s*\)/);
});

test("latest presence migration repairs joins, soft-away, and reconnect expiry", () => {
  assert.match(latestPresenceMigration, /CREATE OR REPLACE FUNCTION public\.video_date_latest_presence_is_active/);
  assert.match(latestPresenceMigration, /participant_1_joined_at = GREATEST\(COALESCE\(participant_1_joined_at, v_now\), v_now\)/);
  assert.match(latestPresenceMigration, /reconnect_grace_cleared_by_daily_join/);
  assert.match(latestPresenceMigration, /record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base/);
  assert.match(latestPresenceMigration, /latestPresenceRepaired/);
  assert.match(latestPresenceMigration, /reconnect_grace_cleared_by_provider_join/);
  assert.match(latestPresenceMigration, /mark_reconnect_self_away_suppressed_active_daily_presence/);
  assert.match(latestPresenceMigration, /v_reason IN \('web_visibilitychange', 'web_freeze', 'app_background'\)/);
  assert.match(latestPresenceMigration, /v_action = 'mark_reconnect_return'/);
  assert.match(latestPresenceMigration, /reconnect_grace_expiry_suppressed_latest_presence/);
  assert.match(latestPresenceMigration, /v_remote_seen_after_away/);
  assert.match(latestPresenceMigration, /reason_code NOT IN \(/);
  assert.match(latestPresenceMigration, /'daily_call_cleanup'/);
  assert.match(latestPresenceMigration, /'remote_seen_canonical_repair_failed'/);
  assert.match(beforeunloadLifecycleMigration, /video_date_transition_20260605200729_lifecycle_base/);
  assert.match(beforeunloadLifecycleMigration, /'web_beforeunload'/);
  assert.match(beforeunloadLifecycleMigration, /'web_pagehide'/);
  assert.match(beforeunloadLifecycleMigration, /mark_reconnect_self_away_suppressed_active_daily_presence/);
  assert.match(beforeunloadLifecycleMigration, /mark_video_date_remote_seen_20260605200729_grace_base/);
  assert.match(beforeunloadLifecycleMigration, /reconnect_grace_cleared_by_remote_seen/);
  assert.match(beforeunloadLifecycleMigration, /latest_away_reason/);
  assert.match(beforeunloadLifecycleMigration, /surface_active_near_away/);
  assert.match(beforeunloadLifecycleMigration, /recent_lifecycle_media/);
  assert.match(beforeunloadLifecycleMigration, /reconnect_grace_expiry_suppressed_latest_presence/);
  assert.match(beforeunloadLifecycleMigration, /COALESCE\(e\.detail->>'reason', e\.detail->>'p_reason'\)/);
  assert.match(remoteSeenGracePayloadMigration, /v_base_reconnect_grace_cleared/);
  assert.match(remoteSeenGracePayloadMigration, /v_base_reconnect_grace_cleared OR v_rows_changed > 0/);
  assert.match(remoteSeenGracePayloadMigration, /base_reconnect_grace_cleared/);
  assert.match(surfaceExpiryCurrentGuardMigration, /CREATE OR REPLACE FUNCTION public\.expire_video_date_reconnect_graces\(\)/);
  assert.match(surfaceExpiryCurrentGuardMigration, /AND c\.expires_at >= v_latest_away_at/);
  assert.match(surfaceExpiryCurrentGuardMigration, /AND c\.expires_at >= v_now/);
  assert.match(surfaceExpiryCurrentGuardMigration, /current unexpired video-date surface evidence/);
});

test("canonical remote-seen repair advances timestamps as latest-state evidence", () => {
  assert.match(remoteSeenLatestMigration, /CREATE OR REPLACE FUNCTION public\.mark_video_date_remote_seen\(p_session_id uuid\)/);
  assert.match(remoteSeenLatestMigration, /participant_1_remote_seen_at = GREATEST\(COALESCE\(participant_1_remote_seen_at, v_now\), v_now\)/);
  assert.match(remoteSeenLatestMigration, /participant_2_remote_seen_at = GREATEST\(COALESCE\(participant_2_remote_seen_at, v_now\), v_now\)/);
  assert.match(remoteSeenLatestMigration, /v_previous_remote_seen_at/);
  assert.match(remoteSeenLatestMigration, /v_latest_remote_seen_at/);
  assert.match(remoteSeenLatestMigration, /remote_seen_canonical_repaired/);
  assert.match(remoteSeenLatestMigration, /latest_remote_seen_at/);
  assert.match(remoteSeenLatestMigration, /previous_remote_seen_at/);
  assert.match(remoteSeenLatestMigration, /GRANT EXECUTE ON FUNCTION public\.mark_video_date_remote_seen\(uuid\)\s+TO authenticated/);
});

test("SQL wrapper suppresses legacy immediate partner-away but preserves explicit grace expiry", () => {
  assert.match(warmupMigration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260604170438_warmup_stability_base/);
  assert.match(warmupMigration, /v_action = 'mark_reconnect_partner_away'/);
  assert.match(warmupMigration, /COALESCE\(v_reason, ''\) <> 'daily_transport_grace_expired'/);
  assert.match(warmupMigration, /participant_1_remote_seen_at IS NOT NULL/);
  assert.match(warmupMigration, /participant_2_remote_seen_at IS NOT NULL/);
  assert.match(warmupMigration, /away_mark_suppressed/);
  assert.match(warmupMigration, /daily_transport_grace_required/);
  assert.match(warmupMigration, /RETURN public\.video_date_transition_20260604170438_warmup_stability_base/);
  assert.match(warmupMigration, /peer_missing_suppressed_remote_seen/);
  assert.match(warmupMigration, /peer_missing_suppressed_survey_truth/);
});
