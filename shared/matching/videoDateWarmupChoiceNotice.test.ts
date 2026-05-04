import test from "node:test";
import assert from "node:assert/strict";
import { getVideoDateWarmupChoiceNotice } from "./videoDateWarmupChoiceNotice";

test("self timeout copy is calm and actor-relative", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: false }),
    {
      actor: "self",
      title: "Warm-up ended",
      message: "Make your private choice when it feels right.",
    },
  );
});

test("partner timeout copy is calm and actor-relative", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: false, waitingForPartner: true }),
    {
      actor: "partner",
      title: "Choice saved",
      message: "You'll only match if you both choose Vibe.",
    },
  );
});

test("both timeout copy handles neither participant choosing", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: true }),
    {
      actor: "both",
      title: "Warm-up ended",
      message: "Make your private choice when it feels right.",
    },
  );
});

test("fallback copy handles grace or missing actor fields", () => {
  assert.deepEqual(getVideoDateWarmupChoiceNotice(), {
    actor: "fallback",
    title: "Warm-up ended",
    message: "Make your private choice when it feels right.",
  });
});

test("pre-check-in timeout copy does not use premature terminal language", () => {
  const notices = [
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: false }),
    getVideoDateWarmupChoiceNotice({ waitingForSelf: false, waitingForPartner: true }),
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: true }),
    getVideoDateWarmupChoiceNotice(),
  ];

  for (const notice of notices) {
    const copy = `${notice.title} ${notice.message}`;
    assert.equal(copy.includes("won't move forward"), false);
    assert.equal(copy.includes("Warm-up wrapped"), false);
    assert.equal(copy.includes("No Vibe or Pass"), false);
  }
});
