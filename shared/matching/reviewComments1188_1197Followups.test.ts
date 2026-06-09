import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webDateRoute = read("src/pages/VideoDate.tsx");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const markReadyFollowup = read("supabase/migrations/20260604131708_review_comments_1183_1188_followups.sql");
const latestPresenceRepair = read("supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql");
const remoteSeenLatestState = read("supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql");
const packageJson = read("package.json");

test("web date route ownership starts from allowed route access, not optimistic phase or Daily state", () => {
  const effectStart = webDateRoute.indexOf(
    'if (!id || !user?.id || videoDateAccess !== "allowed") return;',
  );
  assert.notEqual(effectStart, -1, "date route ownership effect should exist");
  const effectEnd = webDateRoute.indexOf("}, [", effectStart);
  assert.notEqual(effectEnd, -1, "ownership effect should include a dependency list");
  const ownershipEffect = webDateRoute.slice(effectStart, effectEnd);

  assert.match(ownershipEffect, /if \(dupBlocked\) return;/);
  assert.match(ownershipEffect, /markVideoDateRouteOwned\(id, user\.id\)/);
  assert.match(ownershipEffect, /VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS/);
  assert.doesNotMatch(ownershipEffect, /shouldOwnDateRoute/);
  assert.doesNotMatch(ownershipEffect, /phase === "handshake"/);
  assert.doesNotMatch(ownershipEffect, /phase === "date"/);
  assert.doesNotMatch(ownershipEffect, /isConnecting/);
  assert.doesNotMatch(ownershipEffect, /isConnected/);
  assert.doesNotMatch(ownershipEffect, /callStarted/);
  assert.doesNotMatch(ownershipEffect, /dailyMeetingState/);
  assert.doesNotMatch(ownershipEffect, /localInDailyRoom/);
  assert.doesNotMatch(ownershipEffect, /dateStartedAt/);
});

test("terminal survey recovery tears down Daily before showing survey", () => {
  assert.match(webDateRoute, /terminalDailyStopRef/);
  assert.match(webDateRoute, /terminalDailyStopRequestedRef/);
  assert.match(webDateRoute, /void endCall\(`terminal_survey_hard_stop:\$\{reason\}`\)/);
  assert.ok(
    webDateRoute.indexOf("enterTerminalSurveyHardStop") < webDateRoute.indexOf("hydrateTerminalSurveyContext"),
    "terminal recovery should hard-stop before hydrating/opening survey state",
  );
});

test("remote-seen clients restamp render observations instead of once-per-session gating", () => {
  for (const [name, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS = 10_000/);
    assert.match(source, /remoteSeenInFlightSessionRef/);
    assert.match(source, /remoteSeenLastStampRef/);
    assert.match(source, /const baseEvidenceSource = source;/, name);
    assert.match(source, /p_evidence_source: baseEvidenceSource/, name);
    assert.match(source, /source: attemptSource/, name);
    assert.match(source, /source === ['"]remote_track_mounted['"]/, name);
    assert.doesNotMatch(source, /source === ['"]participant_joined['"]/, name);
    assert.doesNotMatch(source, /source === ['"]post_join_snapshot['"]/, name);
    assert.doesNotMatch(source, /source === ['"]shared_call_snapshot['"]/, name);
    assert.doesNotMatch(source, /remoteSeenStampedSessionRef/);
  }

  assert.match(webVideoCall, /source === ['"]loadeddata['"]/);
  assert.match(webVideoCall, /source === ['"]playing['"]/);
  assert.doesNotMatch(webVideoCall, /markRemoteSeenOnServer\(["']participant_joined["']\)/);
  assert.doesNotMatch(webVideoCall, /markRemoteSeenOnServer\(["']post_join_snapshot["']\)/);
  assert.doesNotMatch(nativeDateRoute, /markRemoteSeenOnServerRef\.current\?\.\(["']participant_joined["']\)/);
  assert.doesNotMatch(nativeDateRoute, /markRemoteSeenOnServerRef\.current\?\.\(["']shared_call_snapshot["']\)/);
});

test("first-remote watchdog suppresses terminal peer-missing on historical encounter truth", () => {
  for (const [name, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /hasHistoricalRemoteSeenTruth/);
    assert.match(source, /historical_remote_seen_truth/);
    assert.match(source, /daily_no_remote_watchdog_historical_truth_suppressed/);
    assert.match(source, /peer_missing_suppressed_remote_seen/);
    assert.match(source, /reason_code: ["']historical_remote_seen_truth["']/);
    assert.doesNotMatch(source, /daily_no_remote_watchdog_historical_truth_requires_current_peer/);
  }
});

test("SQL review follow-ups remain backed by latest replacement migrations", () => {
  assert.match(markReadyFollowup, /SELECT MIN\(vsc\.created_at\)/);
  assert.match(markReadyFollowup, /original_attempt_cap_applied/);
  assert.match(markReadyFollowup, /Caps grace to the participant original mark-ready command/);

  assert.match(latestPresenceRepair, /video_date_latest_presence_is_active/);
  assert.match(latestPresenceRepair, /participant_1_joined_at = GREATEST\(COALESCE\(participant_1_joined_at, v_now\), v_now\)/);
  assert.match(latestPresenceRepair, /participant_2_joined_at = GREATEST\(COALESCE\(participant_2_joined_at, v_now\), v_now\)/);
  assert.match(latestPresenceRepair, /v_remote_seen_after_away/);

  assert.match(remoteSeenLatestState, /participant_1_remote_seen_at = GREATEST\(COALESCE\(participant_1_remote_seen_at, v_now\), v_now\)/);
  assert.match(remoteSeenLatestState, /participant_2_remote_seen_at = GREATEST\(COALESCE\(participant_2_remote_seen_at, v_now\), v_now\)/);
  assert.match(remoteSeenLatestState, /advances the timestamp on every observation/);
});

test("review follow-up contracts stay in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/reviewComments1188_1197Followups\.test\.ts/);
});
