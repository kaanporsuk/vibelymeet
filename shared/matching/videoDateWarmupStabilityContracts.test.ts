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
