import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyVideoDateTimelineSnapshot,
  resolveVideoDateTimelineCountdown,
  videoDateTimelineFromSnapshot,
} from "./videoDateTimeline";
import type { VideoDateSnapshotOk } from "./videoDateSnapshot";

const root = process.cwd();
const webDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webCall = readFileSync(join(root, "src/hooks/useVideoCall.ts"), "utf8");
const nativeDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const baseSnapshot: VideoDateSnapshotOk = {
  ok: true,
  sessionId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  seq: 42,
  serverNow: Date.parse("2026-05-25T19:00:00.000Z"),
  phase: "date",
  phaseStartedAt: Date.parse("2026-05-25T18:59:00.000Z"),
  phaseDeadlineAt: Date.parse("2026-05-25T19:04:00.000Z"),
  allowedActions: ["end_call", "extend_date"],
  participants: [],
  room: {
    name: "date-11111111111141118111111111111111",
    url: "https://example.daily.co/date-11111111111141118111111111111111",
    tokenRequired: true,
  },
  endedReason: null,
  endedAt: null,
};

function sourceBlock(source: string, needle: string, length = 3_500): string {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `missing source needle: ${needle}`);
  return source.slice(index, index + length);
}

test("Sprint 4 timeline reducer rejects impossible active deadlines and keeps extension deadlines authoritative", () => {
  const invalid = applyVideoDateTimelineSnapshot(
    {
      ...baseSnapshot,
      phaseStartedAt: Date.parse("2026-05-25T19:00:00.000Z"),
      phaseDeadlineAt: Date.parse("2026-05-25T19:00:00.000Z"),
    },
    null,
    { expectedSessionId: baseSnapshot.sessionId },
  );
  assert.equal(invalid.action, "invalid");
  if (invalid.action !== "invalid") assert.fail("expected invalid active deadline");
  assert.equal(invalid.reason, "invalid_phase_deadline");

  const missingDeadline = applyVideoDateTimelineSnapshot(
    {
      ...baseSnapshot,
      phaseDeadlineAt: null,
    },
    null,
    { expectedSessionId: baseSnapshot.sessionId },
  );
  assert.equal(missingDeadline.action, "invalid");
  if (missingDeadline.action !== "invalid") assert.fail("expected missing deadline to be invalid");
  assert.equal(missingDeadline.reason, "missing_phase_deadline");

  const missingStart = applyVideoDateTimelineSnapshot(
    {
      ...baseSnapshot,
      phaseStartedAt: null,
    },
    null,
    { expectedSessionId: baseSnapshot.sessionId },
  );
  assert.equal(missingStart.action, "invalid");
  if (missingStart.action !== "invalid") assert.fail("expected missing start to be invalid");
  assert.equal(missingStart.reason, "missing_phase_started_at");

  const startedAt = Date.parse("2026-05-25T19:00:00.000Z");
  const extended = videoDateTimelineFromSnapshot(
    {
      ...baseSnapshot,
      serverNow: startedAt,
      phaseStartedAt: startedAt,
      phaseDeadlineAt: startedAt + 7 * 60 * 1000,
    },
    { clientNowMs: startedAt },
  );
  const countdown = resolveVideoDateTimelineCountdown(extended, {
    clientNowMs: startedAt + 2 * 60 * 1000,
  });
  assert.equal(countdown.durationMs, 7 * 60 * 1000);
  assert.equal(countdown.remainingSeconds, 5 * 60);

  const ended = resolveVideoDateTimelineCountdown({
    ...extended,
    phase: "ended",
    endedAtMs: startedAt + 7 * 60 * 1000,
    endedReason: "date_timeout",
  });
  assert.equal(ended.remainingSeconds, 0);
  assert.equal(ended.hasAuthoritativeStart, false);
});

test("Sprint 4 web terminal paths cannot open post-date survey from local optimism", () => {
  assert.match(webDate, /confirmTerminalPostDateSurveyFromServerTruth/);
  assert.match(webDate, /TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS/);
  assert.match(webDate, /TERMINAL_SURVEY_SESSION_SELECT/);
  assert.match(webDate, /videoSessionIndicatesTerminalEnd\(sessionRow\)/);
  assert.match(webDate, /terminal_post_date_survey_session_fetch_failed/);
  assert.match(webDate, /terminal_post_date_survey_verdict_fetch_failed/);
  assert.match(
    webDate,
    /captureSupabaseError\(\s*["']terminal_post_date_survey_verdict_fetch_failed["'],\s*verdictError,\s*\)/,
  );
  assert.match(
    webDate,
    /recoverTerminalPostDateSurvey\(\s*attemptSource,\s*sessionRow,\s*\)/,
  );
  assert.match(webDate, /terminal_post_date_survey_confirmation_row_unavailable/);
  assert.match(
    webDate,
    /select\(TERMINAL_SURVEY_SESSION_SELECT\)[\s\S]*recoverTerminalPostDateSurvey\(\s*["']local_end_recovered_after_rpc_error["'],\s*sessionRow,\s*\)/,
  );
  assert.match(
    webDate,
    /fetchVideoDateSnapshot\(id,\s*\{\s*includeToken: false,\s*\}\)/,
  );
  assert.match(webDate, /setTimingRefreshNonce\(\(n\) => n \+ 1\)/);
  assert.match(webDate, /terminal_confirmation_missing/);
  assert.match(webDate, /safety_report_server_ended/);
  assert.doesNotMatch(webDate, /openPostDateSurvey\(["']local_end["']\)/);
  assert.equal(webDate.includes("recoverTerminalPostDateSurvey(`${attemptSource}_snapshot_terminal`)"), false);
});

test("Sprint 4 web manual pre-date exit retries failed server end in the background", () => {
  assert.match(webDate, /retryPreDateManualEndInBackground/);
  assert.match(webDate, /serverEnd\.status !== "completed"[\s\S]+retryPreDateManualEndInBackground\(reason, source, serverEnd\.status\)/);
  assert.match(webDate, /video_date_pre_date_exit_end_background_retry_succeeded/);
  assert.match(webDate, /video_date_pre_date_exit_end_background_retry_failed/);
  assert.match(webDate, /video_date_pre_date_exit_end_background_retry_exception/);
  assert.match(
    webDate,
    /Sentry\.captureMessage\(\s*["']video_date_pre_date_exit_end_background_retry_failed["']/,
  );
});

test("Sprint 4 native terminal paths cannot grant survey without terminal DB truth", () => {
  assert.match(nativeDate, /confirmNativeTerminalPostDateRecovery/);
  assert.match(nativeDate, /NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS/);
  assert.match(nativeDate, /nativeVideoSessionIndicatesTerminalEnd/);
  assert.match(
    nativeDate,
    /openNativePostDateSurveyFromTerminalTruth\(\s*attemptSource,\s*sessionRow,\s*\)/,
  );
  assert.match(nativeDate, /terminal_post_date_survey_confirmation_row_unavailable/);
  assert.match(nativeDate, /app_foreground_after_background_timeout/);
  assert.match(nativeDate, /native_background_timeout_end_result/);
  assert.match(nativeDate, /terminal_no_survey_truth/);
  assert.doesNotMatch(nativeDate, /if \(!recoveredSurvey\) setShowFeedback\(true\)/);
});

test("Sprint 4 Daily joined confirmation failures do not create or block survey eligibility", () => {
  const webJoinedBlock = sourceBlock(webCall, "void markDailyJoinedWithBackoff({", 7_000);
  assert.match(webJoinedBlock, /daily_join_confirmation_failed/);
  assert.match(webJoinedBlock, /emitWebVideoDateClientStuckState/);
  assert.doesNotMatch(webJoinedBlock, /openPostDateSurvey|setShowFeedback\(true\)|surveyOpenedRef/);

  const nativeJoinedBlock = sourceBlock(nativeDate, "void markDailyJoinedWithBackoff({", 7_000);
  assert.match(nativeJoinedBlock, /daily_join_confirmation_failed/);
  assert.match(nativeJoinedBlock, /emitNativeVideoDateClientStuckState/);
  assert.match(nativeJoinedBlock, /refetchVideoSession\(\)/);
  assert.doesNotMatch(nativeJoinedBlock, /openNativePostDateSurveyFromTerminalTruth|setShowFeedback\(true\)|surveyOpenedRef/);
});

test("Sprint 4 duplicate web start attempts wait for the real in-flight result", () => {
  assert.match(webCall, /START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS/);
  assert.match(webCall, /waitForInFlightStartCall/);
  const duplicateBlock = sourceBlock(webCall, /reason: "start_call_already_in_flight"/.source, 1_200);
  assert.match(duplicateBlock, /return waitForInFlightStartCall\(sessionId, eventId, userId\)/);
  assert.doesNotMatch(duplicateBlock, /return \{ ok: true \}/);
  assert.match(webCall, /start_call_in_flight_resolved_joined/);
  assert.match(webCall, /start_call_in_flight_failed/);
  assert.match(
    webCall,
    /return await startCall\(sessionId, \{\s*internalRetry: true,\s*mediaPromptIntent,\s*\}\)/,
  );
});

test("Sprint 4 runtime recovery contracts cover timeout, reconnect, slow join, first frame, extensions, and abort cleanup", () => {
  assert.match(webDate, /handleCallEndRef\.current\?\.\("date_timeout"\)/);
  assert.match(nativeDate, /handleCallEnd\(["']local_end["'], ["']date_timeout["']\)/);
  assert.match(webDate, /TERMINAL_SURVEY_RECONCILE_INTERVAL_MS/);
  assert.match(nativeDate, /syncVideoDateReconnect/);
  assert.match(nativeDate, /NATIVE_BACKGROUND_GRACE_MS/);
  assert.match(webCall, /FIRST_REMOTE_TIMEOUT_MS = 25_000/);
  assert.match(nativeDate, /FIRST_CONNECT_TIMEOUT_MS = 25000/);
  assert.match(nativeDate, /MIN_DECISION_WINDOW_AFTER_MEDIA_MS = 15_000/);
  assert.match(webDate, /effectiveDateDurationSeconds\(DATE_TIME, dateExtraSeconds\)/);
  assert.match(nativeDate, /effectiveDateDurationSeconds\(DATE_SECONDS, session\?\.date_extra_seconds\)/);
  assert.match(nativeDate, /cleanupForAbortWithoutServerEnd/);
  assert.match(webDate, /runVideoDateManualExitStep/);
});

test("Sprint 4 contracts are wired into the video-date v4 suite", () => {
  assert.match(packageJson, /videoDateSprint4RuntimeRecoveryContracts\.test\.ts/);
});
