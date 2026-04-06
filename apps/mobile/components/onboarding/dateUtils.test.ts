import test from "node:test";
import assert from "node:assert/strict";
import { calculateAgeFromIsoDate, formatIsoDate, parseDateParts } from "./dateUtils";

test("parseDateParts rejects invalid dates and keeps leap-year dates", () => {
  assert.equal(parseDateParts("2001-02-29"), null);
  assert.equal(parseDateParts("1999-04-31"), null);
  assert.deepEqual(parseDateParts("2000-02-29"), { year: 2000, month: 2, day: 29 });
});

test("calculateAgeFromIsoDate enforces 18+ boundary correctly", () => {
  const today = new Date();
  const thisYear = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const exactly18 = formatIsoDate({ year: thisYear - 18, month, day });
  assert.equal(calculateAgeFromIsoDate(exactly18), 18);

  const almost18Date = new Date(thisYear - 18, month - 1, day + 1);
  const almost18 = formatIsoDate({
    year: almost18Date.getFullYear(),
    month: almost18Date.getMonth() + 1,
    day: almost18Date.getDate(),
  });
  const age = calculateAgeFromIsoDate(almost18);
  assert.ok(age !== null && age < 18);
});
