import test from "node:test";
import assert from "node:assert/strict";
import { isWithinDiscoverHomeGraceWindow } from "./discoverEventVisibility";

const baseEvent = {
  eventDate: new Date("2026-05-08T08:45:00Z"),
  durationMinutes: 15,
};

test("discover/home grace window keeps recently ended rows only inside the approved grace period", () => {
  assert.equal(
    isWithinDiscoverHomeGraceWindow(
      { ...baseEvent, status: "ended" },
      new Date("2026-05-08T12:52:00Z").getTime(),
    ),
    true,
  );
  assert.equal(
    isWithinDiscoverHomeGraceWindow(
      { ...baseEvent, status: "completed" },
      new Date("2026-05-08T12:52:00Z").getTime(),
    ),
    true,
  );

  assert.equal(
    isWithinDiscoverHomeGraceWindow(
      { ...baseEvent, status: "ended" },
      new Date("2026-05-08T15:00:01Z").getTime(),
    ),
    false,
  );
});

test("discover/home grace window mirrors server suppression statuses", () => {
  for (const status of ["cancelled", "draft", "archived", "ARCHIVED"]) {
    assert.equal(
      isWithinDiscoverHomeGraceWindow(
        { ...baseEvent, status },
        new Date("2026-05-08T08:50:00Z").getTime(),
      ),
      false,
    );
  }
});
