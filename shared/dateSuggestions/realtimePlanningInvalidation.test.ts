import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  invalidateDateScheduleRealtimeEvent,
  type QueryInvalidationTarget,
} from "./realtimePlanningInvalidation";

function createRecorder() {
  const calls: QueryInvalidationTarget[] = [];
  return {
    calls,
    client: {
      invalidateQueries(target: QueryInvalidationTarget) {
        calls.push(target);
      },
    },
  };
}

const scope = {
  matchId: "match-a",
  currentUserId: "user-a",
  participantIds: ["user-a", "user-b"],
  threadMessagesQueryKey: ["messages", "user-b", "user-a"] as const,
};

test("date suggestion realtime invalidates canonical match date cache", () => {
  const { calls, client } = createRecorder();

  invalidateDateScheduleRealtimeEvent(client, scope, {
    table: "date_suggestions",
    matchId: "match-a",
  });

  assert.deepEqual(calls, [
    { queryKey: ["date-suggestions", "match-a"], exact: true },
    { queryKey: ["schedule-hub", "user-a"], exact: true },
  ]);
});

test("grant slot realtime invalidates shared schedule through the subject user", () => {
  const { calls, client } = createRecorder();

  invalidateDateScheduleRealtimeEvent(client, scope, {
    table: "schedule_share_grant_slots",
    matchId: "match-a",
    subjectUserId: "user-b",
  });

  assert.deepEqual(calls, [
    { queryKey: ["shared-schedule", "match-a", "user-b"], exact: true },
    { queryKey: ["date-suggestions", "match-a"], exact: true },
  ]);
});

test("user schedule realtime invalidates own grid and partner shared schedule", () => {
  const { calls, client } = createRecorder();

  invalidateDateScheduleRealtimeEvent(client, scope, {
    table: "user_schedules",
    userId: "user-a",
  });
  invalidateDateScheduleRealtimeEvent(client, scope, {
    table: "user_schedules",
    userId: "user-b",
  });

  assert.deepEqual(calls, [
    { queryKey: ["user-schedule", "user-a"], exact: true },
    { queryKey: ["schedule-hub", "user-a"], exact: true },
    { queryKey: ["shared-schedule", "match-a", "user-a"], exact: true },
    { queryKey: ["shared-schedule", "match-a", "user-b"], exact: true },
  ]);
});

test("channel error fallback refreshes thread, date, shared schedule, schedule hub, and user schedule", () => {
  const { calls, client } = createRecorder();

  invalidateDateScheduleRealtimeEvent(client, scope, {
    table: "channel_error",
    matchId: "match-a",
  });

  assert.deepEqual(calls, [
    { queryKey: ["messages", "user-b", "user-a"], exact: true },
    { queryKey: ["date-suggestions", "match-a"], exact: true },
    { queryKey: ["schedule-hub", "user-a"], exact: true },
    { queryKey: ["user-schedule", "user-a"], exact: true },
    { queryKey: ["shared-schedule", "match-a"] },
    { queryKey: ["caller-schedule-share-grant", "match-a"] },
  ]);
});

test("chat hook keeps realtime payloads on invalidation and lookup paths", () => {
  const source = readFileSync(
    join(process.cwd(), "src/hooks/useRealtimeDateScheduleState.ts"),
    "utf8",
  );
  const helper = readFileSync(
    join(process.cwd(), "shared/dateSuggestions/realtimePlanningInvalidation.ts"),
    "utf8",
  );

  assert.match(helper, /shared-schedule/);
  assert.doesNotMatch(source, /setQueryData/);
  assert.match(source, /channel\(`match-date-schedule:\$\{scope\.matchId\}`\)/);
  assert.match(source, /table: "user_schedules"/);
  assert.match(source, /filter: `user_id=eq\.\$\{currentUserId\}`/);
  assert.match(source, /supabase\.removeChannel\(channel\)/);
});
