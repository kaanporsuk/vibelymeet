import test from "node:test";
import assert from "node:assert/strict";
import {
  getActivityVisibilityDescription,
  getActivityVisibilityLabel,
  hasRenderablePresence,
  normalizeActivityStatusVisibility,
} from "./activityStatusVisibility";

test("normalizes valid activity visibility values", () => {
  assert.equal(normalizeActivityStatusVisibility("matches"), "matches");
  assert.equal(normalizeActivityStatusVisibility("event_connections"), "event_connections");
  assert.equal(normalizeActivityStatusVisibility("nobody"), "nobody");
});

test("falls back to matches for invalid activity visibility values", () => {
  assert.equal(normalizeActivityStatusVisibility(null), "matches");
  assert.equal(normalizeActivityStatusVisibility(undefined), "matches");
  assert.equal(normalizeActivityStatusVisibility("everyone"), "matches");
  assert.equal(normalizeActivityStatusVisibility(""), "matches");
});

test("returns canonical labels", () => {
  assert.equal(getActivityVisibilityLabel("matches"), "Matches only");
  assert.equal(getActivityVisibilityLabel("event_connections"), "Event connections");
  assert.equal(getActivityVisibilityLabel("nobody"), "Nobody");
  assert.equal(getActivityVisibilityLabel("bogus"), "Matches only");
});

test("returns canonical descriptions", () => {
  assert.equal(
    getActivityVisibilityDescription("matches"),
    "Only your matches can see when you were recently active.",
  );
  assert.equal(
    getActivityVisibilityDescription("event_connections"),
    "Your matches and people connected to you through an active event can see your activity where Vibely shows event presence.",
  );
  assert.equal(
    getActivityVisibilityDescription("nobody"),
    "Hide your active and last-seen status from other people.",
  );
});

test("detects renderable presence timestamps", () => {
  assert.equal(hasRenderablePresence("2026-04-26T10:00:00.000Z"), true);
  assert.equal(hasRenderablePresence(null), false);
  assert.equal(hasRenderablePresence(""), false);
  assert.equal(hasRenderablePresence("not-a-date"), false);
});
