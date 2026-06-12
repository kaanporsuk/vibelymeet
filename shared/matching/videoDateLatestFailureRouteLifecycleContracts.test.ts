import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideCanonicalVideoDateRoute } from "./videoDateRouteDecision";

import { readWebVideoCallFlowSource, readWebVideoDateNavigationIntentsSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webHydration = read("src/components/session/SessionRouteHydration.tsx");
const nativeHydration = read("apps/mobile/components/NativeSessionRouteHydration.tsx");
const webLatch = readWebVideoDateNavigationIntentsSource(root);
const nativeLatch = read("apps/mobile/lib/dateEntryTransitionLatch.ts");
const webVideoCall = readWebVideoCallFlowSource(root);
const webLobby = read("src/pages/EventLobby.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const packageJson = read("package.json");

test("registration in_survey dominates stale Ready Gate and missing session truth", () => {
  const staleReadyGateDecision = decideCanonicalVideoDateRoute({
    sessionId: "session-1",
    eventId: "event-1",
    registration: {
      queue_status: "in_survey",
      current_room_id: "session-1",
      event_id: "event-1",
    },
    truth: {
      id: "session-1",
      event_id: "event-1",
      ready_gate_status: "ready",
      ready_gate_expires_at: Date.now() + 60_000,
    },
    nowMs: Date.now(),
  });

  assert.equal(staleReadyGateDecision.target, "survey");
  assert.equal(staleReadyGateDecision.reason, "registration_pending_survey");

  const missingTruthDecision = decideCanonicalVideoDateRoute({
    sessionId: "session-2",
    eventId: "event-1",
    registration: {
      queue_status: "in_survey",
      current_room_id: "session-2",
      event_id: "event-1",
    },
  });

  assert.equal(missingTruthDecision.target, "survey");
  assert.equal(missingTruthDecision.reason, "registration_pending_survey");
});

test("date route hydration only owns date-capable or latched routes", () => {
  assert.doesNotMatch(webHydration, /ready_gate_bounce_suppressed_date_owner/);
  assert.doesNotMatch(nativeHydration, /ready_gate_bounce_suppressed_date_owner/);
  // PR 7: the web ready-gate bounce is decided by the shared surface-route
  // decision, which releases ownership before hydration navigates.
  assert.match(
    webHydration,
    /decision\.target === "ready"[\s\S]*navigate\(target, \{[\s\S]{0,220}source: "session_route_hydration_ready_gate_canonical"/,
  );
  assert.match(
    read("shared/videoDate/routeDecision.ts"),
    /canonical\.target === "ready_gate"[\s\S]{0,260}clearOwnership\(\);/,
  );
  assert.match(
    nativeHydration,
    /canonicalRoute\.target === "ready_gate"[\s\S]*clearVideoDateRouteOwnership\(sid, user\.id\)[\s\S]*router\.replace\(target\)/,
  );
  assert.doesNotMatch(webHydration, /webPathForCanonicalVideoDateRoute/);
  assert.doesNotMatch(nativeHydration, /hrefForCanonicalVideoDateRoute/);
  assert.doesNotMatch(webHydration, /canonicalRoute\.target === "ready_gate"\s*\?/);

  for (const source of [webHydration, nativeHydration] as const) {
    assert.match(
      source,
      /registration:\s*\{[\s\S]{0,220}queue_status: activeSession\.queueStatus/,
      "hydration should pass registration queue status into canonical routing",
    );
    assert.match(
      source,
      /markVideoDateRouteOwned\([^)]*user\.id/,
      "hydration should still mark route ownership for date-capable/survey/latch branches",
    );
  }
});

test("date route ownership survives real route churn", () => {
  assert.match(webLatch, /VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 10 \* 60_000/);
  assert.match(nativeLatch, /VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 10 \* 60_000/);
  assert.match(webLatch, /VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 2 \* 60_000/);
  assert.match(nativeLatch, /VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 2 \* 60_000/);
  assert.match(webLatch, /window\.sessionStorage/);
  assert.match(webLatch, /ROUTE_OWNERSHIP_STORAGE_PREFIX/);
  assert.match(webLatch, /persistRouteOwnership/);
});

test("same-session Daily remount cleanup is detach-only on web and native", () => {
  assert.match(webVideoCall, /daily_call_live_remount_detach_only/);
  assert.match(
    webVideoCall,
    /if \(!parkedSingleton\) \{\s*callObjectRef\.current = null;\s*\}/,
  );
  assert.match(
    webVideoCall,
    /if \(!parkedSingleton\) \{\s*activeDailyCallIdentityRef\.current = null;\s*clearDailyAliveHeartbeatTimer\(`daily_call_cleanup:\$\{reason\}`\);/,
  );
  assert.match(webVideoCall, /heartbeat_transferred: true/);
  assert.match(webVideoCall, /daily_call_live_remount_heartbeat_preserved/);
  assert.match(webVideoCall, /daily_call_live_remount_identity_preserved/);

  const nativeParkIndex = nativeDateRoute.indexOf(
    "parkSharedCallForWarmHandoff(call, cleanupReason)",
  );
  const nativeHeartbeatClearIndex = nativeDateRoute.indexOf(
    "clearDailyAliveHeartbeatTimer(cleanupReason)",
  );
  assert.ok(nativeParkIndex >= 0, "native should attempt warm handoff parking");
  assert.ok(
    nativeHeartbeatClearIndex > nativeParkIndex,
    "native should decide whether to park before clearing the heartbeat",
  );
  assert.match(nativeDateRoute, /daily_call_live_remount_detach_only/);
  assert.match(nativeDateRoute, /heartbeatPreserved: true/);
  assert.match(nativeDateRoute, /callRefPreserved: true/);
});

test("active date route ownership disables competing lobby status loops without queue drains", () => {
  assert.match(webLobby, /const activeDateRouteOwnsLobby = Boolean\(/);
  assert.match(webLobby, /dateNavigationSessionId/);
  assert.match(webLobby, /scopedSessionQueueStatus === "in_survey"/);
  assert.match(webLobby, /sameEventScopedSession\?\.kind === "video"/);
  assert.match(
    webLobby,
    /const lobbySideEffectsEnabled =\s*lobbyGateSideEffectsEnabled && !activeDateRouteOwnsLobby/,
  );
  assert.doesNotMatch(webLobby, /useMatchQueue|queueHintEnabled|fetchVideoDateQueueHint/);

  assert.match(nativeLobby, /const activeDateRouteOwnsLobby = Boolean\(/);
  assert.match(nativeLobby, /sameEventActiveSession\?\.kind === "video"/);
  assert.match(
    nativeLobby,
    /const lobbySideEffectsEnabled =\s*lobbyGateSideEffectsEnabled && !activeDateRouteOwnsLobby/,
  );
  assert.match(
    nativeLobby,
    /useNonBlockingVideoDateReadiness\(id, lobbySideEffectsEnabled\)/,
  );
  assert.match(
    nativeLobby,
    /useEventStatus\(id, user\?\.id \?\? undefined, lobbySideEffectsEnabled\)/,
  );
  assert.doesNotMatch(nativeLobby, /queueHintEnabled|fetchVideoDateQueueHint|drainMatchQueue/);
});

test("latest failure route lifecycle contract stays in the v4 verification script", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateLatestFailureRouteLifecycleContracts\.test\.ts/,
  );
});
