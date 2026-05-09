import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleHubItem,
  type ScheduleHubSuggestionRecord,
} from "./planningHub";

const A = "user-a";
const B = "user-b";
const C = "user-c";

function recordFor(
  status: string,
  currentRevisionProposedBy: string,
): ScheduleHubSuggestionRecord {
  return {
    id: "suggestion-1",
    match_id: "match-1",
    proposer_id: A,
    recipient_id: B,
    status,
    current_revision_id: "revision-current",
    expires_at: null,
    schedule_share_expires_at: null,
    created_at: "2026-05-09T00:00:00.000Z",
    updated_at: "2026-05-09T00:10:00.000Z",
    partner_name: "Direk",
    partner_user_id: "partner-1",
    revisions: [
      {
        id: "revision-current",
        date_suggestion_id: "suggestion-1",
        proposed_by: currentRevisionProposedBy,
        date_type_key: "coffee",
        time_choice_key: "tomorrow",
        place_mode_key: "midway",
        venue_text: null,
        optional_message: "Coffee?",
        schedule_share_enabled: false,
        starts_at: null,
        ends_at: null,
        time_block: null,
        created_at: "2026-05-09T00:10:00.000Z",
      },
    ],
    date_plan: null,
  };
}

test("schedule hub lets the original recipient answer the sender proposal", () => {
  const recipient = buildScheduleHubItem(recordFor("proposed", A), B);
  assert.ok(recipient);
  assert.equal(recipient.canAccept, true);
  assert.equal(recipient.canDecline, true);
  assert.equal(recipient.canCancel, false);
  assert.equal(recipient.isIncoming, true);

  const sender = buildScheduleHubItem(recordFor("proposed", A), A);
  assert.ok(sender);
  assert.equal(sender.canAccept, false);
  assert.equal(sender.canDecline, false);
  assert.equal(sender.canCancel, true);
  assert.equal(sender.isIncoming, false);
});

test("schedule hub lets the original proposer answer a recipient counter", () => {
  const proposer = buildScheduleHubItem(recordFor("countered", B), A);
  assert.ok(proposer);
  assert.equal(proposer.canAccept, true);
  assert.equal(proposer.canDecline, false);
  assert.equal(proposer.canCancel, true);
  assert.equal(proposer.isIncoming, true);

  const counterAuthor = buildScheduleHubItem(recordFor("countered", B), B);
  assert.ok(counterAuthor);
  assert.equal(counterAuthor.canAccept, false);
  assert.equal(counterAuthor.canDecline, false);
  assert.equal(counterAuthor.canCancel, false);
  assert.equal(counterAuthor.isIncoming, false);
});

test("schedule hub blocks non-participants and terminal responses", () => {
  const stranger = buildScheduleHubItem(recordFor("countered", B), C);
  assert.ok(stranger);
  assert.equal(stranger.canAccept, false);
  assert.equal(stranger.canDecline, false);
  assert.equal(stranger.canCancel, false);

  const terminal = buildScheduleHubItem(recordFor("accepted", A), B);
  assert.ok(terminal);
  assert.equal(terminal.canAccept, false);
  assert.equal(terminal.canDecline, false);
  assert.equal(terminal.canCancel, false);
});
