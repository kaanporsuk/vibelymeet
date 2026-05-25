import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatVideoDateQueueHintLabel,
  resolveEventDeckPhase4UiState,
  resolveVideoDateHandshakeUiState,
  shouldShowVideoDateIceBreaker,
} from "./videoDatePhase4Ux";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const decidedAt = "2026-05-24T08:00:00.000Z";

test("Phase 4 handshake UI derives local and partner decisions from decided_at truth", () => {
  const truth = {
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    participant_1_liked: true,
    participant_2_liked: false,
    participant_1_decided_at: decidedAt,
    participant_2_decided_at: "2026-05-24T08:00:05.000Z",
  };

  assert.deepEqual(resolveVideoDateHandshakeUiState(truth, "user-a"), {
    localDecision: true,
    localHasDecided: true,
    partnerHasDecided: true,
  });
  assert.deepEqual(resolveVideoDateHandshakeUiState(truth, "user-b"), {
    localDecision: false,
    localHasDecided: true,
    partnerHasDecided: true,
  });
});

test("Phase 4 handshake UI treats legacy liked=false without decided_at as undecided", () => {
  const state = resolveVideoDateHandshakeUiState(
    {
      participant_1_id: "user-a",
      participant_2_id: "user-b",
      participant_1_liked: false,
      participant_2_liked: true,
      participant_1_decided_at: null,
      participant_2_decided_at: decidedAt,
    },
    "user-a",
  );

  assert.deepEqual(state, {
    localDecision: null,
    localHasDecided: false,
    partnerHasDecided: true,
  });
});

test("Phase 4 icebreaker is hidden only after a persisted local handshake decision", () => {
  assert.equal(shouldShowVideoDateIceBreaker({ baseVisible: true, phase: "handshake", localHasDecided: true }), false);
  assert.equal(shouldShowVideoDateIceBreaker({ baseVisible: true, phase: "handshake", localHasDecided: false }), true);
  assert.equal(shouldShowVideoDateIceBreaker({ baseVisible: true, phase: "date", localHasDecided: true }), true);
  assert.equal(shouldShowVideoDateIceBreaker({ baseVisible: false, phase: "handshake", localHasDecided: false }), false);
});

test("Phase 4 deck UI distinguishes terminal, ineligible, empty, and retry states", () => {
  assert.deepEqual(
    resolveEventDeckPhase4UiState({
      platform: "native",
      deckStateReason: "event_not_active",
      inactiveReason: "event_ended",
    }),
    {
      kind: "event_ended",
      reason: "event_ended",
      badge: "Event ended",
      title: "This event has ended",
      message: "The live lobby is closed. Check your matches to keep the conversation going.",
      actionLabel: "View matches",
      actionTarget: "matches",
      showRefresh: false,
      showMysteryMatch: false,
      retryable: false,
      terminal: true,
    },
  );

  assert.equal(
    resolveEventDeckPhase4UiState({
      platform: "web",
      deckStateReason: "event_not_active",
      inactiveReason: "event_not_started",
    }).actionTarget,
    "event",
  );
  assert.equal(resolveEventDeckPhase4UiState({ platform: "web", deckStateReason: "not_registered" }).showRefresh, false);
  assert.equal(resolveEventDeckPhase4UiState({ platform: "native", deckStateReason: "viewer_paused" }).showMysteryMatch, false);
  assert.equal(resolveEventDeckPhase4UiState({ platform: "web", deckStateReason: "no_confirmed_candidates" }).badge, "Room warming up");
  assert.equal(resolveEventDeckPhase4UiState({ platform: "web", deckStateReason: "no_remaining_profiles" }).title, "You've seen everyone for now");
  assert.equal(resolveEventDeckPhase4UiState({ platform: "native", deckStateReason: "scan_window_exhausted" }).showMysteryMatch, true);
  assert.equal(resolveEventDeckPhase4UiState({ platform: "web", deckErrorReason: "network_error" }).actionLabel, "Retry");
  assert.equal(resolveEventDeckPhase4UiState({ platform: "native", deckErrorReason: "rpc_error" }).retryable, true);
});

test("Phase 4 queue labels stay approximate and expose priority relief", () => {
  assert.equal(
    formatVideoDateQueueHintLabel(
      {
        ok: true,
        queued: true,
        reason: null,
        sessionId: "session-1",
        eventQueuedCount: 4,
        userQueuedCount: 1,
        position: 3,
        waitAgeSeconds: 90,
        estimatedWaitSeconds: 65,
        reliefActive: true,
      },
      0,
    ),
    "Position 3 · ~2m · priority boost",
  );
  assert.equal(formatVideoDateQueueHintLabel(null, 1), "1 waiting in queue");
  assert.equal(
    formatVideoDateQueueHintLabel(
      {
        ok: true,
        queued: false,
        reason: null,
        sessionId: null,
        eventQueuedCount: 5,
        userQueuedCount: 0,
        position: null,
        waitAgeSeconds: 0,
        estimatedWaitSeconds: null,
        reliefActive: false,
      },
      2,
    ),
    "5 waiting in queue",
  );
  assert.equal(
    formatVideoDateQueueHintLabel(
      {
        ok: true,
        queued: true,
        reason: null,
        sessionId: "session-2",
        eventQueuedCount: 5,
        userQueuedCount: 1,
        position: null,
        waitAgeSeconds: 45,
        estimatedWaitSeconds: 35,
        reliefActive: true,
      },
      0,
    ),
    "5 waiting in queue · ~35s · priority boost",
  );
  assert.equal(
    formatVideoDateQueueHintLabel(
      {
        ok: true,
        queued: true,
        reason: null,
        sessionId: "session-3",
        eventQueuedCount: 0,
        userQueuedCount: 1,
        position: null,
        waitAgeSeconds: 20,
        estimatedWaitSeconds: 12,
        reliefActive: false,
      },
      0,
    ),
    "1 waiting in queue · ~15s",
  );
});

test("Phase 4 web/native surfaces consume shared UX helpers", () => {
  const webVideoDate = read("src/pages/VideoDate.tsx");
  const nativeVideoDate = read("apps/mobile/app/date/[id].tsx");
  const webLobby = read("src/pages/EventLobby.tsx");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const webButton = read("src/components/video-date/VibeCheckButton.tsx");
  const nativeButton = read("apps/mobile/components/video-date/VibeCheckButton.tsx");

  for (const source of [webVideoDate, nativeVideoDate]) {
    assert.match(source, /resolveVideoDateHandshakeUiState/);
    assert.match(source, /shouldShowVideoDateIceBreaker/);
    assert.match(source, /localHasDecided=\{localHandshakeHasDecided\}/);
    assert.match(source, /partnerHasDecided=\{partnerHandshakeHasDecided\}/);
  }

  for (const source of [webButton, nativeButton]) {
    assert.match(source, /They've chosen/);
    assert.match(source, /They've chosen too/);
    assert.doesNotMatch(source, /participant_[12]_liked/);
  }

  assert.match(webLobby, /resolveEventDeckPhase4UiState/);
  assert.match(nativeLobby, /resolveEventDeckPhase4UiState/);
  assert.match(webLobby, /deckState\?\.inactive_reason/);
  assert.match(nativeLobby, /deckState\?\.inactive_reason/);
  assert.match(webLobby, /formatVideoDateQueueHintLabel/);
  assert.match(nativeLobby, /formatVideoDateQueueHintLabel/);
  assert.match(webLobby, /emptyDeckUiState\.showRefresh/);
  assert.match(webLobby, /deckErrorUiState\.actionLabel \|\| deckErrorUiState\.showRefresh/);
  assert.match(webLobby, /deckErrorUiState\.actionTarget === "matches"[\s\S]+navigate\("\/matches"/);
  assert.match(webLobby, /deckErrorUiState\.actionTarget === "event"[\s\S]+navigate\(eventId \? `\/events\/\$\{eventId\}` : "\/events"/);
  assert.match(nativeLobby, /router\.replace\('\/\(tabs\)\/matches'\)/);
  assert.match(nativeLobby, /emptyDeckUiState\.showMysteryMatch/);
  assert.match(nativeLobby, /emptyDeckUiState\.showRefresh/);
});
