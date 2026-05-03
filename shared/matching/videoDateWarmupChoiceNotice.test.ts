import test from "node:test";
import assert from "node:assert/strict";
import { getVideoDateWarmupChoiceNotice } from "./videoDateWarmupChoiceNotice";

test("self timeout copy is calm and actor-relative", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: false }),
    {
      actor: "self",
      title: "Warm-up wrapped before you chose",
      message: "No Vibe or Pass was selected, so this one won't move forward.",
    },
  );
});

test("partner timeout copy is calm and actor-relative", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: false, waitingForPartner: true }),
    {
      actor: "partner",
      title: "Warm-up wrapped before they chose",
      message: "They didn't choose Vibe or Pass, so this one won't move forward.",
    },
  );
});

test("both timeout copy handles neither participant choosing", () => {
  assert.deepEqual(
    getVideoDateWarmupChoiceNotice({ waitingForSelf: true, waitingForPartner: true }),
    {
      actor: "both",
      title: "Warm-up wrapped without both choices",
      message: "No Vibe or Pass choices were selected, so this one won't move forward.",
    },
  );
});

test("fallback copy handles grace or missing actor fields", () => {
  assert.deepEqual(getVideoDateWarmupChoiceNotice(), {
    actor: "fallback",
    title: "Warm-up wrapped",
    message: "The warm-up ended before both choices were in, so this one won't move forward.",
  });
});
