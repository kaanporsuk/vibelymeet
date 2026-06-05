import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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

const webVideoCall = read("src/hooks/useVideoCall.ts");
const webVideoDate = read("src/pages/VideoDate.tsx");
const webReconnection = read("src/hooks/useReconnection.ts");
const readyRedirect = read("src/pages/ReadyRedirect.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const observability = read("shared/observability/videoDateClientStuckObservability.ts");
const warmupMigration = read("supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql");
const latestPresenceMigration = read("supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql");
const remoteSeenLatestMigration = read("supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql");

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

test("peer-missing watchdog suppresses terminal UI when server truth proves exposure or survey", () => {
  assert.match(webVideoCall, /videoSessionHasPostDateSurveyTruth\(truth\)/);
  assert.match(webVideoCall, /videoSessionHasEncounterExposureTruth\(truth\)/);
  assert.match(webVideoCall, /peer_missing_suppressed_remote_seen/);
  assert.match(webVideoCall, /peer_missing_suppressed_survey_truth/);
  assert.match(webVideoCall, /onTerminalSurveyTruth\?\.\("peer_missing_watchdog_survey_truth"\)/);
  assert.match(nativeDateRoute, /videoSessionHasPostDateSurveyTruth\(truth \?\? null\)/);
  assert.match(nativeDateRoute, /videoSessionHasEncounterExposureTruth\(truth \?\? null\)/);
  assert.match(nativeDateRoute, /peer_missing_terminal_suppressed/);
  assert.match(nativeDateRoute, /openNativePostDateSurveyFromTerminalTruth\('peer_missing_watchdog_survey_truth'/);
  assert.match(observability, /"peer_missing_suppressed_remote_seen"/);
  assert.match(observability, /"peer_missing_suppressed_survey_truth"/);
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
  assert.match(webVideoDate, /phase === "ended" \|\| showFeedback \|\| terminalSurveyRecoveryActive \|\| terminalSurveyRecoveryInFlightRef\.current/);
  assert.match(readyRedirect, /forceSurvey = false/);
  assert.match(readyRedirect, /recovery\.action === "go_survey"/);
  assert.match(readyRedirect, /canonicalRoute\.target === "survey"/);
});

test("native Daily participant-left also waits for local transport grace", () => {
  assert.match(nativeDateRoute, /NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000/);
  assert.match(nativeDateRoute, /partnerAwayAfterTransportGraceTimerRef/);
  assert.match(nativeDateRoute, /clearPartnerAwayAfterTransportGrace\('participant_joined'\)/);
  assert.match(nativeDateRoute, /clearPartnerAwayAfterTransportGrace\('participant_updated'\)/);
  assert.match(nativeDateRoute, /daily_participant_left_transport_grace_started/);
  assert.match(nativeDateRoute, /daily_participant_left_transport_grace_expired/);
  assert.match(nativeDateRoute, /markReconnectPartnerAway\(sessionId, 'daily_transport_grace_expired'\)/);
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
  assert.match(webVideoCall, /WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS = 20_000/);
  assert.match(webVideoCall, /parkingMode: "live_same_session_remount"/);
  assert.doesNotMatch(webVideoCall, /warm_handoff/);
  assert.match(webVideoCall, /sameSessionDailyContinuity: Boolean\(optionsRef\.current\?\.dailyCallSingletonEligible\)/);
  assert.match(webVideoCall, /const singletonCall =\s*userId\s*\?\s*consumeWebDailyCallSingleton/);
  assert.match(webVideoCall, /const skipMediaPreflightForSingleton = userId\s*\?\s*hasReusableWebDailyCallSingleton/);
  assert.match(webVideoCall, /daily_call_live_remount_leave_destroy_skipped_for_singleton/);
  assert.match(webVideoCall, /leave_called: Boolean\(callObject\) && !shouldParkLiveSingleton/);
  assert.match(webVideoCall, /destroy_called: Boolean\(callObject\) && !shouldParkLiveSingleton/);
  assert.match(webVideoCall, /daily_join_skipped_singleton_already_joined/);
  assert.match(webVideoCall, /daily_join_completed_by_singleton_inflight/);
});

test("web visibilitychange is soft telemetry while Daily is active or starting", () => {
  const lifecycleBlock = block(
    webVideoDate,
    /Browser lifecycle/,
    /Record user's explicit handshake decision/,
  );

  assert.match(lifecycleBlock, /shouldTreatLifecycleAwayAsSoftTelemetry/);
  assert.match(lifecycleBlock, /source !== "visibilitychange"/);
  assert.match(lifecycleBlock, /localInDailyRoom \|\| isConnecting \|\| isConnected/);
  assert.match(lifecycleBlock, /dailyMeetingState === "joining-meeting" \|\| dailyMeetingState === "joined-meeting"/);
  assert.match(lifecycleBlock, /web_lifecycle_away_suppressed_active_daily/);
  assert.match(lifecycleBlock, /send_suppressed/);
  assert.match(lifecycleBlock, /schedule_suppressed/);
  assert.match(lifecycleBlock, /sendLeaveSignal\("beforeunload"\)/);
  assert.match(lifecycleBlock, /sendLeaveSignal\("pagehide"\)/);
});

test("native background only sends backend away after local grace expiry", () => {
  const backgroundBlock = block(
    nativeDateRoute,
    /if \(next === 'background' \|\| next === 'inactive'\)/,
    /requestReconnectSyncRef\.current\('app_background'\)/,
  );

  assert.match(backgroundBlock, /native_background_grace_started/);
  assert.match(backgroundBlock, /await cleanupDailyAndLocalState\(\)/);
  assert.doesNotMatch(backgroundBlock, /signalVideoDateLeave\(sessionId, 'app_background'\)/);
  assert.match(backgroundBlock, /signalVideoDateLeave\(sessionId, 'app_background_timeout'\)/);
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
