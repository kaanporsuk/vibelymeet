import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
  classifyDailyRoomTokenFailureClass,
  isRetryableDailyRoomFailure,
} from "./dailyRoomFailure";
import { shouldRetryVideoDateEntryHandoffFailure } from "./videoDateEntryRetryPolicy";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const contractDocPath = "docs/ready-gate-backend-contract.md";
const contractDoc = read(contractDocPath);

const webConsumerFiles = [
  "src/components/lobby/ReadyGateOverlay.tsx",
  "src/hooks/useReadyGate.ts",
  "src/pages/EventLobby.tsx",
  "src/pages/ReadyRedirect.tsx",
  "src/lib/videoDatePrepareEntry.ts",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useActiveSession.ts",
  "src/hooks/useEventStatus.ts",
  "src/hooks/useVideoCall.ts",
  "src/pages/VideoDate.tsx",
];

const nativeConsumerFiles = [
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/app/date/[id].tsx",
  "apps/mobile/lib/videoDateApi.ts",
  "apps/mobile/lib/videoDatePrepareEntry.ts",
  "apps/mobile/lib/videoDateEntryStartable.ts",
  "apps/mobile/lib/useActiveSession.ts",
];

const forbiddenVideoSessionFields = [
  "ready_gate_status",
  "ready_participant_1_at",
  "ready_participant_2_at",
  "ready_gate_expires_at",
  "snoozed_by",
  "snooze_expires_at",
  "state",
  "phase",
  "ended_at",
  "ended_reason",
];

const forbiddenRegistrationFields = [
  "queue_status",
  "current_room_id",
  "current_partner_id",
];

function assertNoForbiddenSupabaseWrites(paths: string[], table: string, fields: readonly string[]) {
  const fieldPattern = fields.map((field) => field.replace(/_/g, "_")).join("|");
  const mutationPattern = new RegExp(
    String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,1400}\.(?:update|insert|upsert)\(\s*(?:\{[\s\S]{0,900})?(?:${fieldPattern})`,
    "m",
  );

  for (const path of paths) {
    const source = read(path);
    assert.doesNotMatch(source, mutationPattern, `${path} must not directly mutate ${table} lifecycle fields`);
  }
}

test("canonical Ready Gate contract document exists and names backend surfaces", () => {
  for (const marker of [
    "swipe-actions",
    "drain_match_queue(uuid)",
    "ready_gate_transition(uuid, text, text)",
    "daily-room",
    "prepare_date_entry",
    "video_date_transition(uuid, text, text)",
    "confirm_video_date_entry_prepared(uuid, text, text, text)",
    "mark_video_date_daily_joined",
  ]) {
    assert.match(contractDoc, new RegExp(marker.replace(/[()]/g, "\\$&")));
  }
});

test("contract document freezes forbidden writes and reason vocabulary", () => {
  for (const field of [...forbiddenVideoSessionFields, ...forbiddenRegistrationFields]) {
    assert.match(contractDoc, new RegExp(field));
  }

  for (const reason of [
    "event_archived",
    "event_cancelled",
    "event_ended",
    "event_not_live",
    "event_outside_live_window",
    "ready_gate_event_archived",
    "ready_gate_event_cancelled",
    "ready_gate_event_ended",
    "ready_gate_event_inactive",
    "EVENT_NOT_ACTIVE",
  ]) {
    assert.match(contractDoc, new RegExp(reason));
  }
});

test("web consumers do not directly write Ready Gate-owned video_sessions fields", () => {
  assertNoForbiddenSupabaseWrites(webConsumerFiles, "video_sessions", forbiddenVideoSessionFields);
});

test("web consumers do not directly write Ready Gate-owned event_registrations fields", () => {
  assertNoForbiddenSupabaseWrites(webConsumerFiles, "event_registrations", forbiddenRegistrationFields);
});

test("native consumers do not directly write Ready Gate-owned video_sessions fields", () => {
  assertNoForbiddenSupabaseWrites(nativeConsumerFiles, "video_sessions", forbiddenVideoSessionFields);
});

test("native consumers do not directly write Ready Gate-owned event_registrations fields", () => {
  assertNoForbiddenSupabaseWrites(nativeConsumerFiles, "event_registrations", forbiddenRegistrationFields);
});

test("web date handoff remains gated by prepare-entry or date-capable backend truth", () => {
  const readyRedirect = read("src/pages/ReadyRedirect.tsx");
  assert.match(read("src/components/lobby/ReadyGateOverlay.tsx"), /prepareVideoDateEntry/);
  assert.match(read("src/lib/videoDatePrepareEntry.ts"), /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(readyRedirect, /adviseVideoDateSnapshotRecovery/);
  assert.match(readyRedirect, /decideCanonicalVideoDateRoute/);
  assert.match(readyRedirect, /recovery\.action === "go_date"/);
  assert.match(readyRedirect, /canonicalRoute\.target === "date"/);
  assert.match(read("src/pages/VideoDate.tsx"), /useVideoCall/);
  assert.match(read("src/hooks/useVideoCall.ts"), /prepareVideoDateEntry/);
});

test("native date handoff remains gated by prepare-entry or date-capable backend truth", () => {
  assert.match(read("apps/mobile/components/lobby/ReadyGateOverlay.tsx"), /prepareVideoDateEntry/);
  assert.match(read("apps/mobile/lib/videoDatePrepareEntry.ts"), /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(read("apps/mobile/lib/videoDateEntryStartable.ts"), /prepareVideoDateEntry/);
  assert.match(read("apps/mobile/app/ready/[id].tsx"), /ensureVideoDateStartableBeforeNavigation/);
});

test("Ready Gate API types tolerate additive backend response fields", () => {
  for (const path of ["src/hooks/useReadyGate.ts", "apps/mobile/lib/readyGateApi.ts"]) {
    const source = read(path);
    for (const field of ["reason", "inactive_reason", "error_code", "code", "terminal"]) {
      assert.match(source, new RegExp(`${field}\\??:`), `${path} should tolerate ${field}`);
    }
  }
});

test("EVENT_NOT_ACTIVE prepare-entry blockers are non-retryable client truth", async () => {
  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: {
      code: "READY_GATE_NOT_READY",
      error_code: "EVENT_NOT_ACTIVE",
      reason: "event_not_active",
      inactive_reason: "event_ended",
    },
    response: new Response(JSON.stringify({
      code: "READY_GATE_NOT_READY",
      error_code: "EVENT_NOT_ACTIVE",
    }), { status: 403 }),
  });

  assert.equal(failure.kind, "EVENT_NOT_ACTIVE");
  assert.equal(failure.retryable, false);
  assert.equal(isRetryableDailyRoomFailure("EVENT_NOT_ACTIVE"), false);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ code: "EVENT_NOT_ACTIVE" }), false);
  assert.equal(classifyDailyRoomTokenFailureClass("EVENT_NOT_ACTIVE"), "session_ended");
});

test("Streams 1, 2, and 3 backend migrations remain untouched by Stream 4", () => {
  assert.match(
    read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"),
    /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/,
  );
  assert.match(
    read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"),
    /GET DIAGNOSTICS v_row_count = ROW_COUNT/,
  );
  assert.match(
    read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"),
    /CREATE OR REPLACE FUNCTION public\.terminalize_event_ready_gates/,
  );
});
