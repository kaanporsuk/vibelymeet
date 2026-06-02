import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveReadyGateTransitionFailureCopy } from "./readyGateDiagnosticCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260602231752_ready_gate_57014_reliability_fix.sql",
);
const webLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGateOverlay = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");

test("web and native lobbies pause deck pressure while Ready Gate is active", () => {
  assert.match(webLobby, /const readyGatePressureActive = Boolean\(/);
  assert.match(webLobby, /const deckFetchEnabled = deckEnabled && !readyGatePressureActive/);
  assert.match(webLobby, /useEventDeck\([\s\S]*enabled: deckFetchEnabled/s);
  assert.match(webLobby, /deckPrefetchPolishEnabled \|\| readyGatePressureActive/);
  assert.match(webLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)[\s\S]{0,140}!readyGatePressureActive/s);

  assert.match(nativeLobby, /const readyGatePressureActive = Boolean\(activeSessionId\)/);
  assert.match(nativeLobby, /const deckQueryEnabled = Boolean\([\s\S]*!readyGatePressureActive/s);
  assert.match(nativeLobby, /if \(readyGatePressureActive\) \{[\s\S]*lobby_deck_refresh_suppressed_ready_gate/s);
  assert.match(nativeLobby, /deckPrefetchPolishEnabled \|\| readyGatePressureActive/);
  assert.match(nativeLobby, /shouldTopUp && !readyGatePressureActive/);
});

test("Ready Gate sync polling is coalesced, backed off, and skipped while marking ready", () => {
  assert.match(webReadyGateOverlay, /READY_GATE_DEGRADED_SYNC_POLL_MS = 2_500/);
  assert.match(webReadyGateOverlay, /reconcileSessionInFlightRef/);
  assert.match(webReadyGateOverlay, /reconcileSessionCooldownUntilMsRef/);
  assert.match(webReadyGateOverlay, /source === "poll" && readyActionInFlightRef\.current/);
  assert.match(webReadyGateOverlay, /isReadyGateTransitionTimeoutSignal\(syncResult\)[\s\S]*READY_GATE_RECONCILE_TIMEOUT_COOLDOWN_MS/s);
  assert.match(webReadyGateOverlay, /isTransitioning \|\|[\s\S]*iAmReady \|\|[\s\S]*markingReady \|\|[\s\S]*snoozedByPartner/s);

  for (const [name, source] of [
    ["native overlay", nativeReadyGateOverlay],
    ["native ready route", nativeReadyRoute],
  ] as const) {
    assert.match(source, /guardedSyncInFlightRef/, `${name} should coalesce sync`);
    assert.match(source, /guardedSyncCooldownUntilMsRef/, `${name} should cool down sync`);
    assert.match(source, /READY_GATE_SYNC_TIMEOUT_COOLDOWN_MS = 3_000/, `${name} should use bounded cooldown`);
    assert.match(source, /readyActionInFlightRef\.current[\s\S]*sync_suppressed_mark_ready_in_flight/s, `${name} should skip passive sync while marking`);
    assert.match(source, /guardedSyncSession\([\s\S]*mark_ready_timeout_recovery[\s\S]*allowWhileMarking: true/s, `${name} should allow the one explicit timeout recovery sync`);
  }
});

test("Ready Gate 57014 copy is a transient status-sync delay, not a permission denial", () => {
  assert.deepEqual(
    resolveReadyGateTransitionFailureCopy({
      action: "mark_ready",
      code: "57014",
      error: "canceling statement due to statement timeout",
      platform: "web",
    }),
    {
      action: "mark_ready",
      code: "57014",
      reasonCode: "ready_gate_transition_timeout",
      title: "Status sync delayed",
      message: "Status sync is delayed. Retrying with the latest session status.",
      retryable: true,
      staleOrConflict: false,
    },
  );
  assert.match(webReadyGateOverlay, /permission_prewarm_failed_diagnostics_ok/);
  assert.match(webReadyGateOverlay, /!permissionReady && !mediaDiagnosticsAreGreen/);
});

test("Ready Gate 57014 migration makes sync/deck paths non-blocking", () => {
  assert.match(migration, /idx_event_registrations_profile_active_room/);
  assert.match(migration, /ready_gate_transition_20260602231752_57014_base/);
  assert.match(migration, /p_action = 'sync'[\s\S]*'snapshot', true/s);
  assert.match(migration, /READY_GATE_TRANSITION_TIMEOUT/);
  assert.match(migration, /retry_after_seconds', 2/);

  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /'reason', 'deck_busy'/);
  assert.match(migration, /'retryable', true[\s\S]*'retry_after_seconds', 2/s);
  assert.doesNotMatch(migration, /cleanup_event_deck_card_reservations\s*\(/);
});

test("mark-ready v2 keeps Ready Gate mutation decisive and auxiliary work fail-soft", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2/);
  assert.match(migration, /v_transition := public\.ready_gate_transition\(p_session_id, 'mark_ready', NULL\)/);
  assert.match(migration, /EXCEPTION[\s\S]*WHEN query_canceled OR lock_not_available[\s\S]*mark_ready_timeout/s);
  assert.match(migration, /v_auxiliary_errors jsonb := '\[\]'::jsonb/);
  assert.match(migration, /append_video_session_event_v2[\s\S]*EXCEPTION[\s\S]*'kind', 'event_append'/s);
  assert.match(migration, /video_date_outbox_enqueue_v2[\s\S]*EXCEPTION[\s\S]*'kind', 'daily_room_outbox'/s);
  assert.match(migration, /'provider_outbox_degraded', jsonb_array_length\(v_auxiliary_errors\) > 0/);
});
