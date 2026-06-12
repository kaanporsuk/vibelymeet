import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

// Regression guard for the Video Date handoff/timer-ownership fix.
//
// Production session d6178b76 ended in `handshake_timeout` with the Daily room
// created and both participants stamped joined. Root cause: the ReadyGate
// performed a *real* Daily join during prewarm, starting the backend
// handshake/warm-up clock before the user was on a stable /date route (and
// could be bounced by duplicate-tab handling). The fix makes the ReadyGate
// warm camera/token/preauth only, and keeps the real join + joined stamp owned
// solely by the /date route (useVideoCall / native date route).

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const exists = (path: string) => existsSync(join(root, path));

const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const nativeReadyGate = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeDateRoute = readNativeVideoDateScreenFlowSource();

const readyGateSurfaces: Array<[string, string]> = [
  ["web ReadyGateOverlay", webReadyGate],
  ["native ReadyGateOverlay", nativeReadyGate],
  ["native ready route", nativeReadyRoute],
];

const dateRouteOwners: Array<[string, string]> = [
  ["web /date (useVideoCall)", webVideoCall],
  ["native /date route", nativeDateRoute],
];

test("ReadyGate surfaces warm Daily but never perform the real join (handshake-clock ownership)", () => {
  for (const [name, source] of readyGateSurfaces) {
    // No real Daily join from the lobby — that would start the backend
    // handshake clock before the user is on a stable /date route.
    assert.doesNotMatch(
      source,
      /join(Web|Native)VideoDateDailyPrewarm/,
      `${name} must not join Daily`,
    );
    // No solo-prejoin: its only purpose was an early real join.
    assert.doesNotMatch(
      source,
      /videoDateDailySoloPrejoinEnabled|prepareVideoDateSoloEntry/,
      `${name} must not solo-prejoin`,
    );
    // The joined stamp is owned by /date only (matches an actual rpc call, not comments).
    assert.doesNotMatch(
      source,
      /rpc\(\s*['"]mark_video_date_daily_joined/,
      `${name} must not stamp joined`,
    );
  }
  // ...but the ReadyGate still warms camera + preauth for a fast handoff.
  assert.match(webReadyGate, /startWebVideoDateDailyPrewarm/);
  assert.match(webReadyGate, /preAuthWebVideoDateDailyPrewarm/);
  assert.match(nativeReadyGate, /startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGate, /preAuthNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyRoute, /startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyRoute, /preAuthNativeVideoDateDailyPrewarm/);
});

test("/date routes are the sole owners of the real Daily join + joined stamp", () => {
  for (const [name, source] of dateRouteOwners) {
    assert.match(
      source,
      /\.join\(\{\s*url:/,
      `${name} should perform the real Daily join`,
    );
    assert.match(
      source,
      /rpc\(\s*['"]mark_video_date_daily_joined/,
      `${name} should stamp joined`,
    );
  }
});

test("ReadyGate overlays reconcile both-ready into the prepare-entry handoff (liveness guard)", () => {
  for (const [name, source, resetMarker, guardMarker] of [
    [
      "web",
      webReadyGate,
      'releasePermissionPrewarmMedia("ready_gate_session_changed")',
      'handleBothReady("both_ready_observed")',
    ],
    [
      "native",
      nativeReadyGate,
      "setNativePermissionDiagnostics",
      "handleBothReady('both_ready_observed')",
    ],
  ] as Array<[string, string, string, string]>) {
    const resetIndex = source.indexOf(resetMarker);
    const guardIndex = source.indexOf(guardMarker);
    assert.ok(
      resetIndex >= 0,
      `${name} overlay should reset session-owned handoff state`,
    );
    assert.ok(
      guardIndex > resetIndex,
      `${name} overlay liveness guard should run after session reset so reset cannot stale the handoff`,
    );
    assert.match(
      source,
      /if \(!isBothReady\) return;\s*(?:if \([^)]+StateSessionId !== sessionId\) return;\s*)?handleBothReady\(\s*['"]both_ready_observed['"]\s*\)/,
      `${name} overlay should drive handleBothReady when both are ready`,
    );
  }
});

test("ReadyGate liveness guards ignore stale both-ready state after a session switch", () => {
  assert.match(webReadyGateHook, /stateSessionId: string \| null/);
  assert.match(
    webReadyGateHook,
    /const isCurrentSessionState = state\.stateSessionId === sessionId/,
  );
  assert.match(
    webReadyGateHook,
    /const isBothReady = isCurrentSessionState && state\.isBothReady/,
  );
  assert.match(webReadyGate, /stateSessionId: readyGateStateSessionId/);
  assert.match(
    webReadyGate,
    /if \(readyGateStateSessionId !== sessionId\) return;\s*handleBothReady\("both_ready_observed"\)/,
  );
  assert.match(webReadyGate, /readyGateStateSessionId,\s*sessionId/);
  assert.match(nativeReadyGateApi, /stateSessionId: string \| null/);
  assert.match(nativeReadyGateApi, /stateSessionId: sessionId \?\? null/);
  assert.match(
    nativeReadyGateApi,
    /const isCurrentSessionState = state\.stateSessionId === \(sessionId \?\? null\);\s*const isBothReady = isCurrentSessionState && \(state\.isBothReady \|\| state\.status === BOTH_READY\)/,
  );
  assert.match(nativeReadyGate, /stateSessionId: readyGateStateSessionId/);
  assert.match(
    nativeReadyGate,
    /if \(readyGateStateSessionId !== sessionId\) return;\s*handleBothReady\(\s*["']both_ready_observed["']\s*\)/,
  );
  assert.match(nativeReadyGate, /readyGateStateSessionId,\s*sessionId/);
});

test("ReadyGate video_provider row stays neutral (waiting) until prepare-entry begins", () => {
  for (const [name, source] of [
    ["web", webReadyGate],
    ["native", nativeReadyGate],
  ] as Array<[string, string]>) {
    // waiting before prepare-entry starts; checking only while it is running.
    assert.match(
      source,
      /prepareEntryStatus !== ['"]idle['"]\s*\?\s*['"]checking['"]\s*:\s*['"]waiting['"]/,
      `${name} overlay video_provider mapping should be checking-or-waiting`,
    );
    // Must not force "checking" merely because both are ready (the old bug).
    assert.doesNotMatch(
      source,
      /prepareEntryStatus !== ['"]idle['"] \|\| isBothReady/,
      `${name} overlay must not force checking on isBothReady`,
    );
  }
});

test("ReadyGate handoff retries are single-flight/provider-aware without room-warmup helpers", () => {
  for (const [name, source] of [
    ["web", webReadyGate],
    ["native", nativeReadyGate],
  ] as Array<[string, string]>) {
    assert.match(
      source,
      /getVideoDateEntryHandoffRetryDelayMs\(\s*result,\s*VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS\[attempt\],?\s*\)/,
      `${name} overlay should respect provider retry-after before retrying prepare-entry`,
    );
    assert.match(
      source,
      /readyActionInFlightRef\.current/,
      `${name} overlay should synchronously guard ready taps before permission prewarm`,
    );
    assert.match(
      source,
      /prepareEntryHandoffStartedRef\.current/,
      `${name} overlay should keep prepare-entry handoff single-flight`,
    );
    assert.doesNotMatch(source, /ensureVideoDateRoomWarmup/);
    assert.doesNotMatch(source, /videoDateRoomWarmupAfterReadyEnabled/);
  }
  assert.match(nativeReadyRoute, /readyActionInFlightRef\.current/);
  assert.equal(exists("src/lib/videoDateRoomWarmup.ts"), false);
  assert.equal(exists("apps/mobile/lib/videoDateRoomWarmup.ts"), false);
  assert.equal(exists("shared/matching/videoDateRoomWarmup.ts"), false);
});
