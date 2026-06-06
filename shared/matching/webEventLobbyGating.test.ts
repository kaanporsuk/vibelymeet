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
const eventDetails = readFileSync(join(root, "src/pages/EventDetails.tsx"), "utf8");
const venueCard = readFileSync(join(root, "src/components/events/VenueCard.tsx"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const nativeEventStatus = readFileSync(join(root, "apps/mobile/lib/eventStatus.ts"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const nativeEventPhase = readFileSync(join(root, "apps/mobile/lib/eventPhase.ts"), "utf8");
const nativeVenueCard = readFileSync(join(root, "apps/mobile/components/events/VenueCard.tsx"), "utf8");
const nativeEventDetails = readFileSync(join(root, "apps/mobile/app/(tabs)/events/[id].tsx"), "utf8");
const nativeHome = readFileSync(join(root, "apps/mobile/app/(tabs)/index.tsx"), "utf8");

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

test("registration gates block deck fetch for absent and non-confirmed registrations", () => {
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: false } }).kind, "not_registered");
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: false } }).canFetchDeck, false);
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: true } }).kind, "waitlisted");
  assert.equal(gate({ registration: { isConfirmed: false, isWaitlisted: true } }).canFetchDeck, false);
});

test("scheduled/not-started, manually ended, cancelled, archived, and draft events block deck fetch", () => {
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
  for (const rawStatus of ["live", "upcoming", "scheduled"] as const) {
    const result = gate({ event: event({ status: rawStatus }) });
    assert.equal(result.kind, "live", rawStatus);
    assert.equal(result.canFetchDeck, true, rawStatus);
    assert.equal(result.canUseLobbyActions, true, rawStatus);
    assert.equal(result.canUseLobbySideEffects, true, rawStatus);
  }

  for (const status of ["ended", "completed"]) {
    const terminal = gate({ event: event({ status, endedAt: null }) });
    assert.equal(terminal.kind, "ended", status);
    assert.equal(terminal.canFetchDeck, false, status);
    assert.equal(terminal.canUseLobbyActions, false, status);
    assert.equal(terminal.canUseLobbySideEffects, false, status);
  }

  const paused = gate({ userPaused: true });
  assert.equal(paused.kind, "paused");
  assert.equal(paused.canFetchDeck, false);
});

test("Enter Lobby CTA scheduled-live signals match the lobby route gate", () => {
  for (const rawStatus of ["live", "upcoming", "scheduled"] as const) {
    const ctaGate = gate({ event: event({ status: rawStatus }) });
    assert.equal(ctaGate.kind, "live", rawStatus);
  }
  assert.match(useEvents, /resolveEventLifecycle/);
  assert.match(dashboard, /isLiveEvent && isConfirmedForNextEvent[\s\S]*label: "Enter Lobby"/);
  assert.match(venueCard, /resolveEventLifecycle/);
  assert.match(eventDetails, /eventArchivedAt=\{event\.archivedAt\}/);
  assert.match(venueCard, /archivedAt: eventArchivedAt/);
  assert.match(venueCard, /lifecycle\.isArchived \|\| lifecycle\.isEnded/);
  assert.match(venueCard, /lobbyLifecycleStatus === "live" && isRegistered[\s\S]*Enter Lobby/);
  assert.match(nativeEventPhase, /archivedAt\?: Date \| string \| number \| null/);
  assert.match(nativeEventPhase, /archivedAt: input\.archivedAt \?\? input\.archived_at/);
  assert.match(nativeEventPhase, /const isEnded = lifecycle\.isArchived \|\| lifecycle\.isEnded/);
  assert.match(nativeVenueCard, /archivedAt: eventArchivedAt/);
  assert.match(nativeEventDetails, /archived_at: eventRow\.archived_at[\s\S]*nowMs: phaseClockMs/);
  assert.match(nativeEventDetails, /eventArchivedAt=\{eventRow\.archived_at\}/);
  assert.match(nativeHome, /const nextEventStatus = nextEvent\?\.status/);
  assert.match(nativeHome, /status: nextEventStatus/);
});

test("web EventLobby wires the gate into deck, queue/status side effects, actions, and ended-state UI", () => {
  assert.match(webLobby, /getWebEventLobbyGateState/);
  assert.match(webLobby, /const deckEnabled = lobbyGate\.canFetchDeck/);
  assert.match(useEventDetails, /archivedAt: data\.archived_at \? new Date\(data\.archived_at\) : null/);
  assert.match(useEventDetails, /endedAt: data\.ended_at \? new Date\(data\.ended_at\) : null/);
  assert.match(webLobby, /const lobbySideEffectsEnabled = lobbyGate\.canUseLobbySideEffects/);
  assert.match(webLobby, /const lobbyActionsEnabled =\s*lobbyGate\.canUseLobbyActions && !showEventEndedModal/);
  assert.match(webLobby, /const deckFetchEnabled = deckEnabled && !readyGatePressureActive/);
  assert.match(webLobby, /useEventDeck\(\{[\s\S]*enabled: deckFetchEnabled/);
  assert.match(webLobby, /useEventStatus\(\{\s*eventId,\s*enabled: lobbySideEffectsEnabled,\s*\}\)/);
  assert.match(webLobby, /useMatchQueue\(\{[\s\S]*enabled: lobbySideEffectsEnabled/);
  assert.match(webLobby, /LobbyUnavailableState/);
  assert.match(webLobby, /EventEndedModal isOpen=\{showEventEndedModal\}/);
  assert.match(
    webLobby,
    /const currentSwipePending = currentProfile\s*\?\s*pendingSwipeTargetIds\.has\(currentProfile\.id\)\s*:\s*false/,
  );
  assert.match(webLobby, /pendingSwipeTargetIdsRef\.current\.has\(currentProfile\.id\)/);
  assert.match(webLobby, /const swipeControlsDisabled =[\s\S]*currentSwipePending[\s\S]*!lobbyActionsEnabled[\s\S]*swipeRateLimited/);
  assert.match(webLobby, /disabled=\{swipeControlsDisabled\}/);
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
  assert.match(nativeLobby, /const deckQueryEnabled = Boolean\(/);
  assert.match(nativeLobby, /const deckQueryEnabled = Boolean\([\s\S]+isConfirmedRegistration[\s\S]+!pauseStatus\.isPaused[\s\S]+!isEventCancelled[\s\S]+!isEventArchived[\s\S]+!isEventDraft[\s\S]+!isEventEndedByTruth[\s\S]+resolvedEventLifecycle\?\.isLive/);
  assert.match(
    nativeLobby,
    /useEventDeck\(\s*id,\s*user\?\.id \?\? null,\s*deckQueryEnabled,\s*\{[\s\S]*refetchIntervalMs: deckAdaptiveRefetchIntervalMs[\s\S]*\}\s*\)/,
  );
  assert.match(nativeLobby, /const queueHintEnabled =\s*deckQueryEnabled/);
  assert.match(nativeLobby, /useEventStatus\(id, user\?\.id \?\? undefined, lobbySideEffectsEnabled\)/);
  assert.match(nativeLobby, /if \(!id \|\| !user\?\.id \|\| !lobbySideEffectsEnabled\) return/);
  assert.match(nativeLobby, /resolveEventLifecycle/);
  assert.match(
    nativeLobby,
    /if \(row\.ended_at \|\| status === ['"]ended['"] \|\| status === ['"]completed['"]\)\s*setShowEventEndedModal\(true\)/,
  );
  assert.match(
    nativeLobby,
    /status === ['"]cancelled['"][\s\S]*status === ['"]archived['"][\s\S]*status === ['"]draft['"][\s\S]*row\.archived_at/,
  );
  assert.match(nativeEventsApi, /resolveEventLifecycle/);
  assert.match(nativeEventStatus, /enabledRef/);
  assert.match(nativeEventStatus, /if \(!enabledRef\.current\) return/);
});
