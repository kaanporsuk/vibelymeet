import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  getReadyGateCountdownFromServerClock,
} from "./readyGateCountdown";
import {
  getReadyGatePermissionPrewarmReleaseDelayMs,
  normalizeReadyGateServerNowMs,
  shouldCommitReadyGateTruth,
} from "./readyGateReadiness";
import {
  createReadyGateRealtimeSupervisor,
  getReadyGateRealtimeReconnectDelayMs,
  isReadyGateResilientBroadcastEnabled,
  isReadyGateResilientClockEnabled,
  READY_GATE_REALTIME_RECONNECT_DELAYS_MS,
  READY_GATE_REALTIME_RECONNECT_MAX_DELAY_MS,
  READY_GATE_REALTIME_RECOVERY_STABLE_MS,
  READY_GATE_REALTIME_TELEMETRY,
} from "./readyGateRealtimeSupervisor";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("Ready Gate realtime orchestrator uses bounded exponential resubscribe backoff", () => {
  assert.deepEqual(
    READY_GATE_REALTIME_RECONNECT_DELAYS_MS.map((_, index) => getReadyGateRealtimeReconnectDelayMs(index + 1)),
    [250, 500, 1_000, 2_000, 4_000],
  );
  assert.equal(getReadyGateRealtimeReconnectDelayMs(6), READY_GATE_REALTIME_RECONNECT_MAX_DELAY_MS);
  assert.equal(
    getReadyGateRealtimeReconnectDelayMs(99),
    READY_GATE_REALTIME_RECONNECT_MAX_DELAY_MS,
  );
});

test("Ready Gate resilience uses canonical v2 flags only (v1 alias retired)", () => {
  assert.equal(isReadyGateResilientClockEnabled({ timelineV2Enabled: true }), true);
  assert.equal(isReadyGateResilientClockEnabled({ timelineV2Enabled: false }), false);
  assert.equal(isReadyGateResilientBroadcastEnabled({ broadcastV2Enabled: true }), true);
  assert.equal(isReadyGateResilientBroadcastEnabled({ broadcastV2Enabled: false }), false);
});

test("Ready Gate realtime telemetry names stay exact", () => {
  assert.deepEqual(READY_GATE_REALTIME_TELEMETRY, {
    DEGRADED: "ready_gate_realtime_degraded",
    RECOVERED: "ready_gate_realtime_recovered",
    SNAPSHOT_GAP_RECOVERED: "ready_gate_snapshot_gap_recovered",
  });
});

test("Ready Gate realtime orchestrator uses a stable recovery window", () => {
  assert.equal(READY_GATE_REALTIME_RECOVERY_STABLE_MS, 1_500);
});

test("Ready Gate realtime supervisor recovers only after all degraded sources stay healthy", async () => {
  const emitted: string[] = [];
  const degradedStates: boolean[] = [];
  let snapshotFetches = 0;
  let resubscribeCount = 0;
  const supervisor = createReadyGateRealtimeSupervisor({
    sessionId: "session-1",
    eventId: "event-1",
    platform: "web",
    sourceSurface: "contract_test",
    nowMs: () => 1_000,
    recoveryStableMs: 20,
    emitTelemetry: (eventName) => {
      emitted.push(eventName);
    },
    fetchCanonicalSnapshot: async () => {
      snapshotFetches += 1;
      return { ok: true, seq: 7 };
    },
    onDegradedChange: (degraded) => {
      degradedStates.push(degraded);
    },
    onResubscribe: () => {
      resubscribeCount += 1;
    },
  });

  supervisor.handleStatus("private_broadcast", "CHANNEL_ERROR", new Error("socket lost"));
  supervisor.handleStatus("postgres_video_sessions", "CLOSED");
  assert.equal(supervisor.isDegraded(), true);
  assert.deepEqual(emitted, [READY_GATE_REALTIME_TELEMETRY.DEGRADED]);

  supervisor.handleStatus("private_broadcast", "SUBSCRIBED");
  assert.equal(supervisor.isDegraded(), true);
  assert.deepEqual(emitted, [READY_GATE_REALTIME_TELEMETRY.DEGRADED]);

  supervisor.handleStatus("postgres_video_sessions", "SUBSCRIBED");
  assert.equal(supervisor.isDegraded(), true);
  assert.deepEqual(emitted, [READY_GATE_REALTIME_TELEMETRY.DEGRADED]);
  assert.equal(snapshotFetches, 2);
  assert.equal(resubscribeCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(supervisor.isDegraded(), false);
  assert.deepEqual(emitted, [
    READY_GATE_REALTIME_TELEMETRY.DEGRADED,
    READY_GATE_REALTIME_TELEMETRY.RECOVERED,
  ]);
  assert.deepEqual(degradedStates, [true, false]);

  supervisor.dispose();
});

test("Ready Gate realtime supervisor cancels pending recovery on another failure", async () => {
  const emitted: string[] = [];
  const supervisor = createReadyGateRealtimeSupervisor({
    sessionId: "session-1",
    eventId: "event-1",
    platform: "web",
    sourceSurface: "contract_test",
    nowMs: () => 1_000,
    recoveryStableMs: 30,
    emitTelemetry: (eventName) => {
      emitted.push(eventName);
    },
    fetchCanonicalSnapshot: async () => ({ ok: true, seq: 7 }),
    onResubscribe: () => undefined,
  });

  supervisor.handleStatus("postgres_video_sessions", "CHANNEL_ERROR");
  supervisor.handleStatus("postgres_video_sessions", "SUBSCRIBED");
  await new Promise((resolve) => setTimeout(resolve, 10));
  supervisor.handleStatus("postgres_video_sessions", "TIMED_OUT");
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(supervisor.isDegraded(), true);
  assert.deepEqual(emitted, [READY_GATE_REALTIME_TELEMETRY.DEGRADED]);

  supervisor.handleStatus("postgres_video_sessions", "SUBSCRIBED");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(supervisor.isDegraded(), false);
  assert.deepEqual(emitted, [
    READY_GATE_REALTIME_TELEMETRY.DEGRADED,
    READY_GATE_REALTIME_TELEMETRY.RECOVERED,
  ]);
  supervisor.dispose();
});

test("Ready Gate realtime supervisor clears intentionally inactive degraded sources", async () => {
  const emitted: string[] = [];
  let resubscribeCount = 0;
  const supervisor = createReadyGateRealtimeSupervisor({
    sessionId: "session-1",
    eventId: "event-1",
    platform: "native",
    sourceSurface: "contract_test",
    nowMs: () => 1_000,
    emitTelemetry: (eventName) => {
      emitted.push(eventName);
    },
    fetchCanonicalSnapshot: async () => ({ ok: true, seq: 7 }),
    onResubscribe: () => {
      resubscribeCount += 1;
    },
  });

  supervisor.handleStatus("private_broadcast", "CHANNEL_ERROR", new Error("socket lost"));
  assert.equal(supervisor.isDegraded(), true);
  supervisor.clearSource("private_broadcast", "subscription_inactive");
  assert.equal(supervisor.isDegraded(), false);
  assert.deepEqual(emitted, [READY_GATE_REALTIME_TELEMETRY.DEGRADED]);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(resubscribeCount, 0);
  supervisor.dispose();
});

test("Ready Gate truth precedence rejects lower polling truth after terminal readiness", () => {
  assert.equal(
    shouldCommitReadyGateTruth({
      currentStatus: "both_ready",
      incomingStatus: "ready_a",
      currentSeq: 42,
      incomingSeq: 42,
    }),
    false,
  );
  assert.equal(
    shouldCommitReadyGateTruth({
      currentStatus: "ready_a",
      incomingStatus: "both_ready",
      currentSeq: 42,
      incomingSeq: 42,
    }),
    true,
  );
  assert.equal(
    shouldCommitReadyGateTruth({
      currentStatus: "both_ready",
      incomingStatus: "expired",
      currentSeq: 42,
      incomingSeq: 43,
    }),
    false,
  );
});

test("Ready Gate countdown follows server clock even when client clock is skewed", () => {
  const serverNowMs = Date.parse("2026-05-24T12:00:00.000Z");
  const skewedClientSyncedAtMs = serverNowMs + 90_000;
  const expiresAt = new Date(serverNowMs + 30_000).toISOString();

  const countdown = getReadyGateCountdownFromServerClock({
    expiresAt,
    serverNowMs,
    clientSyncedAtMs: skewedClientSyncedAtMs,
    nowMs: skewedClientSyncedAtMs + 5_000,
  });

  assert.equal(countdown.remainingSeconds, 25);
  assert.equal(countdown.hasServerClock, true);
});

test("Ready Gate RPC clock payloads normalize milliseconds, seconds, and ISO timestamps", () => {
  const serverNowMs = Date.parse("2026-05-24T12:00:00.000Z");
  assert.equal(normalizeReadyGateServerNowMs({ server_now_ms: serverNowMs }).serverNowMs, serverNowMs);
  assert.equal(normalizeReadyGateServerNowMs({ server_now: serverNowMs / 1000 }).serverNowMs, serverNowMs);
  assert.equal(normalizeReadyGateServerNowMs({ serverNow: "2026-05-24T12:00:00.000Z" }).serverNowMs, serverNowMs);
});

test("Ready Gate permission prewarm release is anchored to completed-at plus grace", () => {
  assert.equal(
    getReadyGatePermissionPrewarmReleaseDelayMs({
      prewarmCompletedAtMs: 10_000,
      nowMs: 15_000,
    }),
    3_000,
  );
});

test("Ready Gate Phase 2 is wired across web, native, and database surfaces", () => {
  const webHook = read("src/hooks/useReadyGate.ts");
  const nativeApi = read("apps/mobile/lib/readyGateApi.ts");
  const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
  const migration = read("supabase/migrations/20260524120000_ready_gate_orchestrator_server_clock.sql");

  for (const source of [webHook, nativeApi]) {
    assert.match(source, /createReadyGateRealtimeSupervisor/);
    assert.match(source, /shouldCommitReadyGateTruth/);
    assert.match(source, /normalizeReadyGateServerNowMs/);
    assert.match(source, /createInitialReadyGateState/);
    assert.match(source, /activeReadyGateSessionIdRef/);
    assert.match(source, /readyGateRealtimeSupervisorRef/);
    assert.match(source, /sequenceGapUnresolved/);
    assert.match(source, /phaseDeadlineAtMs/);
    assert.match(source, /clockSkewMs/);
    assert.match(source, /countdownDegraded/);
    assert.match(source, /isReadyGateResilientClockEnabled/);
    assert.doesNotMatch(source, /ready_gate_resilient_clock_v1/);
    assert.match(source, /CLOSED/);
    assert.match(source, /const snapshot = await fetchVideoDateSnapshot\(sessionId, \{ includeToken: false \}\);\s+if \(activeReadyGateSessionIdRef\.current !== sessionId\) return/);
    assert.match(source, /const syncResult = await syncSession\(\)/);
    assert.match(source, /subscription\.unsubscribe\(\);\s+clearBroadcastGapRetryTimer\(\);\s+broadcastGapRecoveryRef\.current = null;\s+setSequenceGapUnresolved\(false\);/);
  }

  assert.match(nativeApi, /void syncSession\(\)/);
  assert.match(nativeApi, /!state\.realtimeDegraded && !state\.sequenceGapUnresolved/);
  assert.doesNotMatch(nativeApi, /const intervalId = setInterval\(\(\) => \{\s*void fetchSession\(\)/);

  for (const source of [webOverlay, nativeOverlay, nativeReadyRoute]) {
    assert.match(source, /getReadyGateCountdownFromServerClock/);
    assert.match(source, /phaseDeadlineAtMs/);
    assert.match(source, /readyGateClockEnabled/);
    assert.match(source, /fallbackDeadlineMs/);
    assert.match(source, /readyGateOpenedAtMsRef\.current \+ GATE_TIMEOUT(?:_SEC)? \* 1000/);
    assert.doesNotMatch(source, /fallbackGateDeadlineMsRef/);
  }

  assert.match(webOverlay, /getReadyGatePermissionPrewarmReleaseDelayMs/);
  assert.match(webOverlay, /settings_deep_link/);
  assert.match(webOverlay, /orchestratorRealtimeDegraded/);
  assert.match(webOverlay, /overlayRealtimeDegradedRef/);
  assert.match(webOverlay, /orchestratorRealtimeDegradedRef/);
  assert.match(webOverlay, /READY_GATE_REALTIME_RECOVERY_STABLE_MS/);
  assert.match(webOverlay, /scheduleOverlayRealtimeRecovery/);
  assert.match(webOverlay, /return \(\) => \{\s*clearOverlayRealtimeRecoveryTimer\(\);\s*supabase\.removeChannel\(channel\);/s);
  assert.match(webOverlay, /clearRealtimeDegradedWhenHealthy/);
  assert.doesNotMatch(webOverlay, /if \(!realtimeDegraded\) return;\s*setRealtimeDegraded\(false\)/);
  assert.match(webOverlay, /status === "SUBSCRIBED"/);
  assert.match(webHook, /clearSource\("private_broadcast", "broadcast_disabled"\)/);
  assert.match(nativeApi, /clearSource\('private_broadcast', 'broadcast_disabled'\)/);
  assert.match(migration, /server_now_ms/);
  assert.match(migration, /serverNowMs/);
  assert.match(migration, /ready_gate_transition_20260524120000_clock_base/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)/);
});
