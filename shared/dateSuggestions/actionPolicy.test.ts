import test from "node:test";
import assert from "node:assert/strict";
import { getDateSuggestionActionPolicy } from "./actionPolicy";

const A = "user-a";
const B = "user-b";
const C = "user-c";

function policyFor(currentUserId: string, status: string, currentRevisionProposedBy: string) {
  return getDateSuggestionActionPolicy({
    status,
    currentUserId,
    proposerId: A,
    recipientId: B,
    currentRevisionProposedBy,
    hasCurrentRevision: true,
  });
}

test("original recipient can counter the sender proposal", () => {
  const recipient = policyFor(B, "proposed", A);
  assert.equal(recipient.canAccept, true);
  assert.equal(recipient.canCounter, true);
  assert.equal(recipient.canNotNow, true);
  assert.equal(recipient.canDecline, true);

  const sender = policyFor(A, "proposed", A);
  assert.equal(sender.canAccept, false);
  assert.equal(sender.canCounter, false);
  assert.equal(sender.canCancel, true);
});

test("original proposer can answer a recipient counter", () => {
  const proposer = policyFor(A, "countered", B);
  assert.equal(proposer.canAccept, true);
  assert.equal(proposer.canCounter, true);
  assert.equal(proposer.canNotNow, true);
  assert.equal(proposer.canDecline, false);
  assert.equal(proposer.canCancel, true);

  const counterAuthor = policyFor(B, "countered", B);
  assert.equal(counterAuthor.canAccept, false);
  assert.equal(counterAuthor.canCounter, false);
  assert.equal(counterAuthor.canDecline, false);
});

test("viewed status still belongs to the latest non-author", () => {
  assert.equal(policyFor(A, "viewed", B).canCounter, true);
  assert.equal(policyFor(B, "viewed", B).canCounter, false);
});

test("non-participants and terminal statuses cannot respond", () => {
  assert.equal(policyFor(C, "countered", B).canCounter, false);
  assert.equal(policyFor(B, "accepted", A).canCounter, false);
  assert.equal(policyFor(B, "declined", A).canAccept, false);
  assert.equal(
    getDateSuggestionActionPolicy({
      status: "proposed",
      currentUserId: B,
      proposerId: A,
      recipientId: B,
      currentRevisionProposedBy: null,
      hasCurrentRevision: false,
    }).canCounter,
    false,
  );
});

test("full sender/recipient/latest-author matrix stays consistent", () => {
  const originalProposalSender = policyFor(A, "proposed", A);
  assert.equal(originalProposalSender.canAccept, false);
  assert.equal(originalProposalSender.canCounter, false);
  assert.equal(originalProposalSender.canNotNow, false);
  assert.equal(originalProposalSender.canDecline, false);
  assert.equal(originalProposalSender.canCancel, true);

  const originalProposalRecipient = policyFor(B, "proposed", A);
  assert.equal(originalProposalRecipient.canAccept, true);
  assert.equal(originalProposalRecipient.canCounter, true);
  assert.equal(originalProposalRecipient.canNotNow, true);
  assert.equal(originalProposalRecipient.canDecline, true);
  assert.equal(originalProposalRecipient.canCancel, false);

  const recipientCounterOriginalProposer = policyFor(A, "countered", B);
  assert.equal(recipientCounterOriginalProposer.canAccept, true);
  assert.equal(recipientCounterOriginalProposer.canCounter, true);
  assert.equal(recipientCounterOriginalProposer.canNotNow, true);
  assert.equal(recipientCounterOriginalProposer.canDecline, false);
  assert.equal(recipientCounterOriginalProposer.canCancel, true);

  const recipientCounterAuthor = policyFor(B, "countered", B);
  assert.equal(recipientCounterAuthor.canAccept, false);
  assert.equal(recipientCounterAuthor.canCounter, false);
  assert.equal(recipientCounterAuthor.canNotNow, false);
  assert.equal(recipientCounterAuthor.canDecline, false);
  assert.equal(recipientCounterAuthor.canCancel, false);

  const proposerCounterRecipient = policyFor(B, "countered", A);
  assert.equal(proposerCounterRecipient.canAccept, true);
  assert.equal(proposerCounterRecipient.canCounter, true);
  assert.equal(proposerCounterRecipient.canNotNow, true);
  assert.equal(proposerCounterRecipient.canDecline, true);

  const draftSender = policyFor(A, "draft", A);
  assert.equal(draftSender.canEditDraft, true);
  assert.equal(draftSender.canCancel, true);
  assert.equal(draftSender.canRespondToCurrent, false);

  for (const terminal of ["accepted", "declined", "not_now", "expired", "cancelled", "completed"]) {
    const recipient = policyFor(B, terminal, A);
    const sender = policyFor(A, terminal, A);
    assert.equal(recipient.canRespondToCurrent, false, `${terminal}: recipient cannot respond`);
    assert.equal(sender.canCancel, false, `${terminal}: sender cannot cancel`);
  }
});
