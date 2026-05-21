import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyVideoDateTimelineSnapshot,
  resolveVideoDateSnapshotRecovery,
  resolveVideoDateTimelineCountdown,
  videoDateTimelineFromSnapshot,
} from "./videoDateTimeline";
import type { VideoDateSnapshotOk } from "./videoDateSnapshot";

const root = process.cwd();
const timeline = readFileSync(join(root, "shared/matching/videoDateTimeline.ts"), "utf8");
const webDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const nativeDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const webReadyRedirect = readFileSync(join(root, "src/pages/ReadyRedirect.tsx"), "utf8");
const nativeReadyRedirect = readFileSync(join(root, "apps/mobile/app/ready/[id].tsx"), "utf8");
const nativeNotificationDeepLink = readFileSync(join(root, "apps/mobile/components/NotificationDeepLinkHandler.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const baseSnapshot: VideoDateSnapshotOk = {
  ok: true,
  sessionId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  seq: 8,
  serverNow: Date.parse("2026-05-21T18:00:00.000Z"),
  phase: "handshake",
  phaseStartedAt: Date.parse("2026-05-21T17:59:30.000Z"),
  phaseDeadlineAt: Date.parse("2026-05-21T18:00:30.000Z"),
  allowedActions: ["continue", "pass", "end_call"],
  participants: [],
  room: {
    name: "date-11111111111141118111111111111111",
    url: "https://example.daily.co/date-11111111111141118111111111111111",
    tokenRequired: true,
  },
  endedReason: null,
  endedAt: null,
};

test("PR 5.1 timeline reducer derives countdown from phaseDeadlineAt plus server clock skew", () => {
  const clientNowMs = Date.parse("2026-05-21T17:59:55.000Z");
  const state = videoDateTimelineFromSnapshot(baseSnapshot, { clientNowMs });
  assert.equal(state.clockSkewMs, 5_000);

  const countdown = resolveVideoDateTimelineCountdown(state, {
    clientNowMs: Date.parse("2026-05-21T18:00:10.000Z"),
  });
  assert.equal(countdown.deadlineMs, baseSnapshot.phaseDeadlineAt);
  assert.equal(countdown.remainingSeconds, 15);
  assert.equal(countdown.durationMs, 60_000);
  assert.ok(countdown.progress > 0.24 && countdown.progress < 0.26);

  const stale = applyVideoDateTimelineSnapshot({ ...baseSnapshot, seq: 7 }, state);
  assert.equal(stale.action, "stale");
  assert.equal(stale.timeline?.seq, 8);

  const mismatch = applyVideoDateTimelineSnapshot(baseSnapshot, state, {
    expectedSessionId: "33333333-3333-4333-8333-333333333333",
  });
  if (mismatch.action !== "invalid") {
    assert.fail(`expected invalid mismatch, got ${mismatch.action}`);
  }
  assert.equal(mismatch.reason, "session_mismatch");
});

test("PR 5.2 web and native date surfaces use the timeline flag with fallback countdown intact", () => {
  for (const source of [webDate, nativeDate]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.timeline_v2["']\)/);
    assert.match(source, /resolveVideoDateTimelineCountdown/);
    assert.match(source, /resolveVideoDatePhaseCountdown/);
    assert.match(source, /timelineV2\.enabled/);
  }
  assert.match(webDate, /applyVideoDateTimelineSnapshot/);
  assert.match(webDate, /includeToken: false/);
  assert.match(webDate, /expectedSessionId: id/);
  assert.match(webDate, /const countdown = useTimelineCountdown[\s\S]+resolveVideoDateTimelineCountdown/);
  assert.match(webDate, /timeline\.seq < sessionSeqRef\.current/);
  assert.match(webDate, /Math\.max\(sessionSeqRef\.current \?\? 0, snapshot\.seq\)/);
  assert.match(nativeVideoDateApi, /applyVideoDateTimelineSnapshot/);
  assert.match(nativeVideoDateApi, /includeToken: false/);
  assert.match(nativeVideoDateApi, /expectedSessionId: sessionId/);
  assert.match(nativeVideoDateApi, /if \(timelineV2\.enabled\)[\s\S]+applyVideoDateTimelineSnapshot/);
  assert.match(nativeVideoDateApi, /currentSessionKeyRef/);
  assert.match(nativeVideoDateApi, /const legacyResolved = resolvePhaseAndTime\(s\)[\s\S]+setPhase\(legacyResolved\.phase\)[\s\S]+void \(async \(\) =>/);
  assert.match(nativeVideoDateApi, /decision\.timeline\.seq < sessionSeqRef\.current/);
  assert.match(nativeVideoDateApi, /timelineDecision\.timeline\.seq >= sessionSeqRef\.current/);
  assert.match(nativeVideoDateApi, /Math\.max\(sessionSeqRef\.current \?\? 0, snapshot\.seq\)/);
  assert.match(nativeVideoDateApi, /return \{ session, partner, phase, timeLeft, timeline,/);
});

test("PR 5.3 push and deep-link recovery share one snapshot decision helper", () => {
  const dateRecovery = resolveVideoDateSnapshotRecovery(baseSnapshot);
  assert.deepEqual(dateRecovery, {
    action: "date",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "handshake",
  });

  const readyRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ready_gate",
    room: null,
  });
  assert.deepEqual(readyRecovery, {
    action: "ready_gate",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId!,
    reason: "ready_gate",
  });

  const endedRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ended",
    room: null,
    endedAt: baseSnapshot.phaseDeadlineAt,
    endedReason: "handshake_timeout",
  });
  assert.equal(endedRecovery.action, "lobby");
  assert.equal(endedRecovery.reason, "ended");

  const mismatchRecovery = resolveVideoDateSnapshotRecovery(baseSnapshot, {
    expectedSessionId: "33333333-3333-4333-8333-333333333333",
  });
  if (mismatchRecovery.action !== "invalid") {
    assert.fail(`expected invalid recovery mismatch, got ${mismatchRecovery.action}`);
  }
  assert.equal(mismatchRecovery.reason, "session_mismatch");

  assert.match(webReadyRedirect, /resolveVideoDateSnapshotRecovery/);
  assert.match(webReadyRedirect, /expectedSessionId: candidate/);
  assert.match(nativeReadyRedirect, /resolveVideoDateSnapshotRecovery/);
  assert.match(nativeReadyRedirect, /expectedSessionId: String\(sessionId\)/);
  assert.match(nativeNotificationDeepLink, /resolveVideoDateSnapshotRecovery/);
  assert.match(nativeNotificationDeepLink, /fetchVideoDateSnapshot\(sid, \{ includeToken: false \}\)/);
  assert.match(nativeNotificationDeepLink, /expectedSessionId: sid/);
  assert.match(nativeNotificationDeepLink, /snapshotRecoveryV2: snapshotV2\.enabled/);
  assert.match(nativeNotificationDeepLink, /queue drain and stale-ended recovery stay intact/);
  assert.doesNotMatch(timeline, /token|DAILY_API_KEY|meeting[_-]?token/i);
});

test("PR 5.4 terminal survey snapshots route to date recovery without losing stale-ended fallback", () => {
  const verdictRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "verdict",
    room: null,
  });
  assert.deepEqual(verdictRecovery, {
    action: "survey",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "verdict",
  });

  const terminalEncounterRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ended",
    room: null,
    endedAt: baseSnapshot.phaseDeadlineAt,
    endedReason: "date_timeout",
    participants: [
      { id: "self", isSelf: true, isPartner: false, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
      { id: "partner", isSelf: false, isPartner: true, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
    ],
  });
  assert.deepEqual(terminalEncounterRecovery, {
    action: "survey",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "terminal_encounter",
  });

  const dailyJoinEvidenceLossRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ended",
    room: null,
    endedAt: baseSnapshot.phaseDeadlineAt,
    endedReason: "date_timeout",
    participants: [
      { id: "self", isSelf: true, isPartner: false, mediaJoinedAt: null, awayAt: null },
      { id: "partner", isSelf: false, isPartner: true, mediaJoinedAt: null, awayAt: null },
    ],
  });
  assert.deepEqual(dailyJoinEvidenceLossRecovery, {
    action: "survey",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "terminal_encounter",
  });

  const partialJoinRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ended",
    room: null,
    endedAt: baseSnapshot.phaseDeadlineAt,
    endedReason: "partial_join_peer_timeout",
    participants: [
      { id: "self", isSelf: true, isPartner: false, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
      { id: "partner", isSelf: false, isPartner: true, mediaJoinedAt: null, awayAt: null },
    ],
  });
  assert.equal(partialJoinRecovery.action, "lobby");
  assert.equal(partialJoinRecovery.reason, "ended");

  const ineligibleReasonOutranksMediaEvidence = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "ended",
    room: null,
    endedAt: baseSnapshot.phaseDeadlineAt,
    endedReason: "blocked_pair",
    participants: [
      { id: "self", isSelf: true, isPartner: false, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
      { id: "partner", isSelf: false, isPartner: true, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
    ],
  });
  assert.equal(ineligibleReasonOutranksMediaEvidence.action, "lobby");
  assert.equal(ineligibleReasonOutranksMediaEvidence.reason, "ended");

  assert.match(webReadyRedirect, /recovery\.action === ["']date["'] \|\| recovery\.action === ["']survey["']/);
  assert.match(nativeReadyRedirect, /recovery\.action === ["']survey["'][\s\S]+navigateToDateSessionGuarded/);
  assert.match(nativeNotificationDeepLink, /recovery\.action === ["']date["'] \|\| recovery\.action === ["']survey["']/);
});

test("PR 5.5 active multi-device snapshots are explicit rejoin decisions", () => {
  const rejoinRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "date",
    participants: [
      { id: "self", isSelf: true, isPartner: false, mediaJoinedAt: baseSnapshot.phaseStartedAt, awayAt: null },
      { id: "partner", isSelf: false, isPartner: true, mediaJoinedAt: null, awayAt: null },
    ],
  });
  assert.deepEqual(rejoinRecovery, {
    action: "date",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "already_joined",
  });

  assert.match(nativeNotificationDeepLink, /decision: recovery\.action === ["']survey["'] \? ["']navigate_survey["'] : ["']navigate_date["']/);
});

test("PR 5.6 queued and retryable snapshots do not bypass queue/lobby recovery", () => {
  const queuedRecovery = resolveVideoDateSnapshotRecovery({
    ...baseSnapshot,
    phase: "queued",
    room: null,
  });
  assert.deepEqual(queuedRecovery, {
    action: "lobby",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId!,
    reason: "queued",
  });

  const retryableRecovery = resolveVideoDateSnapshotRecovery({
    ok: false,
    error: "snapshot_function_failed",
    retryable: true,
  });
  assert.deepEqual(retryableRecovery, {
    action: "home",
    sessionId: null,
    reason: "snapshot_retryable",
  });

  assert.match(nativeNotificationDeepLink, /Retryable failures, queued rescue, and non-survey terminal states/);
});

test("Phase 5 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase5TimelineContracts\.test\.ts/);
});
