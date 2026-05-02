import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getWebEventLobbyGateState } from "../../src/lib/eventLobbyGating";

const root = process.cwd();
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const useEventDetails = readFileSync(join(root, "src/hooks/useEventDetails.ts"), "utf8");
const useEventDeck = readFileSync(join(root, "src/hooks/useEventDeck.ts"), "utf8");
const useMatchQueue = readFileSync(join(root, "src/hooks/useMatchQueue.ts"), "utf8");
const useEventStatus = readFileSync(join(root, "src/hooks/useEventStatus.ts"), "utf8");
const useEvents = readFileSync(join(root, "src/hooks/useEvents.ts"), "utf8");
const dashboard = readFileSync(join(root, "src/pages/Dashboard.tsx"), "utf8");
const venueCard = readFileSync(join(root, "src/components/events/VenueCard.tsx"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const nativeEventStatus = readFileSync(join(root, "apps/mobile/lib/eventStatus.ts"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");

const liveStart = new Date("2026-05-01T12:00:00.000Z");
const now = new Date("2026-05-01T12:15:00.000Z").getTime();

type TestEvent = {
  status: string | null;
  eventDate: Date;
  durationMinutes: number;
  archivedAt?: Date | string | number | null;
  endedAt?: Date | string | number | null;
};

function event(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    status: "live",
    eventDate: liveStart,
    durationMinutes: 60,
    ...overrides,
  };
}

function gate(overrides: Partial<Parameters<typeof getWebEventLobbyGateState>[0]> = {}) {
  return getWebEventLobbyGateState({
    eventId: "event-1",
    userId: "user-1",
    userPaused: false,
    event: event(),
    eventLoading: false,
    registration: { isConfirmed: true, isWaitlisted: false },
    registrationLoading: false,
    nowMs: now,
    ...overrides,
  });
}

test("missing event and stale direct links do not enable deck fetch", () => {
  assert.equal(gate({ event: null }).kind, "not_found");
  assert.equal(gate({ event: null }).canFetchDeck, false);
  assert.equal(gate({ eventId: undefined }).kind, "missing_event_id");
  assert.equal(gate({ eventId: undefined }).canFetchDeck, false);
});

test("registration gates block deck fetch for absent and non-confirmed seats", () => {
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: false } }).kind, "not_registered");
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: false } }).canFetchDeck, false);
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: true } }).kind, "waitlisted");
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: true } }).canFetchDeck, false);
});

test("scheduled/not-started, ended, cancelled, archived, and draft events block deck fetch", () => {
  assert.equal(
    gate({ event: event({ eventDate: new Date("2026-05-01T13:00:00.000Z") }) }).kind,
    "not_started",
  );
  assert.equal(gate({ nowMs: new Date("2026-05-01T13:01:00.000Z").getTime() }).kind, "ended");
  assert.equal(gate({ event: event({ status: "cancelled" }) }).kind, "cancelled");
  assert.equal(gate({ event: event({ status: "archived" }) }).kind, "archived");
  assert.equal(gate({ event: event({ archivedAt: "2026-05-01T12:05:00.000Z" }) }).kind, "archived");
  assert.equal(gate({ event: event({ status: "draft" }) }).kind, "draft");
  assert.equal(gate({ event: event({ endedAt: "2026-05-01T12:05:00.000Z" }) }).kind, "ended");
  for (const status of ["not_started", "ended", "cancelled", "archived", "draft"] as const) {
    const result =
      status === "not_started"
        ? gate({ event: event({ eventDate: new Date("2026-05-01T13:00:00.000Z") }) })
        : status === "ended"
          ? gate({ nowMs: new Date("2026-05-01T13:01:00.000Z").getTime() })
          : gate({ event: event({ status }) });
    assert.equal(result.canFetchDeck, false, `${status} should not fetch deck`);
    assert.equal(result.canUseLobbyActions, false, `${status} should disable swipe actions`);
  }
});

test("scheduled-active confirmed unpaused events enable deck fetch and actions", () => {
  const result = gate();
  assert.equal(result.kind, "live");
  assert.equal(result.canFetchDeck, true);
  assert.equal(result.canUseLobbyActions, true);
  assert.equal(result.canUseLobbySideEffects, true);

  const scheduledUpcoming = gate({ event: event({ status: "upcoming" }) });
  assert.equal(scheduledUpcoming.kind, "live");
  assert.equal(scheduledUpcoming.canFetchDeck, true);
  assert.equal(scheduledUpcoming.canUseLobbyActions, true);
  assert.equal(scheduledUpcoming.canUseLobbySideEffects, true);

  const paused = gate({ userPaused: true });
  assert.equal(paused.kind, "paused");
  assert.equal(paused.canFetchDeck, false);
});

test("Enter Lobby CTA scheduled-live signals match the lobby route gate", () => {
  const ctaGate = gate({ event: event({ status: "upcoming" }) });
  assert.equal(ctaGate.kind, "live");
  assert.match(useEvents, /isLive = now >= eventDate && now < eventEnd/);
  assert.match(dashboard, /isLiveEvent && isConfirmedForNextEvent[\s\S]*label: "Enter Lobby"/);
  assert.match(venueCard, /eventStatus === "live" && isRegistered[\s\S]*Enter Lobby/);
});

test("web EventLobby wires the gate into deck, queue/status side effects, actions, and ended-state UI", () => {
  assert.match(webLobby, /getWebEventLobbyGateState/);
  assert.match(webLobby, /const deckEnabled = lobbyGate\.canFetchDeck/);
  assert.match(useEventDetails, /archivedAt: data\.archived_at \? new Date\(data\.archived_at\) : null/);
  assert.match(useEventDetails, /endedAt: data\.ended_at \? new Date\(data\.ended_at\) : null/);
  assert.match(webLobby, /const lobbySideEffectsEnabled = lobbyGate\.canUseLobbySideEffects/);
  assert.match(webLobby, /const lobbyActionsEnabled = lobbyGate\.canUseLobbyActions && !showEventEndedModal/);
  assert.match(webLobby, /useEventDeck\(\{[\s\S]*enabled: deckEnabled/);
  assert.match(webLobby, /useEventStatus\(\{ eventId, enabled: lobbySideEffectsEnabled \}\)/);
  assert.match(webLobby, /useMatchQueue\(\{[\s\S]*enabled: lobbySideEffectsEnabled/);
  assert.match(webLobby, /LobbyUnavailableState/);
  assert.match(webLobby, /EventEndedModal isOpen=\{showEventEndedModal\}/);
  assert.match(webLobby, /disabled=\{isProcessing \|\| !lobbyActionsEnabled\}/);
  assert.match(webLobby, /readyGateOverlayAllowed/);
});

test("related hooks honor disabled state instead of polling or writing stale lobby status", () => {
  assert.match(useEventDeck, /enabled: enabled && !!user\?\.id && !!eventId/);
  assert.match(useMatchQueue, /enabled = true/);
  assert.match(useMatchQueue, /if \(!enabled \|\| !eventId \|\| !user\?\.id\)/);
  assert.match(useMatchQueue, /setQueuedCount\(0\)/);
  assert.match(useEventStatus, /enabledRef/);
  assert.match(useEventStatus, /if \(!enabledRef\.current\) return/);
});

test("native EventLobby blocks stale deck, status, foreground, and queue side effects with the same local truths", () => {
  assert.match(nativeEventsApi, /archived_at\?: string \| null/);
  assert.match(nativeEventsApi, /ended_at\?: string \| null/);
  assert.match(nativeLobby, /const lobbySideEffectsEnabled = Boolean\(/);
  assert.match(nativeLobby, /const deckQueryEnabled = lobbySideEffectsEnabled/);
  assert.match(nativeLobby, /useEventStatus\(id, user\?\.id \?\? undefined, lobbySideEffectsEnabled\)/);
  assert.match(nativeLobby, /if \(!id \|\| !user\?\.id \|\| !lobbySideEffectsEnabled\) return/);
  assert.match(nativeLobby, /status === 'ended' \|\| status === 'completed' \|\| row\.ended_at/);
  assert.match(nativeLobby, /status === 'cancelled' \|\| status === 'archived' \|\| status === 'draft' \|\| row\.archived_at/);
  assert.match(nativeEventStatus, /enabledRef/);
  assert.match(nativeEventStatus, /if \(!enabledRef\.current\) return/);
});
