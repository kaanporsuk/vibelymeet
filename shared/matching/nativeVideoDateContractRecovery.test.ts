import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const nativeEntryStartable = read("apps/mobile/lib/videoDateEntryStartable.ts");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");
const nativeReadyOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const dailyRoom = read("supabase/functions/daily-room/index.ts");

const nativeVideoDateFiles = [
  "apps/mobile/app/date/[id].tsx",
  "apps/mobile/lib/videoDateApi.ts",
  "apps/mobile/lib/videoDatePrepareEntry.ts",
  "apps/mobile/lib/videoDateEntryStartable.ts",
  "apps/mobile/lib/useActiveSession.ts",
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
  "apps/mobile/app/ready/[id].tsx",
];

const forbiddenVideoSessionFields = [
  "phase",
  "state",
  "started_at",
  "ended_at",
  "ended_reason",
  "handshake_started_at",
  "date_started_at",
  "daily_room_name",
  "daily_room_url",
  "participant_1_joined_at",
  "participant_2_joined_at",
  "participant_1_liked",
  "participant_2_liked",
  "participant_1_decided_at",
  "participant_2_decided_at",
];

const forbiddenRegistrationFields = [
  "queue_status",
  "current_room_id",
  "current_partner_id",
];

function assertNoForbiddenSupabaseWrites(paths: string[], table: string, fields: readonly string[]) {
  const fieldPattern = fields.join("|");
  const mutationPattern = new RegExp(
    String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,1400}\.(?:update|insert|upsert)\(\s*(?:\{[\s\S]{0,900})?(?:${fieldPattern})`,
    "m",
  );

  for (const path of paths) {
    assert.doesNotMatch(read(path), mutationPattern, `${path} must not directly mutate ${table} lifecycle fields`);
  }
}

test("native date route exists and gates bootstrap on backend video-date truth", () => {
  assert.match(nativeDateRoute, /fetchVideoSessionDateEntryTruthCoalesced\(sessionId\)/);
  assert.match(nativeDateRoute, /getVideoSessionPartnerIdForUser\(vs, user\.id\)/);
  assert.match(nativeDateRoute, /decideVideoSessionRouteFromTruth\(vs\)/);
  assert.match(nativeDateRoute, /canAttemptDailyRoomFromVideoSessionTruth\(vs\)/);
  assert.match(nativeDateRoute, /setDateEntryPermissionEligible\(true\)/);
  assert.match(nativeDateRoute, /setDateEntryPermissionEligible\(false\)/);
});

test("native date entry remains prepare-entry and Daily-room gated", () => {
  assert.match(nativeVideoDateApi, /prepareVideoDateEntry\(sessionId, \{ source: 'native_video_date_token' \}\)/);
  assert.match(nativePrepareEntry, /supabase\.functions\.invoke\('daily-room'/);
  assert.match(nativePrepareEntry, /action:\s*PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativePrepareEntry, /VIDEO_DATE_PREPARE_ENTRY_STARTED/);
  assert.match(nativePrepareEntry, /VIDEO_DATE_PREPARE_ENTRY_SUCCESS/);
  assert.match(nativePrepareEntry, /VIDEO_DATE_PREPARE_ENTRY_FAILURE/);
  assert.match(dailyRoom, /prepare_date_entry/);
});

test("native pre-navigation helper refuses stale handoff before date navigation", () => {
  assert.match(nativeEntryStartable, /fetchVideoSessionDateEntryTruth\(sessionId\)/);
  assert.match(nativeEntryStartable, /decideVideoSessionRouteFromTruth\(truth\)/);
  assert.match(nativeEntryStartable, /canAttemptDailyRoomFromVideoSessionTruth\(truth\)/);
  assert.match(nativeEntryStartable, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeEntryStartable, /isReadyGatePrepareEntryNonRetryable/);
  assert.match(nativeEntryStartable, /prepare_entry_event_inactive/);
  assert.match(nativeEntryStartable, /recommend:\s*'ended'/);
  assert.match(nativeEntryStartable, /READY_GATE_RACE_RETRY_BACKOFFS_MS/);
});

test("native video-date lifecycle uses backend RPC surfaces", () => {
  assert.match(nativeVideoDateApi, /Uses same contracts as web: daily-room Edge Function, video_date_transition RPC/);
  assert.match(nativeVideoDateApi, /supabase\.rpc\('video_date_transition'/);
  assert.match(nativeVideoDateApi, /action:\s*'enter_handshake'/);
  assert.match(nativeVideoDateApi, /action:\s*'sync_reconnect'/);
  assert.match(nativeVideoDateApi, /action:\s*'mark_reconnect_return'/);
  assert.match(nativeVideoDateApi, /action:\s*'end'/);
  assert.match(nativeVideoDateApi, /action:\s*'complete_handshake'/);
  assert.match(nativeDateRoute, /markDailyJoinedWithBackoff/);
  assert.match(nativeDateRoute, /supabase\.rpc\('mark_video_date_daily_joined'/);
});

test("native date route handles ended and event-inactive/stale blockers without retry loops", () => {
  assert.match(nativeDateRoute, /case 'SESSION_ENDED':/);
  assert.match(nativeDateRoute, /case 'EVENT_NOT_ACTIVE':/);
  assert.match(nativeDateRoute, /truthDecision === 'ended'/);
  assert.match(nativeDateRoute, /shouldRecoverPendingPostDateSurvey/);
  assert.match(nativeDateRoute, /recoverFromNotStartableDateTruth/);
  assert.match(nativeDateRoute, /clearDateEntryTransition\(sessionId\)/);
  assert.match(nativeDateRoute, /ready_gate_not_ready_recover_to_ready/);
  assert.match(nativeDateRoute, /ready_gate_not_ready_recover_to_lobby/);
  assert.match(nativeDateRoute, /ready_gate_not_ready_recover_to_tabs/);
});

test("native date route has session-scoped duplicate join and terminal recovery guards", () => {
  for (const marker of [
    "hasStartedJoinRef",
    "prejoinAttemptRef",
    "joinAttemptNonce",
    "reconnectEndedHandledRef",
    "handshakeCompletionInFlightRef",
    "handshakeCompletionDeadlineKeyRef",
    "loggedJourneyRef",
  ]) {
    assert.match(nativeDateRoute, new RegExp(marker));
  }
  assert.match(nativeDateRoute, /setPartnerEverJoined\(false\);\s*hasStartedJoinRef\.current = false;\s*prejoinAttemptRef\.current = null;/);
  assert.match(nativeDateRoute, /\}, \[phase, sessionId, handleCallEnd, clearHandshakeGraceState\]\);/);
  assert.match(nativeDateRoute, /\(joining && hasStartedJoinRef\.current\)[\s\S]{0,120}\|\|[\s\S]{0,120}hasStartedJoinRef\.current/);
});

test("native date route preserves AppState foreground/reconnect recovery", () => {
  assert.match(nativeDateRoute, /AppState\.addEventListener\('change'/);
  assert.match(nativeDateRoute, /syncVideoDateReconnect\(sessionId\)/);
  assert.match(nativeDateRoute, /VIDEO_DATE_FOREGROUND_RECONCILE_FAILED/);
  assert.match(nativeDateRoute, /VIDEO_DATE_RECONNECT_RETURNED/);
  assert.match(nativeActiveSession, /AppState\.addEventListener/);
});

test("native video-date observability remains safe and contract-focused", () => {
  for (const marker of [
    "VIDEO_DATE_ROUTE_ENTERED",
    "VIDEO_DATE_PREPARE_ENTRY_FAILURE",
    "VIDEO_DATE_DAILY_TOKEN_FAILURE",
    "VIDEO_DATE_DAILY_JOIN_FAILURE",
    "MARK_VIDEO_DATE_DAILY_JOINED_FAILED",
    "VIDEO_DATE_SURVEY_RECOVERED",
    "VIDEO_DATE_SYNC_RECONNECT_FAILED",
  ]) {
    assert.match(nativeDateRoute + nativePrepareEntry, new RegExp(marker));
  }
  assert.match(nativeDateRoute, /rcBreadcrumb\(RC_CATEGORY\.videoDateEntry/);
});

test("native Ready Gate to date handoff remains backend-startable before date route", () => {
  assert.match(nativeReadyOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeReadyOverlay, /navigateWithLatency\(`\$\{source\}_prepare_success`\)/);
  assert.match(nativeReadyRoute, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeActiveSession, /decideVideoSessionRouteFromTruth/);
});

test("native video-date surfaces do not directly write backend-owned lifecycle fields", () => {
  assertNoForbiddenSupabaseWrites(nativeVideoDateFiles, "video_sessions", forbiddenVideoSessionFields);
  assertNoForbiddenSupabaseWrites(nativeVideoDateFiles, "event_registrations", forbiddenRegistrationFields);
});

test("native video-date surfaces do not import expo-av or add native modules", () => {
  for (const path of nativeVideoDateFiles) {
    assert.doesNotMatch(read(path), /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/, `${path} must not use expo-av`);
  }
  assert.doesNotMatch(read("apps/mobile/package.json"), /expo-av/);
});

test("Stream 10 did not add Supabase migrations or Edge Function changes", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("native_video_date_contract_recovery")),
    false,
    "Stream 10 should not add a Supabase migration",
  );
  assert.equal(
    existsSync(join(root, "supabase/validation/native_video_date_contract_recovery.sql")),
    false,
    "Stream 10 should not add production validation SQL because no migration is expected",
  );
});

test("Streams 1-9 artifacts remain present", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API uses canonical ready_gate_transition actions/);
  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency/);
  assert.match(read("shared/matching/realtimeSubscriptionTightening.test.ts"), /broad event-level video_sessions/);
  assert.match(read("supabase/migrations/20260501220000_premium_credits_observability.sql"), /stripe_webhook_events/);
});
