import assert from "node:assert/strict";
import test from "node:test";

import {
  createVideoDateNavigationIntents,
  VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS,
  VIDEO_DATE_DUPLICATE_NAVIGATION_MS,
  VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS,
  VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY,
  VIDEO_DATE_MANUAL_EXIT_SUPPRESSION_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX,
  VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
  type VideoDateIntentsStorage,
} from "./navigationIntents";

function makeMemoryStorage(): VideoDateIntentsStorage & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    dump: () => Object.fromEntries(map),
  };
}

function makeClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("TTL constants preserve the web latch/guard semantics exactly", () => {
  assert.equal(VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS, 25_000);
  assert.equal(VIDEO_DATE_ENTRY_PIPELINE_TTL_MS, 180_000);
  assert.equal(VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS, 10 * 60_000);
  assert.equal(VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS, 2 * 60_000);
  assert.equal(VIDEO_DATE_DUPLICATE_NAVIGATION_MS, 15_000);
  assert.equal(VIDEO_DATE_MANUAL_EXIT_SUPPRESSION_MS, 5 * 60_000);
  assert.equal(
    VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX,
    "vibely_video_date_route_owner_v1:",
  );
  assert.equal(
    VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY,
    "vibely:manual-video-date-exits:v1",
  );
});

test("entry latch marks, reads, expires, and clears", () => {
  const clock = makeClock();
  const intents = createVideoDateNavigationIntents({ now: clock.now });

  assert.equal(intents.isDateEntryTransitionActive("s1"), false);
  intents.markDateEntryTransition("s1");
  assert.equal(intents.isDateEntryTransitionActive("s1"), true);
  clock.advance(VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS + 1);
  assert.equal(intents.isDateEntryTransitionActive("s1"), false);

  intents.markVideoDateEntryPipelineStarted("s1");
  clock.advance(VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS + 1);
  assert.equal(
    intents.isDateEntryTransitionActive("s1"),
    true,
    "pipeline latch outlives the default latch TTL",
  );
  clock.advance(VIDEO_DATE_ENTRY_PIPELINE_TTL_MS);
  assert.equal(intents.isDateEntryTransitionActive("s1"), false);

  intents.markDateEntryTransition("s1");
  intents.clearDateEntryTransition("s1");
  assert.equal(intents.isDateEntryTransitionActive("s1"), false);
});

test("route ownership is profile-scoped with anonymous fallback and storage persistence", () => {
  const clock = makeClock();
  const storage = makeMemoryStorage();
  const intents = createVideoDateNavigationIntents({
    now: clock.now,
    ownershipStorage: () => storage,
  });

  intents.markVideoDateRouteOwned("s1", "user-a");
  assert.equal(intents.isVideoDateRouteOwned("s1", "user-a"), true);
  assert.equal(
    intents.isVideoDateRouteOwned("s1", "user-b"),
    false,
    "another profile does not inherit ownership",
  );
  assert.ok(
    storage.dump()[`${VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX}user-a:s1`],
    "ownership persists through the injected storage port",
  );

  // Anonymous ownership backs any profile on the same session.
  intents.markVideoDateRouteOwned("s2", null);
  assert.equal(intents.isVideoDateRouteOwned("s2", "user-a"), true);

  clock.advance(VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS + 1);
  assert.equal(
    intents.isVideoDateRouteOwned("s2", "user-a"),
    false,
    "anonymous ownership uses the shorter TTL",
  );
  assert.equal(intents.isVideoDateRouteOwned("s1", "user-a"), true);
  clock.advance(VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS);
  assert.equal(intents.isVideoDateRouteOwned("s1", "user-a"), false);
});

test("route ownership survives a fresh store via persisted storage (remount/reload recovery)", () => {
  const clock = makeClock();
  const storage = makeMemoryStorage();
  const first = createVideoDateNavigationIntents({
    now: clock.now,
    ownershipStorage: () => storage,
  });
  first.markVideoDateRouteOwned("s1", "user-a");

  const second = createVideoDateNavigationIntents({
    now: clock.now,
    ownershipStorage: () => storage,
  });
  assert.equal(second.isVideoDateRouteOwned("s1", "user-a"), true);

  second.clearVideoDateRouteOwnership("s1", "user-a");
  assert.equal(second.isVideoDateRouteOwned("s1", "user-a"), false);
  assert.equal(
    Object.keys(storage.dump()).filter((key) => key.endsWith(":s1")).length,
    0,
    "clear removes persisted ownership for the session",
  );
});

test("manual-exit suppression suppresses, persists, expires, and prunes", () => {
  const clock = makeClock();
  const storage = makeMemoryStorage();
  const intents = createVideoDateNavigationIntents({
    now: clock.now,
    manualExitStorage: () => storage,
  });

  assert.equal(intents.isDateNavigationSuppressedAfterManualExit("s1"), false);
  intents.suppressDateNavigationAfterManualExit("s1");
  assert.equal(intents.isDateNavigationSuppressedAfterManualExit("s1"), true);
  assert.ok(storage.dump()[VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY]);

  // A fresh store sees the persisted suppression.
  const second = createVideoDateNavigationIntents({
    now: clock.now,
    manualExitStorage: () => storage,
  });
  assert.equal(second.isDateNavigationSuppressedAfterManualExit("s1"), true);

  clock.advance(VIDEO_DATE_MANUAL_EXIT_SUPPRESSION_MS + 1);
  assert.equal(intents.isDateNavigationSuppressedAfterManualExit("s1"), false);
});

test("claimDateNavigation enforces same-route, manual-exit, and duplicate suppression with force override", () => {
  const clock = makeClock();
  const intents = createVideoDateNavigationIntents({ now: clock.now });

  assert.deepEqual(intents.claimDateNavigation("s1", "/date/s1"), {
    ok: false,
    reason: "already_on_same_date_route",
  });

  const first = intents.claimDateNavigation("s1", "/event/e1/lobby");
  assert.deepEqual(first, { ok: true });
  assert.equal(
    intents.isDateEntryTransitionActive("s1"),
    true,
    "a successful claim starts the entry pipeline latch",
  );

  assert.deepEqual(intents.claimDateNavigation("s1", "/event/e1/lobby"), {
    ok: false,
    reason: "recent_duplicate_navigation",
  });
  clock.advance(VIDEO_DATE_DUPLICATE_NAVIGATION_MS + 1);
  assert.deepEqual(intents.claimDateNavigation("s1", "/event/e1/lobby"), {
    ok: true,
  });

  intents.suppressDateNavigationAfterManualExit("s1");
  assert.deepEqual(intents.claimDateNavigation("s1", "/event/e1/lobby"), {
    ok: false,
    reason: "recent_manual_exit",
  });
  // Terminal-survey recovery must force past manual-exit/duplicate suppression.
  assert.deepEqual(
    intents.claimDateNavigation("s1", "/event/e1/lobby", { force: true }),
    { ok: true },
  );
  assert.deepEqual(
    intents.claimDateNavigation("s1", "/date/s1", { force: true }),
    { ok: false, reason: "already_on_same_date_route" },
    "same-route no-op protection survives force",
  );
});

test("corrupt persisted manual-exit payloads do not break navigation", () => {
  const storage = makeMemoryStorage();
  storage.setItem(VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY, "{not json");
  const intents = createVideoDateNavigationIntents({
    manualExitStorage: () => storage,
  });
  assert.equal(intents.isDateNavigationSuppressedAfterManualExit("s1"), false);
  assert.deepEqual(intents.claimDateNavigation("s1", "/event/e1/lobby"), {
    ok: true,
  });
});
