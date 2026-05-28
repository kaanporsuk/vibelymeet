import assert from "node:assert/strict";
import {
  resolveRouletteAnswerLabels,
  resolveRouletteViewerRole,
} from "./roulettePresentation";

const starterId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const receiverId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

assert.equal(
  resolveRouletteViewerRole({ currentUserId: starterId, starterUserId: starterId }),
  "starter",
);
assert.equal(
  resolveRouletteViewerRole({ currentUserId: receiverId, starterUserId: starterId }),
  "receiver",
);

assert.deepEqual(
  resolveRouletteAnswerLabels({
    currentUserId: starterId,
    starterUserId: starterId,
    partnerName: "Direk",
  }),
  {
    viewerRole: "starter",
    senderAnswerLabel: "Your answer",
    receiverAnswerLabel: "Direk's answer",
  },
);

assert.deepEqual(
  resolveRouletteAnswerLabels({
    currentUserId: receiverId,
    starterUserId: starterId,
    partnerName: "Direk",
  }),
  {
    viewerRole: "receiver",
    senderAnswerLabel: "Direk's answer",
    receiverAnswerLabel: "Your answer",
  },
);

assert.deepEqual(
  resolveRouletteAnswerLabels({
    currentUserId: receiverId,
    starterUserId: starterId,
    partnerName: "Direk",
    fallbackViewerIsStarter: true,
  }),
  {
    viewerRole: "receiver",
    senderAnswerLabel: "Direk's answer",
    receiverAnswerLabel: "Your answer",
  },
);

assert.deepEqual(resolveRouletteAnswerLabels({ partnerName: "Direk" }), {
  viewerRole: "unknown",
  senderAnswerLabel: "Starter's answer",
  receiverAnswerLabel: "Reply answer",
});

console.log("roulettePresentation contracts passed");
