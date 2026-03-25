import assert from "node:assert/strict";
import { buildVibeGameEnvelopeV1, contentLabelForVibeGameEvent } from "./serialize";
import { foldVibeGameSession } from "./reducer";

const sid = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-0000000000aa";
const eid0 = "00000000-0000-4000-8000-000000000010";
const eid1 = "00000000-0000-4000-8000-000000000011";
const eid2 = "00000000-0000-4000-8000-000000000012";

const start = buildVibeGameEnvelopeV1({
  game_session_id: sid,
  event_id: eid0,
  event_index: 0,
  event_type: "session_start",
  game_type: "would_rather",
  actor_id: actor,
  payload: {
    option_a: "Coffee",
    option_b: "Tea",
    sender_vote: "A",
  },
});

const vote = buildVibeGameEnvelopeV1({
  game_session_id: sid,
  event_id: eid1,
  event_index: 1,
  event_type: "would_rather_vote",
  game_type: "would_rather",
  actor_id: actor,
  payload: { receiver_vote: "A" },
});

const done = buildVibeGameEnvelopeV1({
  game_session_id: sid,
  event_id: eid2,
  event_index: 2,
  event_type: "session_complete",
  game_type: "would_rather",
  actor_id: actor,
  payload: { reason: "test_complete" },
});

const { snapshot } = foldVibeGameSession([start, vote, done]);
assert.equal(snapshot.game_type, "would_rather");
if (snapshot.game_type === "would_rather") {
  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.is_match, true);
}

const label = contentLabelForVibeGameEvent("would_rather", "session_start");
assert.ok(label.includes("Would"));

console.log("vibely-games selfcheck ok");
