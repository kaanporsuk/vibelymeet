import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveReadyGateTransitionFailureCopy } from "./readyGateDiagnosticCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260602231752_ready_gate_57014_reliability_fix.sql",
);
const hotPathMigration = read(
  "supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql",
);
const graceMigration = read(
  "supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql",
);
const webLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const nativeReadyGateOverlay = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const sendNotification = read("supabase/functions/send-notification/index.ts");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const supabaseConfig = read("supabase/config.toml");

test("web and native lobbies pause deck pressure while Ready Gate is active", () => {
  assert.match(webLobby, /const readyGatePressureActive = Boolean\(/);
  assert.match(webLobby, /const deckFetchEnabled = deckEnabled && !readyGatePressureActive/);
  assert.match(webLobby, /useEventDeck\([\s\S]*enabled: deckFetchEnabled/s);
  assert.match(webLobby, /deckPrefetchPolishEnabled\s*\|\|\s*readyGatePressureActive/);
  assert.match(webLobby, /shouldTopUpVideoDateDeck\(remainingVisible\)[\s\S]{0,140}!readyGatePressureActive/s);

  assert.match(nativeLobby, /const sameEventActiveSession = useMemo/);
  assert.match(nativeLobby, /const readyGatePressureActive =\s*Boolean\(activeSessionId\)\s*\|\|\s*sameEventActiveSession\?\.kind === ['"]ready_gate['"]/);
  assert.match(nativeLobby, /const deckQueryEnabled = Boolean\([\s\S]*!readyGatePressureActive/s);
  assert.match(nativeLobby, /if \(readyGatePressureActive\) \{[\s\S]*lobby_deck_refresh_suppressed_ready_gate/s);
  assert.match(nativeLobby, /deckPrefetchPolishEnabled\s*\|\|\s*readyGatePressureActive/);
  assert.match(nativeLobby, /shouldTopUp && !readyGatePressureActive/);
});

test("Ready Gate sync polling is coalesced, backed off, and skipped while marking ready", () => {
  assert.match(webReadyGateOverlay, /READY_GATE_DEGRADED_SYNC_POLL_MS = 2_500/);
  assert.match(webReadyGateOverlay, /reconcileSessionInFlightRef/);
  assert.match(webReadyGateOverlay, /reconcileSessionCooldownUntilMsRef/);
  assert.match(webReadyGateOverlay, /source === "poll" && readyActionInFlightRef\.current/);
  assert.match(webReadyGateOverlay, /isReadyGateTransitionTimeoutSignal\(syncResult\)[\s\S]*READY_GATE_RECONCILE_TIMEOUT_COOLDOWN_MS/s);
  assert.match(webReadyGateOverlay, /isTransitioning \|\|[\s\S]*iAmReady \|\|[\s\S]*markingReady \|\|[\s\S]*snoozedByPartner/s);

  for (const [name, source] of [
    ["native overlay", nativeReadyGateOverlay],
    ["native ready route", nativeReadyRoute],
  ] as const) {
    assert.match(source, /guardedSyncInFlightRef/, `${name} should coalesce sync`);
    assert.match(source, /guardedSyncCooldownUntilMsRef/, `${name} should cool down sync`);
    assert.match(source, /READY_GATE_SYNC_TIMEOUT_COOLDOWN_MS = 3_000/, `${name} should use bounded cooldown`);
    assert.match(source, /readyActionInFlightRef\.current[\s\S]*sync_suppressed_mark_ready_in_flight/s, `${name} should skip passive sync while marking`);
    assert.match(source, /guardedSyncSession\([\s\S]*mark_ready_timeout_recovery[\s\S]*allowWhileMarking: true/s, `${name} should allow the one explicit timeout recovery sync`);
  }
});

test("Ready Gate 57014 copy is a transient status-sync delay, not a permission denial", () => {
  assert.deepEqual(
    resolveReadyGateTransitionFailureCopy({
      action: "mark_ready",
      code: "57014",
      error: "canceling statement due to statement timeout",
      platform: "web",
    }),
    {
      action: "mark_ready",
      code: "57014",
      reasonCode: "ready_gate_transition_timeout",
      title: "Status sync delayed",
      message: "Status sync is delayed. Retrying with the latest session status.",
      retryable: true,
      staleOrConflict: false,
    },
  );
  assert.match(
    webReadyGateOverlay,
    /if \(!permissionReady\) \{[\s\S]*ready_tap_permission_prewarm_failed_diagnostics_ok[\s\S]*setTerminalActionError\([\s\S]*return;\s*\}\s*const result = await markReady\(\);/,
  );
  assert.doesNotMatch(webReadyGateOverlay, /ready_tap_permission_unconfirmed_soft_proceed/);
  assert.doesNotMatch(webReadyGateOverlay, /!permissionReady && !mediaDiagnosticsAreGreen/);
  assert.doesNotMatch(webReadyGateOverlay, /if \(!permissionReady && mediaDiagnosticsAreGreen\)/);
});

test("web Ready tap permission prewarm is bounded and does not commit mark-ready without media proof", () => {
  assert.match(webReadyGateOverlay, /READY_GATE_PERMISSION_PREWARM_TIMEOUT_MS = 15_000/);
  assert.match(webReadyGateOverlay, /class ReadyGatePermissionPrewarmTimeoutError extends Error/);
  assert.match(webReadyGateOverlay, /withReadyGatePermissionPrewarmTimeout/);
  assert.match(webReadyGateOverlay, /Promise\.race/);
  assert.match(webReadyGateOverlay, /permissionPrewarmCapturePendingRef/);
  assert.match(webReadyGateOverlay, /ready_gate_permission_prewarm_timeout/);
  assert.match(webReadyGateOverlay, /ready_gate_permission_prewarm_pending/);
  assert.doesNotMatch(
    webReadyGateOverlay,
    /ready_gate_permission_prewarm_pending[\s\S]{0,240}return false/,
  );
  assert.match(
    webReadyGateOverlay,
    /if \(!permissionReady\) \{[\s\S]*return;\s*\}\s*const result = await markReady\(\);/,
  );
});

test("retryable mark-ready failures stay in syncing copy instead of stale Ready Gate copy", () => {
  assert.deepEqual(
    resolveReadyGateTransitionFailureCopy({
      action: "mark_ready",
      reason: "session_no_longer_ready_gate_mutable",
      retryable: true,
      platform: "web",
    }),
    {
      action: "mark_ready",
      code: null,
      reasonCode: "ready_gate_transition_timeout",
      title: "Status sync delayed",
      message: "Status sync is delayed. Retrying with the latest session status.",
      retryable: true,
      staleOrConflict: false,
    },
  );

  const terminalCopy = resolveReadyGateTransitionFailureCopy({
    action: "mark_ready",
    reason: "session_no_longer_ready_gate_mutable",
    retryable: false,
    platform: "web",
  });
  assert.equal(terminalCopy.title, "Ready Gate changed");
  assert.equal(terminalCopy.staleOrConflict, true);
});

test("Ready Gate 57014 migration makes sync/deck paths non-blocking", () => {
  assert.match(migration, /idx_event_registrations_profile_active_room/);
  assert.match(migration, /ready_gate_transition_20260602231752_57014_base/);
  assert.match(migration, /p_action = 'sync'[\s\S]*'snapshot', true/s);
  assert.match(migration, /READY_GATE_TRANSITION_TIMEOUT/);
  assert.match(migration, /retry_after_seconds', 2/);

  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /'reason', 'deck_busy'/);
  assert.match(migration, /'retryable', true[\s\S]*'retry_after_seconds', 2/s);
  assert.doesNotMatch(migration, /cleanup_event_deck_card_reservations\s*\(/);
});

test("mark-ready v2 owns the decisive Ready Gate hot path", () => {
  assert.match(hotPathMigration, /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2/);
  assert.doesNotMatch(
    hotPathMigration,
    /v_transition := public\.ready_gate_transition\(p_session_id, 'mark_ready', NULL\)/,
  );
  assert.match(hotPathMigration, /v_command_status = 'replay_rejected'/);
  assert.match(hotPathMigration, /status = 'processing'[\s\S]*result_payload = NULL/s);
  assert.match(hotPathMigration, /ready_participant_1_at = v_new_p1_ready_at/);
  assert.match(hotPathMigration, /ready_participant_2_at = v_new_p2_ready_at/);
  assert.match(hotPathMigration, /daily_room_name = CASE[\s\S]*WHEN v_new_status = 'both_ready' THEN v_expected_room_name/s);
  assert.match(hotPathMigration, /daily_room_url = CASE[\s\S]*WHEN v_new_status = 'both_ready' THEN v_url/s);
  assert.doesNotMatch(hotPathMigration, /daily_room_name IS NULL[\s\S]*daily_room_url IS NULL/s);
  assert.match(hotPathMigration, /WHEN query_canceled OR lock_not_available[\s\S]*mark_ready_timeout/s);
  assert.match(hotPathMigration, /v_auxiliary_errors jsonb := '\[\]'::jsonb/);
  assert.match(hotPathMigration, /append_video_session_event_v2[\s\S]*EXCEPTION[\s\S]*'kind', 'event_append'/s);
  assert.match(hotPathMigration, /video_date_outbox_enqueue_v2[\s\S]*EXCEPTION[\s\S]*'kind', 'daily_room_outbox'/s);
  assert.match(hotPathMigration, /'provider_outbox_degraded', jsonb_array_length\(v_auxiliary_errors\) > 0/);
  assert.match(hotPathMigration, /CREATE OR REPLACE FUNCTION public\.ready_gate_transition/);
  assert.match(hotPathMigration, /IF v_action = 'mark_ready' THEN[\s\S]*public\.video_session_mark_ready_v2/s);
  assert.match(hotPathMigration, /expired_registration_cleanup/);
  assert.match(hotPathMigration, /command_finish_degraded/);
});

test("mark-ready v2 grace wrapper preserves legitimate tap intent through contention", () => {
  assert.match(graceMigration, /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_grace_extend_v1/);
  assert.match(graceMigration, /v_grace_window interval := interval '15 seconds'/);
  assert.match(graceMigration, /v_grace_max_age interval := interval '45 seconds'/);
  assert.match(graceMigration, /v_extend_until timestamptz := v_now \+ interval '15 seconds'/);
  assert.match(graceMigration, /set_config\('lock_timeout', '800ms', true\)/);
  assert.match(graceMigration, /set_config\('statement_timeout', '3000ms', true\)/);
  assert.match(graceMigration, /v_existing_command_found boolean := false/);
  assert.match(graceMigration, /v_existing_command_found := v_started_at IS NOT NULL/);
  assert.match(graceMigration, /v_max_extend_until := v_started_at \+ v_grace_max_age/);
  assert.match(graceMigration, /IN \('queued', 'ready', 'ready_a', 'ready_b', 'snoozed'\)/);
  assert.match(graceMigration, /v_started_at <= vs\.ready_gate_expires_at/);
  assert.match(graceMigration, /vs\.ready_gate_expires_at >= v_now - v_grace_window/);
  assert.match(graceMigration, /v_now < v_max_extend_until/);
  assert.match(graceMigration, /vs\.ready_gate_expires_at < LEAST\(v_extend_until, v_max_extend_until\)/);
  assert.doesNotMatch(graceMigration, /vs\.ready_gate_expires_at >= v_started_at - v_grace_window/);
  assert.match(graceMigration, /ready_gate_expires_at = GREATEST\(/);
  assert.match(graceMigration, /LEAST\(v_extend_until, v_max_extend_until\)/);
  assert.match(graceMigration, /mark_ready_expiry_grace_applied/);
  assert.match(graceMigration, /ALTER FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*RENAME TO video_session_mark_ready_v2_20260604104154_grace_base/);
  assert.match(graceMigration, /public\.video_session_mark_ready_v2_20260604104154_grace_base\(/);
  assert.match(graceMigration, /'post_retryable'/);
  assert.match(graceMigration, /'mark_ready_started_at'/);
  assert.match(graceMigration, /'expiry_grace_applied'/);
  assert.match(graceMigration, /'retryable_command_reopened'/);
  assert.match(graceMigration, /'hot_path', true/);
  assert.match(graceMigration, /legacy_mark_ready_signature_detected/);
  assert.match(graceMigration, /ready_gate_transition_timeout/);
  assert.match(graceMigration, /pre_ready_room_metadata_repaired/);
  assert.match(graceMigration, /GRANT EXECUTE ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(graceMigration, /daily\.ensure_video_date_room/);
  assert.doesNotMatch(graceMigration, /createDaily|Daily API|api\.daily\.co/i);
});

test("Ready Gate clients preserve retryable fail-soft mark-ready payloads into sync recovery", () => {
  for (const [name, source] of [
    ["web hook", webReadyGateHook],
    ["native api", nativeReadyGateApi],
  ] as const) {
    assert.match(source, /retryable\?: boolean \| null/, `${name} should expose retryable on transition results`);
    assert.match(source, /retryable: payload\.retryable === true/, `${name} should preserve backend retryable payloads`);
    assert.match(source, /MARK_READY_RETRY_DELAYS_MS = \[350, 900, 1_400\] as const/, `${name} should retry bounded mark-ready payloads`);
    assert.match(source, /readyGateTransitionRetrySleep/, `${name} should pause between bounded retries`);
    assert.match(source, /shouldRetryReadyGateMarkReadyPayload\(transitionResult\.data\)/, `${name} should only retry explicit retryable payloads`);
    assert.match(source, /buildVideoDateTransitionIdempotencyKey\(sessionId, ['"]mark_ready['"]\)/, `${name} should keep the deterministic key so backend replay recovery works`);
  }

  for (const [name, source] of [
    ["web overlay", webReadyGateOverlay],
    ["native overlay", nativeReadyGateOverlay],
    ["native ready route", nativeReadyRoute],
  ] as const) {
    assert.match(source, /retryable\?: boolean \| null/, `${name} timeout predicate should accept retryable`);
    assert.match(source, /if \(input\.retryable === true\) return true/, `${name} should sync-recover retryable failures`);
  }
});

test("native standalone Ready route keeps partial-ready provider warmup out of the mount path", () => {
  assert.doesNotMatch(nativeReadyRoute, /ensureVideoDateRoomWarmup/);
  assert.doesNotMatch(nativeReadyRoute, /videoDateRoomWarmupAfterReadyEnabled/);
  assert.doesNotMatch(nativeReadyRoute, /const startRoomWarmupAfterReady = useCallback/);
  assert.doesNotMatch(nativeReadyRoute, /standalone_initial_ready_pre_create/);
  assert.match(nativeReadyRoute, /startNativeVideoDateDailyPrewarm/);
});

test("terminal Ready Gate outcomes cancel prewarm and retry churn on web and native", () => {
  assert.match(webReadyGateOverlay, /const cancelTerminalReadyGateWork = useCallback/);
  assert.match(webReadyGateOverlay, /prepareEntryRunIdRef\.current \+= 1/);
  assert.match(webReadyGateOverlay, /destroyWebVideoDateDailyPrewarm\(sessionId, user\.id, reason\)/);
  assert.match(webReadyGateOverlay, /clearWebVideoDateMediaHandoff\(sessionId, user\.id\)/);
  assert.match(webReadyGateOverlay, /cancelTerminalReadyGateWork\(`ready_gate_stale_\$\{source\}`\)/);

  assert.match(nativeReadyGateOverlay, /const cancelTerminalReadyGateWork = useCallback/);
  assert.match(nativeReadyGateOverlay, /destroyNativeVideoDateDailyPrewarm\(sessionId, userId, reason\)/);
  assert.match(nativeReadyGateOverlay, /ready_gate_terminal_expired/);

  assert.match(nativeReadyRoute, /destroyNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyRoute, /const cancelTerminalReadyGateWork = useCallback/);
  assert.match(nativeReadyRoute, /guardedSyncCooldownUntilMsRef\.current = Number\.POSITIVE_INFINITY/);
  assert.match(nativeReadyRoute, /guardedSyncCooldownUntilMsRef\.current = 0/);
  assert.match(nativeReadyRoute, /ready_standalone_terminal_/);
  assert.match(nativeReadyRoute, /ready_standalone_forfeited_/);
});

test("notification outbox auth failures are classified and recipient identity stays unambiguous", () => {
  assert.match(supabaseConfig, /\[functions\.send-notification\][\s\S]{0,180}verify_jwt = false/);
  assert.match(sendNotification, /requestBody\?\.health_check === true/);
  assert.match(sendNotification, /authenticated_as: isServiceRole \? 'service_role' : 'user'/);

  assert.match(outboxDrainer, /sendNotificationAuthHealthCheck/);
  assert.match(outboxDrainer, /url\.searchParams\.get\("health_check"\)/);
  assert.match(outboxDrainer, /operation: "send_notification_auth_health_check"/);
  assert.match(outboxDrainer, /apikey: serviceKey/);
  assert.match(outboxDrainer, /video_date_notification_auth_failure/);
  assert.match(outboxDrainer, /notification_auth_failed_\$\{res\.status\}/);
  assert.match(outboxDrainer, /safeProviderBodySnippet/);
  assert.doesNotMatch(outboxDrainer, /reason: `notification_http_\$\{res\.status\}`,\s*retryAfterSeconds: res\.status >= 500/s);

  assert.match(swipeActions, /const matchUserId = args\.userId === args\.actorId \? args\.targetId : args\.actorId/);
  assert.match(swipeActions, /user_id: args\.userId/);
  assert.match(swipeActions, /recipient_id: args\.userId/);
  assert.match(swipeActions, /match_user_id: matchUserId/);
  assert.match(swipeActions, /\n\s*target_id: args\.userId/);
  assert.match(swipeActions, /swipe_target_id: args\.targetId/);
  assert.doesNotMatch(swipeActions, /\n\s*target_id: args\.targetId/);
});
