import test from "node:test";
import assert from "node:assert/strict";

type EventPhaseModule = typeof import("../apps/mobile/lib/eventPhase");

async function loadDeriveEventPhase(): Promise<EventPhaseModule["deriveEventPhase"]> {
  const eventPhaseModule = await import("../apps/mobile/lib/eventPhase");
  const interopModule = eventPhaseModule as EventPhaseModule & { default?: EventPhaseModule };
  return (interopModule.default ?? eventPhaseModule).deriveEventPhase;
}

const start = "2026-05-08T18:00:00.000Z";
const nowMs = Date.parse("2026-05-08T18:05:00.000Z");

test("native event phase opens the lobby for active raw statuses inside the scheduled window", async () => {
  const deriveEventPhase = await loadDeriveEventPhase();
  for (const status of ["live", "upcoming", "scheduled"]) {
    const phase = deriveEventPhase({
      status,
      eventDate: start,
      eventDurationMinutes: 30,
      nowMs,
    });

    assert.equal(phase.phase, "live", status);
    assert.equal(phase.isLive, true, status);
    assert.equal(phase.isLobbyOpen, true, status);
    assert.equal(phase.isEnded, false, status);
  }
});

test("native event phase closes archived rows even inside the scheduled window", async () => {
  const deriveEventPhase = await loadDeriveEventPhase();
  for (const input of [
    { status: "archived" },
    { status: "live", archived_at: "2026-05-08T17:30:00.000Z" },
  ]) {
    const phase = deriveEventPhase({
      ...input,
      eventDate: start,
      eventDurationMinutes: 30,
      nowMs,
    });

    assert.equal(phase.phase, "ended", input.status);
    assert.equal(phase.isLive, false, input.status);
    assert.equal(phase.isLobbyOpen, false, input.status);
    assert.equal(phase.isEnded, true, input.status);
  }
});
