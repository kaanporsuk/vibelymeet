import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
  isVideoDateReadyGateActiveStatus,
  isVideoDateReadyGateTerminalStatus,
  nativePathForCanonicalVideoDateRoute,
  normalizeVideoDateReadyGateStatus,
  webPathForCanonicalVideoDateRoute,
  type VideoDateCanonicalRouteTarget,
  type VideoDateRouteSessionTruth,
} from "./videoDateRouteDecision";

import { readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const NOW_MS = Date.parse("2026-05-25T12:00:00.000Z");
const SESSION_ID = "session-1";
const EVENT_ID = "event-1";
const PROVIDER_ROOM = {
  daily_room_name: "vibely-session-1",
  daily_room_url: "https://vibely.daily.co/vibely-session-1",
};

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function session(
  overrides: Partial<VideoDateRouteSessionTruth> = {},
): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    ended_at: null,
    state: "ready_gate",
    phase: "ready_gate",
    ready_gate_status: "ready",
    ready_gate_expires_at: "2026-05-25T12:00:30.000Z",
    ...overrides,
  };
}

function assertDecisionParity(input: {
  label: string;
  expectedTarget: VideoDateCanonicalRouteTarget;
  truth?: VideoDateRouteSessionTruth | null;
  registration?: Parameters<typeof decideCanonicalVideoDateRoute>[0]["registration"];
  serverNextSurface?: Parameters<typeof decideCanonicalVideoDateRoute>[0]["serverNextSurface"];
  webPath: string;
  nativePath: string;
}) {
  const decision = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: input.truth,
    registration: input.registration,
    serverNextSurface: input.serverNextSurface,
    nowMs: NOW_MS,
  });

  assert.equal(decision.target, input.expectedTarget, input.label);
  assert.equal(webPathForCanonicalVideoDateRoute(decision), input.webPath, input.label);
  assert.equal(nativePathForCanonicalVideoDateRoute(decision), input.nativePath, input.label);
}

test("Sprint 1 canonical contract routes direct ready links from server truth", () => {
  assertDecisionParity({
    label: "direct /ready/:id with live ready gate",
    expectedTarget: "ready_gate",
    truth: session({ ready_gate_status: "ready_a" }),
    webPath: `/ready/${SESSION_ID}`,
    nativePath: `/ready/${SESSION_ID}`,
  });
});

test("Sprint 1 canonical contract routes direct date links only when provider room truth exists", () => {
  assertDecisionParity({
    label: "direct /date/:id with provider-prepared handshake",
    expectedTarget: "date",
    truth: session({
      ...PROVIDER_ROOM,
      state: "handshake",
      phase: "entry",
      entry_started_at: "2026-05-25T11:59:50.000Z",
      ready_gate_status: "both_ready",
    }),
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });
});

test("Sprint 1 canonical contract keeps both_ready handoff on date while Daily prepares", () => {
  assertDecisionParity({
    label: "both_ready handoff without provider room",
    expectedTarget: "date",
    truth: session({
      state: "ready_gate",
      phase: "ready_gate",
      ready_gate_status: "both_ready",
    }),
    registration: {
      event_id: EVENT_ID,
      current_room_id: SESSION_ID,
      queue_status: "in_handshake",
    },
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });
});

test("Sprint 1 canonical contract routes stale ready gate sessions to lobby", () => {
  assertDecisionParity({
    label: "expired ready gate window",
    expectedTarget: "lobby",
    truth: session({
      ready_gate_status: "ready_b",
      ready_gate_expires_at: "2026-05-25T11:59:59.000Z",
    }),
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });
});

test("Sprint 1 canonical contract separates ended sessions from pending post-date surveys", () => {
  assertDecisionParity({
    label: "terminal without encounter exposure",
    expectedTarget: "ended",
    truth: session({
      ended_at: "2026-05-25T12:00:01.000Z",
      state: "ended",
      phase: "ended",
      ready_gate_status: "expired",
      ended_reason: "ready_gate_expired",
    }),
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });

  assertDecisionParity({
    label: "terminal encounter with missing feedback",
    expectedTarget: "survey",
    truth: session({
      ...PROVIDER_ROOM,
      ended_at: "2026-05-25T12:00:01.000Z",
      ended_reason: "date_timeout",
      state: "ended",
      phase: "ended",
      date_started_at: "2026-05-25T11:55:00.000Z",
      participant_1_joined_at: "2026-05-25T11:55:05.000Z",
      participant_2_joined_at: "2026-05-25T11:55:06.000Z",
      participant_1_remote_seen_at: "2026-05-25T11:55:07.000Z",
      participant_2_remote_seen_at: "2026-05-25T11:55:08.000Z",
    }),
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });

  assertDecisionParity({
    label: "reconnect grace terminal with bilateral Daily exposure opens survey",
    expectedTarget: "survey",
    truth: session({
      ...PROVIDER_ROOM,
      ended_at: "2026-05-25T12:00:20.000Z",
      ended_reason: "reconnect_grace_expired",
      state: "ended",
      phase: "ended",
      date_started_at: null,
      participant_1_joined_at: "2026-05-25T12:00:04.000Z",
      participant_2_joined_at: "2026-05-25T12:00:06.000Z",
      participant_1_remote_seen_at: "2026-05-25T12:00:07.000Z",
      participant_2_remote_seen_at: "2026-05-25T12:00:08.000Z",
    }),
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });
});

test("Sprint 1 canonical contract blocks no-provider-room date entry from stale video registration", () => {
  assertDecisionParity({
    label: "registration says in_date but Daily room is missing",
    expectedTarget: "lobby",
    truth: session({
      state: "handshake",
      phase: "entry",
      ready_gate_status: "queued",
      entry_started_at: "2026-05-25T11:59:50.000Z",
    }),
    registration: {
      event_id: EVENT_ID,
      current_room_id: SESSION_ID,
      queue_status: "in_date",
    },
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });
});

test("Sprint 1 Ready Gate status taxonomy is normalized consistently", () => {
  for (const status of ["ready", "ready_a", "ready_b", "both_ready", "snoozed"] as const) {
    assert.equal(isVideoDateReadyGateActiveStatus(status), true, status);
  }
  for (const status of ["forfeited", "expired"] as const) {
    assert.equal(isVideoDateReadyGateActiveStatus(status), false, status);
    assert.equal(isVideoDateReadyGateTerminalStatus(status), true, status);
  }
  assert.equal(normalizeVideoDateReadyGateStatus(" ONE_READY "), "ready");
  assert.equal(normalizeVideoDateReadyGateStatus(" Both_Ready "), "both_ready");
});

test("Sprint 1 server next-surface actions use the same canonical targets on web and native", () => {
  const cases: Array<{
    action: string;
    expectedTarget: VideoDateCanonicalRouteTarget;
    webPath: string;
    nativePath: string;
    targetId?: string;
  }> = [
    { action: "ready_gate", expectedTarget: "ready_gate", webPath: `/ready/${SESSION_ID}`, nativePath: `/ready/${SESSION_ID}` },
    { action: "video_date", expectedTarget: "date", webPath: `/date/${SESSION_ID}`, nativePath: `/date/${SESSION_ID}` },
    { action: "survey", expectedTarget: "survey", webPath: `/date/${SESSION_ID}`, nativePath: `/date/${SESSION_ID}` },
    { action: "chat", expectedTarget: "chat", webPath: "/chat/user-b", nativePath: "/chat/user-b", targetId: "user-b" },
    { action: "lobby", expectedTarget: "lobby", webPath: `/event/${EVENT_ID}/lobby`, nativePath: `/event/${EVENT_ID}/lobby` },
    { action: "wrap_up", expectedTarget: "ended", webPath: `/event/${EVENT_ID}/lobby`, nativePath: `/event/${EVENT_ID}/lobby` },
    { action: "home", expectedTarget: "home", webPath: "/home", nativePath: "/(tabs)" },
  ];

  for (const item of cases) {
    assertDecisionParity({
      label: `server next surface ${item.action}`,
      expectedTarget: item.expectedTarget,
      serverNextSurface: {
        action: item.action,
        eventId: EVENT_ID,
        nextSessionId: SESSION_ID,
        targetId: item.targetId,
      },
      webPath: item.webPath,
      nativePath: item.nativePath,
    });
  }
});

test("Sprint 1 server next-surface video routes cannot override contradictory fetched truth", () => {
  assertDecisionParity({
    label: "server video_date with fetched no-provider truth falls back to lobby",
    expectedTarget: "lobby",
    truth: session({
      state: "handshake",
      phase: "entry",
      ready_gate_status: "queued",
      entry_started_at: "2026-05-25T11:59:50.000Z",
    }),
    serverNextSurface: {
      action: "video_date",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });

  assertDecisionParity({
    label: "server ready_gate with fetched stale ready truth falls back to lobby",
    expectedTarget: "lobby",
    truth: session({
      ready_gate_status: "ready",
      ready_gate_expires_at: "2026-05-25T11:59:59.000Z",
    }),
    serverNextSurface: {
      action: "ready_gate",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });

  assertDecisionParity({
    label: "server survey with fetched no-remote-video truth falls back to ended",
    expectedTarget: "ended",
    truth: session({
      ...PROVIDER_ROOM,
      ended_at: "2026-05-25T12:00:01.000Z",
      ended_reason: "date_timeout",
      state: "ended",
      phase: "ended",
      date_started_at: "2026-05-25T11:55:00.000Z",
      participant_1_joined_at: "2026-05-25T11:55:05.000Z",
      participant_2_joined_at: "2026-05-25T11:55:06.000Z",
      participant_1_remote_seen_at: "2026-05-25T11:55:07.000Z",
      participant_2_remote_seen_at: null,
    }),
    serverNextSurface: {
      action: "survey",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/event/${EVENT_ID}/lobby`,
    nativePath: `/event/${EVENT_ID}/lobby`,
  });

  assertDecisionParity({
    label: "server video_date without fetched truth remains server-authoritative",
    expectedTarget: "date",
    truth: null,
    serverNextSurface: {
      action: "video_date",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });

  assertDecisionParity({
    label: "server video_date with both_ready no-provider truth stays on date owner",
    expectedTarget: "date",
    truth: session({
      state: "ready_gate",
      phase: "ready_gate",
      ready_gate_status: "both_ready",
    }),
    serverNextSurface: {
      action: "video_date",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });

  assertDecisionParity({
    label: "server ready_gate with both_ready truth yields to date owner",
    expectedTarget: "date",
    truth: session({
      state: "ready_gate",
      phase: "ready_gate",
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-05-25T12:00:30.000Z",
    }),
    serverNextSurface: {
      action: "ready_gate",
      eventId: EVENT_ID,
      nextSessionId: SESSION_ID,
    },
    webPath: `/date/${SESSION_ID}`,
    nativePath: `/date/${SESSION_ID}`,
  });
});

test("Sprint 1 critical surfaces consume the canonical route contract", () => {
  assert.match(read("shared/matching/activeSession.ts"), /decideCanonicalVideoDateRoute/);
  assert.match(read("shared/matching/videoDateRecoveryAdvisor.ts"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/pages/EventLobby.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/pages/EventLobby.tsx"), /canonicalVideoDateRouteLogDetail/);
  // PR 7: hydration consumes the canonical contract through the shared
  // single surface-route decision (decideVideoDateSurfaceRoute composes
  // decideCanonicalVideoDateRoute in shared/videoDate/routeDecision.ts).
  assert.match(read("src/components/session/SessionRouteHydration.tsx"), /decideVideoDateSurfaceRoute/);
  assert.match(read("shared/videoDate/routeDecision.ts"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/components/session/SessionRouteHydration.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("src/components/session/SessionRouteHydration.tsx"), /session_route_hydration_ready_gate_canonical/);
  assert.doesNotMatch(read("src/components/session/SessionRouteHydration.tsx"), /ready_gate_bounce_suppressed_date_owner/);
  assert.doesNotMatch(read("src/components/session/SessionRouteHydration.tsx"), /webPathForCanonicalVideoDateRoute/);
  assert.match(read("src/pages/Schedule.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/pages/ReadyRedirect.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/pages/ReadyRedirect.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("src/pages/ReadyRedirect.tsx"), /webPathForCanonicalVideoDateRoute/);
  assert.doesNotMatch(read("src/pages/ReadyRedirect.tsx"), /registrationReadyGateFallback/);
  assert.match(read("src/pages/ReadyRedirect.tsx"), /ended_reason/);
  assert.match(readWebVideoDatePageFlowSource(root), /canonical_ready_gate_without_provider_prepared_truth/);
  assert.match(readWebVideoDatePageFlowSource(root), /date_guard_canonical_not_startable/);
  assert.match(readWebVideoDatePageFlowSource(root), /date_guard_canonical_ready_gate/);
  assert.match(read("src/components/lobby/ReadyGateOverlay.tsx"), /pending_survey_navigation_started/);
  assert.match(read("src/components/video-date/PostDateSurvey.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("src/components/video-date/PostDateSurvey.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("src/components/video-date/PostDateSurvey.tsx"), /fetchPostDateNextSessionTruth/);
  assert.match(read("apps/mobile/app/event/[eventId]/lobby.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("apps/mobile/app/event/[eventId]/lobby.tsx"), /canonicalVideoDateRouteLogDetail/);
  // PR 8: native hydration consumes the canonical contract through the shared
  // single surface-route decision (decideVideoDateSurfaceRoute composes
  // decideCanonicalVideoDateRoute in shared/videoDate/routeDecision.ts).
  assert.match(read("apps/mobile/components/NativeSessionRouteHydration.tsx"), /decideVideoDateSurfaceRoute/);
  assert.match(read("apps/mobile/components/NativeSessionRouteHydration.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("apps/mobile/components/NotificationDeepLinkHandler.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("apps/mobile/lib/activeSessionRoutes.ts"), /hrefForCanonicalVideoDateRoute/);
  assert.match(read("apps/mobile/lib/videoDateEntryStartable.ts"), /decideCanonicalVideoDateRoute/);
  assert.match(read("apps/mobile/lib/videoDateEntryStartable.ts"), /recommend: ['"]survey['"]/);
  assert.match(read("apps/mobile/app/ready/[id].tsx"), /startable\.recommend === ['"]survey['"]/);
  assert.match(read("apps/mobile/app/ready/[id].tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("apps/mobile/app/event/[eventId]/lobby.tsx"), /startable\.recommend === ['"]survey['"]/);
  assert.match(readNativeVideoDateScreenFlowSource(), /adviseVideoSessionTruthRecovery/);
  assert.match(read("apps/mobile/components/lobby/ReadyGateOverlay.tsx"), /pending_survey_navigation_started/);
  assert.match(read("apps/mobile/components/lobby/ReadyGateOverlay.tsx"), /router\.replace\(`\/date\/\$\{sessionId\}` as Href\)/);
  assert.match(read("apps/mobile/components/video-date/PostDateSurvey.tsx"), /decideCanonicalVideoDateRoute/);
  assert.match(read("apps/mobile/components/video-date/PostDateSurvey.tsx"), /canonicalVideoDateRouteLogDetail/);
  assert.match(read("apps/mobile/components/video-date/PostDateSurvey.tsx"), /fetchPostDateNextSessionTruth/);
});

test("Sprint 1 canonical route log detail has one shared reason shape", () => {
  const decision = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: {
      id: SESSION_ID,
      event_id: EVENT_ID,
      ready_gate_status: "both_ready",
      ready_gate_expires_at: new Date(NOW_MS + 30_000).toISOString(),
      daily_room_name: "date-session-1",
      daily_room_url: "https://vibelyapp.daily.co/date-session-1",
      state: "handshake",
    },
    nowMs: NOW_MS,
  });

  assert.deepEqual(canonicalVideoDateRouteLogDetail(decision, {
    sourceSurface: "event_lobby",
    sourceAction: "realtime",
  }), {
    source_surface: "event_lobby",
    source_action: "realtime",
    canonical_target: "date",
    canonical_reason: "provider_room_date_ready",
    canonical_session_id: SESSION_ID,
    canonical_event_id: EVENT_ID,
    canonical_match_id: null,
    canonical_target_id: null,
    canonical_queue_status: null,
    canonical_ready_gate_status: "both_ready",
    canonical_can_attempt_daily: true,
    canonical_has_provider_room: true,
    canonical_legacy_decision: "navigate_date",
  });
});
