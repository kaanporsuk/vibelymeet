import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  getReadyGateCountdownFromServerClock,
} from "./readyGateCountdown";
import {
  getReadyGatePermissionPrewarmReleaseDelayMs,
  getReadyGateResubscribeDelayMs,
  normalizeReadyGateServerNowMs,
  READY_GATE_ORCHESTRATOR_BACKOFF_MS,
  READY_GATE_ORCHESTRATOR_MAX_RESUBSCRIBE_ATTEMPTS,
  READY_GATE_RECONCILE_AFTER_REALTIME_MS,
  shouldCommitReadyGateTruth,
} from "./readyGateReadiness";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("Ready Gate realtime orchestrator uses bounded exponential resubscribe backoff", () => {
  assert.deepEqual(
    READY_GATE_ORCHESTRATOR_BACKOFF_MS.map((_, index) => getReadyGateResubscribeDelayMs({
      attempt: index + 1,
      jitterRatio: 0,
    })),
    [1_000, 2_000, 4_000, 8_000],
  );
  assert.equal(
    getReadyGateResubscribeDelayMs({
      attempt: READY_GATE_ORCHESTRATOR_MAX_RESUBSCRIBE_ATTEMPTS + 1,
      jitterRatio: 0,
    }),
    null,
  );
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
    assert.match(source, /getReadyGateResubscribeDelayMs/);
    assert.match(source, /shouldCommitReadyGateTruth/);
    assert.match(source, /normalizeReadyGateServerNowMs/);
    assert.match(source, /READY_GATE_RECONCILE_AFTER_REALTIME_MS/);
    assert.match(source, /createInitialReadyGateState/);
    assert.match(source, /activeReadyGateSessionIdRef/);
    assert.match(source, /realtimeReconcileTimerRef/);
    assert.match(source, /CLOSED/);
    assert.match(source, /const syncResult = await syncSession\(\)/);
  }

  assert.match(nativeApi, /void syncSession\(\)/);
  assert.doesNotMatch(nativeApi, /const intervalId = setInterval\(\(\) => \{\s*void fetchSession\(\)/);

  for (const source of [webOverlay, nativeOverlay, nativeReadyRoute]) {
    assert.match(source, /getReadyGateCountdownFromServerClock/);
    assert.doesNotMatch(source, /fallbackGateDeadlineMsRef/);
  }

  assert.match(webOverlay, /getReadyGatePermissionPrewarmReleaseDelayMs/);
  assert.match(webOverlay, /settings_deep_link/);
  assert.match(webOverlay, /orchestratorRealtimeDegraded/);
  assert.match(webOverlay, /status === "SUBSCRIBED"/);
  assert.match(migration, /server_now_ms/);
  assert.match(migration, /serverNowMs/);
  assert.match(migration, /ready_gate_transition_20260524120000_clock_base/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)/);
});
