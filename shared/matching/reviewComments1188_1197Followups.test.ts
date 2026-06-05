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

test("web date route ownership refresh is tied to real Daily ownership, not optimistic phase", () => {
  const effectStart = webDateRoute.indexOf("const shouldOwnDateRoute =");
  assert.notEqual(effectStart, -1, "date route ownership effect should exist");
  const effectEnd = webDateRoute.indexOf("if (!shouldOwnDateRoute) return;", effectStart);
  assert.notEqual(effectEnd, -1, "ownership guard should check shouldOwnDateRoute");
  const ownershipGate = webDateRoute.slice(effectStart, effectEnd);

  assert.match(ownershipGate, /isConnecting/);
  assert.match(ownershipGate, /isConnected/);
  assert.match(ownershipGate, /localInDailyRoom/);
  assert.match(ownershipGate, /dailyMeetingState === "joined-meeting"/);
  assert.doesNotMatch(ownershipGate, /phase === "handshake"/);
  assert.doesNotMatch(ownershipGate, /phase === "date"/);
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

test("remote-seen clients restamp reconnect observations instead of once-per-session gating", () => {
  for (const [name, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS = 10_000/);
    assert.match(source, /remoteSeenInFlightSessionRef/);
    assert.match(source, /remoteSeenLastStampRef/);
    assert.match(source, /source === ['"]participant_joined['"]/);
    assert.doesNotMatch(source, /remoteSeenStampedSessionRef/);
  }
});

test("first-remote watchdog does not suppress peer-missing on historical remote-seen truth", () => {
  for (const [name, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /hasHistoricalRemoteSeenTruth/);
    assert.match(source, /historical_remote_seen_truth/);
    assert.doesNotMatch(source, /peer_missing_suppressed_remote_seen/);
    assert.doesNotMatch(source, /if \(hasTerminalSurveyTruth \|\| hasRemoteSeenTruth\)/);
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
