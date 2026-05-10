import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_HOUR_RANGES,
  TIME_BLOCKS,
  formatSlotKey,
  parseSlotKey,
  hourInBlock,
  intersectSlotKeys,
} from "./scheduleShare";

test("formatSlotKey matches the user_schedules.slot_key convention", () => {
  assert.equal(formatSlotKey("2026-05-15", "morning"), "2026-05-15_morning");
  assert.equal(formatSlotKey("2026-12-31", "night"), "2026-12-31_night");
});

test("parseSlotKey accepts valid slot keys", () => {
  for (const block of TIME_BLOCKS) {
    const key = `2026-05-15_${block}`;
    assert.deepEqual(parseSlotKey(key), { slotDate: "2026-05-15", timeBlock: block });
  }
});

test("parseSlotKey rejects malformed input", () => {
  assert.equal(parseSlotKey(null), null);
  assert.equal(parseSlotKey(undefined), null);
  assert.equal(parseSlotKey(""), null);
  assert.equal(parseSlotKey("2026-05-15"), null); // missing block
  assert.equal(parseSlotKey("2026-05-15-morning"), null); // wrong separator
  assert.equal(parseSlotKey("2026/05/15_morning"), null); // wrong date format
  assert.equal(parseSlotKey("2026-05-15_lunchtime"), null); // unknown block
});

test("BLOCK_HOUR_RANGES mirrors the SQL _block_hour_range definitions", () => {
  // Must stay in lockstep with migration 20260511130000 / _block_hour_range.
  assert.deepEqual(BLOCK_HOUR_RANGES.morning, { startHour: 8, endHour: 12 });
  assert.deepEqual(BLOCK_HOUR_RANGES.afternoon, { startHour: 12, endHour: 17 });
  assert.deepEqual(BLOCK_HOUR_RANGES.evening, { startHour: 17, endHour: 21 });
  assert.deepEqual(BLOCK_HOUR_RANGES.night, { startHour: 21, endHour: 24 });
});

test("hourInBlock is end-exclusive on each block boundary", () => {
  // Morning: [8, 12)
  assert.equal(hourInBlock(8, "morning"), true);
  assert.equal(hourInBlock(11, "morning"), true);
  assert.equal(hourInBlock(12, "morning"), false);
  assert.equal(hourInBlock(7, "morning"), false);

  // Afternoon spans noon: [12, 17)
  assert.equal(hourInBlock(12, "afternoon"), true);
  assert.equal(hourInBlock(16, "afternoon"), true);
  assert.equal(hourInBlock(17, "afternoon"), false);

  // Evening: [17, 21)
  assert.equal(hourInBlock(17, "evening"), true);
  assert.equal(hourInBlock(20, "evening"), true);
  assert.equal(hourInBlock(21, "evening"), false);

  // Night: [21, 24)
  assert.equal(hourInBlock(21, "night"), true);
  assert.equal(hourInBlock(23, "night"), true);
  assert.equal(hourInBlock(24, "night"), false);
});

test("intersectSlotKeys returns mutual overlap (preserving first-array order)", () => {
  const a = ["2026-05-15_morning", "2026-05-15_evening", "2026-05-16_afternoon"];
  const b = ["2026-05-15_evening", "2026-05-16_afternoon", "2026-05-17_night"];
  assert.deepEqual(intersectSlotKeys(a, b), ["2026-05-15_evening", "2026-05-16_afternoon"]);
});

test("intersectSlotKeys returns [] when sets are disjoint or empty", () => {
  assert.deepEqual(intersectSlotKeys([], ["2026-05-15_morning"]), []);
  assert.deepEqual(intersectSlotKeys(["2026-05-15_morning"], []), []);
  assert.deepEqual(
    intersectSlotKeys(["2026-05-15_morning"], ["2026-05-15_evening"]),
    [],
  );
});
