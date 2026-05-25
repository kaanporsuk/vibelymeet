import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLobbySwipeResultPayload,
  buildQueueDrainResultPayload,
  DECK_EMPTY_REASONS,
  EventLobbyObservabilityEvents,
  FORBIDDEN_EVENT_LOBBY_OBSERVABILITY_KEYS,
  resolveDeckEmptyReason,
} from "./eventLobbyObservability";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assertNoForbiddenKeys(payload: Record<string, unknown>) {
  for (const forbidden of FORBIDDEN_EVENT_LOBBY_OBSERVABILITY_KEYS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload, forbidden),
      false,
      `payload should not expose ${forbidden}`,
    );
  }
}

test("Event Lobby observability event names are canonical", () => {
  assert.deepEqual(Object.values(EventLobbyObservabilityEvents).sort(), [
    "date_entered_from_lobby",
    "lobby_deck_empty",
    "lobby_deck_error",
    "lobby_deck_loaded",
    "lobby_entered",
    "lobby_swipe_duplicate_suppressed",
    "lobby_swipe_result",
    "lobby_swipe_submitted",
    "notification_sent",
    "notification_suppressed",
    "queue_drain_attempted",
    "queue_drain_result",
    "ready_gate_shown",
    "ready_gate_transition",
  ].sort());
});

test("deck empty reason taxonomy stays coarse and safe", () => {
  assert.deepEqual([...DECK_EMPTY_REASONS], [
    "event_not_active",
    "user_not_eligible",
    "no_confirmed_candidates",
    "all_candidates_filtered",
    "all_candidates_seen_locally",
    "all_candidates_busy_or_unavailable",
    "rpc_error",
    "network_error",
    "unknown",
  ]);

  assert.equal(resolveDeckEmptyReason({ deckEnabled: false, gateKind: "ended" }), "event_not_active");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: false, gateKind: "not_registered" }), "user_not_eligible");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, deckError: true, deckErrorValue: new Error("timeout") }), "network_error");
  assert.equal(
    resolveDeckEmptyReason({
      deckEnabled: true,
      deckError: true,
      deckErrorValue: { code: "P0001", message: "event_not_active", details: "event_ended" },
    }),
    "event_not_active",
  );
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, totalProfiles: 3, visibleProfiles: 0 }), "all_candidates_seen_locally");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, queuedCount: 1 }), "all_candidates_busy_or_unavailable");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, deckStateReason: "safety_limited" }), "user_not_eligible");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, deckStateReason: "media_unavailable" }), "rpc_error");
  assert.equal(
    resolveDeckEmptyReason({ deckEnabled: true, deckStateReason: "queue_waiting" }),
    "all_candidates_busy_or_unavailable",
  );
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true, deckStateReason: "terminal_event_state" }), "event_not_active");
  assert.equal(resolveDeckEmptyReason({ deckEnabled: true }), "no_confirmed_candidates");
});

test("swipe result payload captures duplicate suppression without private identifiers", () => {
  const payload = buildLobbySwipeResultPayload({
    eventId: "event-1",
    platform: "web",
    swipeType: "super_vibe",
    result: {
      result: "already_swiped",
      duplicate: true,
      dedupe_reason: "idempotent_replay",
      video_session_id: null,
    },
  });

  assert.equal(payload.outcome, "already_swiped");
  assert.equal(payload.duplicate, true);
  assert.equal(payload.notification_attempted, false);
  assert.equal(payload.notification_suppressed_reason, "idempotent_replay");
  assertNoForbiddenKeys(payload);
});

test("swipe result payload treats rate limits as notification-suppressed", () => {
  const payload = buildLobbySwipeResultPayload({
    eventId: "event-1",
    platform: "web",
    swipeType: "vibe",
    result: { result: "rate_limited" },
  });

  assert.equal(payload.outcome, "rate_limited");
  assert.equal(payload.notification_attempted, false);
  assert.equal(payload.notification_suppressed_reason, "rate_limited");
  assertNoForbiddenKeys(payload);
});

test("queue drain payload is low-cardinality and session-presence only", () => {
  const payload = buildQueueDrainResultPayload({
    eventId: "event-1",
    platform: "native",
    result: {
      found: true,
      reason: "promoted",
      video_session_id: "session-1",
    },
  });

  assert.equal(payload.outcome, "promoted");
  assert.equal(payload.reason, "promoted");
  assert.equal(payload.session_id_present, true);
  assertNoForbiddenKeys(payload);
});

test("web, native, and edge surfaces emit the new taxonomy", () => {
  const webLobby = read("src/pages/EventLobby.tsx");
  const webSwipe = read("src/hooks/useSwipeAction.ts");
  const webQueue = read("src/hooks/useMatchQueue.ts");
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const nativeQueue = read("apps/mobile/lib/eventsApi.ts");
  const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  const edgeSwipeActions = read("supabase/functions/swipe-actions/index.ts");

  for (const token of ["LOBBY_DECK_LOADED", "LOBBY_DECK_EMPTY", "LOBBY_DECK_ERROR", "DATE_ENTERED_FROM_LOBBY"]) {
    assert.match(webLobby, new RegExp(token));
    assert.match(nativeLobby, new RegExp(token));
  }
  for (const token of ["LOBBY_SWIPE_SUBMITTED", "LOBBY_SWIPE_RESULT", "LOBBY_SWIPE_DUPLICATE_SUPPRESSED"]) {
    assert.match(webSwipe, new RegExp(token));
    assert.match(nativeLobby, new RegExp(token));
  }
  for (const token of ["QUEUE_DRAIN_ATTEMPTED", "QUEUE_DRAIN_RESULT"]) {
    assert.match(webQueue, new RegExp(token));
    assert.match(nativeQueue, new RegExp(token));
  }
  assert.match(webReadyGate, /READY_GATE_SHOWN/);
  assert.match(nativeReadyGate, /READY_GATE_SHOWN/);
  assert.match(read("src/hooks/useReadyGate.ts"), /READY_GATE_TRANSITION/);
  assert.match(read("apps/mobile/lib/readyGateApi.ts"), /READY_GATE_TRANSITION/);

  for (const eventName of [
    "lobby_swipe_result",
    "lobby_swipe_duplicate_suppressed",
    "notification_suppressed",
    "notification_enqueued",
  ]) {
    assert.match(edgeSwipeActions, new RegExp(eventName));
  }
  assert.match(edgeSwipeActions, /actor_present/);
  assert.match(edgeSwipeActions, /target_present/);
});

test("observability docs define taxonomy, rebuild delta, and forbidden details", () => {
  const contract = read("docs/contracts/event-lobby-observability.md");
  const verification = read("docs/audits/event-lobby-observability-verification.md");
  const delta = read("docs/branch-deltas/fix-event-lobby-observability.md");

  assert.match(contract, /Deck Empty Reasons/);
  assert.match(contract, /Swipe Result Properties/);
  assert.match(contract, /Do Not Emit/);
  assert.match(contract, /notification_suppressed/);
  assert.match(verification, /Supabase project ref: `schdyxcunwcvddlcshwd`/);
  assert.match(verification, /Remote migration parity: local and remote were in parity through `20260501230000`/);
  assert.match(verification, /Rebuild Delta/);
  assert.match(delta, /Edge Functions changed/);
  assert.match(delta, /swipe-actions/);
});
