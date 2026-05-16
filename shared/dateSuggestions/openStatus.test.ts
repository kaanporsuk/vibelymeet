import test from "node:test";
import assert from "node:assert/strict";

import {
  dateSuggestionBlocksNewProposal,
  dateSuggestionWindowEndMs,
  findBlockingDateSuggestion,
  matchHasOpenDateSuggestion,
} from "./openStatus";

test("exact date suggestions stop blocking after starts_at", () => {
  const suggestion = {
    status: "proposed",
    created_at: "2026-05-17T09:00:00.000Z",
    expires_at: "2026-05-24T09:00:00.000Z",
    current_revision_id: "rev-1",
    revisions: [
      {
        id: "rev-1",
        time_choice_key: "pick_a_time",
        starts_at: "2026-05-17T10:00:00.000Z",
        created_at: "2026-05-17T09:00:00.000Z",
        local_timezone: "Europe/Istanbul",
      },
    ],
  };

  assert.equal(dateSuggestionBlocksNewProposal(suggestion, Date.parse("2026-05-17T09:59:59.000Z")), true);
  assert.equal(dateSuggestionBlocksNewProposal(suggestion, Date.parse("2026-05-17T10:00:01.000Z")), false);
});

test("vague weekend and next-week suggestions stop blocking after inferred local windows", () => {
  const anchor = "2026-05-15T12:00:00.000Z";
  const common = {
    status: "proposed",
    created_at: anchor,
    expires_at: "2026-05-22T12:00:00.000Z",
    current_revision_id: "rev-1",
  };

  const thisWeekendEnd = dateSuggestionWindowEndMs({
    timeChoiceKey: "this_weekend",
    anchorCreatedAt: anchor,
    localTimezone: "Europe/Istanbul",
  });
  assert.equal(thisWeekendEnd, Date.parse("2026-05-17T21:00:00.000Z"));

  const weekend = {
    ...common,
    revisions: [
      {
        id: "rev-1",
        time_choice_key: "this_weekend",
        starts_at: null,
        created_at: anchor,
        local_timezone: "Europe/Istanbul",
      },
    ],
  };
  assert.equal(dateSuggestionBlocksNewProposal(weekend, Date.parse("2026-05-17T20:59:59.000Z")), true);
  assert.equal(dateSuggestionBlocksNewProposal(weekend, Date.parse("2026-05-17T21:00:01.000Z")), false);

  const nextWeekEnd = dateSuggestionWindowEndMs({
    timeChoiceKey: "next_week",
    anchorCreatedAt: anchor,
    localTimezone: "Europe/Istanbul",
  });
  assert.equal(nextWeekEnd, Date.parse("2026-05-24T21:00:00.000Z"));
});

test("tonight, tomorrow, drafts, and schedule-share keep their intended blocking policy", () => {
  const anchor = "2026-05-17T10:00:00.000Z";

  assert.equal(
    dateSuggestionWindowEndMs({
      timeChoiceKey: "tonight",
      anchorCreatedAt: anchor,
      localTimezone: "UTC",
    }),
    Date.parse("2026-05-18T00:00:00.000Z"),
  );
  assert.equal(
    dateSuggestionWindowEndMs({
      timeChoiceKey: "tomorrow",
      anchorCreatedAt: anchor,
      localTimezone: "UTC",
    }),
    Date.parse("2026-05-19T00:00:00.000Z"),
  );

  assert.equal(dateSuggestionBlocksNewProposal({ status: "draft" }), true);
  assert.equal(
    dateSuggestionBlocksNewProposal(
      {
        status: "proposed",
        expires_at: "2026-05-24T00:00:00.000Z",
        schedule_share_expires_at: "2026-05-18T00:00:00.000Z",
        current_revision_id: "rev-share",
        revisions: [
          {
            id: "rev-share",
            time_choice_key: "share_schedule",
            schedule_share_enabled: true,
            created_at: anchor,
            local_timezone: "UTC",
          },
        ],
      },
      Date.parse("2026-05-17T23:59:00.000Z"),
    ),
    true,
  );
  assert.equal(
    dateSuggestionBlocksNewProposal(
      {
        status: "proposed",
        expires_at: "2026-05-24T00:00:00.000Z",
        schedule_share_expires_at: "2026-05-18T00:00:00.000Z",
        current_revision_id: "rev-share",
        revisions: [
          {
            id: "rev-share",
            time_choice_key: "share_schedule",
            schedule_share_enabled: true,
            created_at: anchor,
            local_timezone: "UTC",
          },
        ],
      },
      Date.parse("2026-05-18T00:00:01.000Z"),
    ),
    false,
  );
  assert.equal(
    findBlockingDateSuggestion(
      [
        { status: "expired" },
        {
          status: "proposed",
          current_revision_id: "rev-past",
          revisions: [
            {
              id: "rev-past",
              time_choice_key: "pick_a_time",
              starts_at: "2026-05-17T09:00:00.000Z",
            },
          ],
        },
      ],
      Date.parse("2026-05-17T10:00:00.000Z"),
    ),
    null,
  );
});

test("open-status helper remains separate from time-window blocking", () => {
  const pastExactSuggestion = {
    status: "proposed",
    current_revision_id: "rev-past",
    revisions: [
      {
        id: "rev-past",
        time_choice_key: "pick_a_time",
        starts_at: "2026-05-17T09:00:00.000Z",
      },
    ],
  };

  assert.equal(
    dateSuggestionBlocksNewProposal(pastExactSuggestion, Date.parse("2026-05-17T10:00:00.000Z")),
    false,
  );
  assert.equal(matchHasOpenDateSuggestion([pastExactSuggestion]), true);
});
