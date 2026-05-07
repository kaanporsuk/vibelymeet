import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const webEventLobby = read("src/pages/EventLobby.tsx");
const webMatchQueue = read("src/hooks/useMatchQueue.ts");
const webActiveSession = read("src/hooks/useActiveSession.ts");
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");

const nativeEventLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");

const webRealtimeFiles = [
  "src/pages/EventLobby.tsx",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useActiveSession.ts",
  "src/hooks/useReadyGate.ts",
  "src/components/lobby/ReadyGateOverlay.tsx",
];

const nativeRealtimeFiles = [
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/lib/useActiveSession.ts",
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
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

function assertNoBroadEventVideoSessionRealtime(path: string) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /\.on\(\s*["']postgres_changes["'][\s\S]{0,320}table:\s*["']video_sessions["'][\s\S]{0,320}filter:\s*`event_id=eq\./,
    `${path} must not use broad event-level video_sessions realtime`,
  );
}

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

test("web Ready Gate current-session realtime remains session-id scoped", () => {
  assert.match(webReadyGateHook, /table:\s*"video_sessions"[\s\S]{0,120}filter:\s*`id=eq\.\$\{sessionId\}`/);
  assert.match(webReadyGateOverlay, /table:\s*"video_sessions"[\s\S]{0,140}filter:\s*`id=eq\.\$\{sessionId\}`/);
});

test("web lobby, match queue, and active-session discovery avoid broad event-level video_sessions realtime", () => {
  for (const path of ["src/pages/EventLobby.tsx", "src/hooks/useMatchQueue.ts", "src/hooks/useActiveSession.ts"]) {
    assertNoBroadEventVideoSessionRealtime(path);
    const source = read(path);
    assert.match(source, /participant_1_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_1_id`);
    assert.match(source, /participant_2_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_2_id`);
  }
});

test("own event_registrations subscriptions remain present for lobby and active-session truth", () => {
  for (const source of [webEventLobby, webActiveSession, webReadyGateOverlay, nativeEventLobby, nativeActiveSession]) {
    assert.match(source, /table:\s*['"]event_registrations['"]/);
    assert.match(source, /filter:\s*`profile_id=eq\.\$\{(?:user\.id|userId)\}`/);
  }
});

test("web fallback refetch and polling paths remain present", () => {
  assert.match(webEventLobby, /visibilitychange/);
  assert.match(webEventLobby, /setInterval\(/);
  assert.match(webEventLobby, /refetchScopedSession/);
  assert.match(webMatchQueue, /refreshQueueCount/);
  assert.match(webMatchQueue, /drain_match_queue/);
  assert.match(webActiveSession, /visibilitychange/);
  assert.match(webActiveSession, /setInterval\(/);
});

test("web match queue keeps survey drain quiet while preserving lobby drain toasts", () => {
  assert.match(webMatchQueue, /sourceSurface\s*=\s*"event_lobby"/);
  assert.match(webMatchQueue, /suppressDrainReasonToasts\s*=\s*false/);
  assert.match(webMatchQueue, /!suppressDrainReasonToasts/);
  assert.match(webMatchQueue, /id:\s*`match-queue-drain:\$\{key\}`/);
  assert.match(read("src/components/video-date/PostDateSurvey.tsx"), /sourceSurface:\s*"post_date_survey"/);
  assert.match(read("src/components/video-date/PostDateSurvey.tsx"), /suppressDrainReasonToasts:\s*true/);
});

test("duplicate navigation and terminal latches remain session-scoped in web Ready Gate surfaces", () => {
  assert.match(webReadyGateOverlay, /dateNavigationStartedRef/);
  assert.match(webReadyGateOverlay, /duplicateNavSuppressionKeysRef/);
  assert.match(webReadyGateOverlay, /duplicateTerminalSuppressionKeysRef/);
  assert.match(webReadyGateOverlay, /terminalToastKeyRef/);
  assert.match(webEventLobby, /dateNavigationSessionIdRef/);
  assert.match(webEventLobby, /prepareNavigationInFlightRef/);
});

test("date navigation remains gated by backend prepare-entry truth", () => {
  assert.match(webReadyGateOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(webEventLobby, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeReadyGateOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeEventLobby, /ensureVideoDateStartableBeforeNavigation/);
});

test("native Ready Gate sync and current-session realtime remain backend-truth based", () => {
  assert.match(nativeReadyGateApi, /ready_gate_transition/);
  assert.match(nativeReadyGateApi, /syncSession/);
  assert.match(nativeReadyGateApi, /table:\s*'video_sessions'[\s\S]{0,120}filter:\s*`id=eq\.\$\{sessionId\}`/);
  assert.match(nativeReadyGateOverlay, /syncSession\(\)/);
});

test("native lobby and active-session discovery avoid broad event-level video_sessions realtime", () => {
  for (const path of ["apps/mobile/app/event/[eventId]/lobby.tsx", "apps/mobile/lib/useActiveSession.ts"]) {
    assertNoBroadEventVideoSessionRealtime(path);
    const source = read(path);
    assert.match(source, /participant_1_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_1_id`);
    assert.match(source, /participant_2_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_2_id`);
  }
});

test("native standalone ready route and app foreground recovery remain present", () => {
  assert.match(nativeReadyRoute, /useReadyGate\(sessionId \?\? null, user\?\.id \?\? null\)/);
  assert.match(nativeReadyRoute, /syncSession\(\)/);
  assert.match(nativeReadyRoute, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeReadyRoute, /AppState\.addEventListener/);
  assert.match(nativeActiveSession, /AppState\.addEventListener/);
  assert.match(nativeActiveSession, /setInterval\(/);
});

test("client subscription tightening did not introduce forbidden Ready Gate writes", () => {
  assertNoForbiddenSupabaseWrites(webRealtimeFiles, "video_sessions", forbiddenVideoSessionFields);
  assertNoForbiddenSupabaseWrites(webRealtimeFiles, "event_registrations", forbiddenRegistrationFields);
  assertNoForbiddenSupabaseWrites(nativeRealtimeFiles, "video_sessions", forbiddenVideoSessionFields);
  assertNoForbiddenSupabaseWrites(nativeRealtimeFiles, "event_registrations", forbiddenRegistrationFields);
});

test("no expo-av import or require was introduced in realtime surfaces", () => {
  for (const path of [...webRealtimeFiles, ...nativeRealtimeFiles]) {
    assert.doesNotMatch(read(path), /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/, `${path} must not use expo-av`);
  }
});

test("Streams 1-7 artifacts remain present and no Stream 8 migration exists", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API uses canonical ready_gate_transition actions/);
  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency/);
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("realtime_subscription_tightening")),
    false,
    "Stream 8 should not add a Supabase migration",
  );
  assert.equal(
    existsSync(join(root, "supabase/validation/realtime_subscription_tightening.sql")),
    false,
    "Stream 8 should not add production validation SQL because no migration is expected",
  );
});
