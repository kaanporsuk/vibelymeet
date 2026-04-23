import test from "node:test";
import assert from "node:assert/strict";
import { isMatchQueueDrainEligible } from "./matchQueueDrainEligibility";

test("lobby-like statuses are always drain-eligible", () => {
  assert.equal(isMatchQueueDrainEligible("browsing"), true);
  assert.equal(isMatchQueueDrainEligible("idle"), true);
});

test("in_survey drains only when survey phase explicitly opts in", () => {
  assert.equal(isMatchQueueDrainEligible("in_survey"), false);
  assert.equal(isMatchQueueDrainEligible("in_survey", { enableSurveyPhaseDrain: false }), false);
  assert.equal(isMatchQueueDrainEligible("in_survey", { enableSurveyPhaseDrain: true }), true);
});

test("other statuses are not drain-eligible", () => {
  assert.equal(isMatchQueueDrainEligible("in_ready_gate"), false);
  assert.equal(isMatchQueueDrainEligible("offline"), false);
});
