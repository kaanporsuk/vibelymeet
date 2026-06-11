import test from "node:test";
import assert from "node:assert/strict";
import { LobbyPostDateEvents } from "../analytics/lobbyToPostDateJourney";
import {
  VIDEO_DATE_OPERATOR_METRIC_IDS,
  VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME,
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateTimerDriftMs,
  bucketVideoDateLatencyMs,
  buildVideoDateTimerDriftRecoveredPayload,
  classifyVideoDateOperatorMetric,
  getReadyGateToDateLatencyDurations,
  recordReadyGateToDateLatencyCheckpoint,
  shouldTrackVideoDateTimerDriftRecovery,
  startReadyGateToDateLatencyContext,
} from "./videoDateOperatorMetrics";
import {
  emitVideoDateLaunchLatencyCheckpointObservability,
  flushVideoDateLaunchLatencyCheckpoints,
  sanitizeVideoDateLaunchLatencyPayload,
} from "./videoDateLaunchLatencyCheckpointObservability";


function firstQueuedCheckpoint(
  args: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const list = args?.p_checkpoints;
  return Array.isArray(list) && list.length > 0 ? (list[0] as Record<string, unknown>) : null;
}

test("video date operator metric ids stay stable", () => {
  assert.deepEqual(VIDEO_DATE_OPERATOR_METRIC_IDS, [
    "ready_tap_to_first_remote_frame_latency",
    "ready_gate_open_to_date_join_latency",
    "simultaneous_swipe_collision_rate",
    "queue_fairness_starvation_rate",
    "timer_drift_recovered_by_server_truth",
  ]);
});

test("operator thresholds classify lower and higher is better metrics", () => {
  assert.equal(
    classifyVideoDateOperatorMetric(4_000, {
      warning: 10_000,
      critical: 20_000,
      direction: "lower_is_better",
    }),
    "healthy",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(12_000, {
      warning: 10_000,
      critical: 20_000,
      direction: "lower_is_better",
    }),
    "warning",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(0.18, {
      warning: 0.35,
      critical: 0.2,
      direction: "higher_is_better",
    }),
    "critical",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(null, {
      warning: 0.35,
      critical: 0.2,
      direction: "higher_is_better",
    }),
    "unknown",
  );
});

test("timer drift buckets and event name are stable", () => {
  assert.equal(
    VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME,
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH,
  );
  assert.equal(
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED,
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH,
  );
  assert.equal(bucketVideoDateTimerDriftMs(999), "lt_1s");
  assert.equal(bucketVideoDateTimerDriftMs(1_000), "1_5s");
  assert.equal(bucketVideoDateTimerDriftMs(5_000), "5_15s");
  assert.equal(bucketVideoDateTimerDriftMs(15_000), "15_60s");
  assert.equal(bucketVideoDateTimerDriftMs(60_000), "gt_60s");
});

test("timer drift payload emits only meaningful date-phase corrections", () => {
  assert.equal(
    shouldTrackVideoDateTimerDriftRecovery({
      previousTimeLeftSeconds: 120,
      correctedTimeLeftSeconds: 119.5,
    }),
    false,
  );
  assert.equal(
    buildVideoDateTimerDriftRecoveredPayload({
      platform: "web",
      sessionId: "session-1",
      previousTimeLeftSeconds: 60,
      correctedTimeLeftSeconds: 300,
      recoverySource: "session_reload",
      phase: "handshake",
    }),
    null,
  );
  assert.deepEqual(
    buildVideoDateTimerDriftRecoveredPayload({
      platform: "native",
      sessionId: "session-1",
      eventId: "event-1",
      previousTimeLeftSeconds: 82,
      correctedTimeLeftSeconds: 70,
      recoverySource: "sync_reconnect",
      phase: "date",
    }),
    {
      platform: "native",
      session_id: "session-1",
      event_id: "event-1",
      source_surface: "video_date",
      source_action: "sync_reconnect",
      outcome: "recovered",
      drift_ms: 12_000,
      drift_bucket: "5_15s",
      drift_direction: "client_ahead",
      recovery_source: "sync_reconnect",
      local_phase: "date",
      server_phase: "date",
      phase: "date",
      survey_recovered: false,
      date_phase_restored: true,
      ended_state_corrected: false,
    },
  );
});

test("latency buckets and context durations are stable", () => {
  assert.equal(bucketVideoDateLatencyMs(499), "lt_500ms");
  assert.equal(bucketVideoDateLatencyMs(500), "500ms_1s");
  assert.equal(bucketVideoDateLatencyMs(1_500), "1_2s");
  assert.equal(bucketVideoDateLatencyMs(65_000), "gt_60s");

  const ctx = startReadyGateToDateLatencyContext({
    platform: "web",
    sessionId: "session-1",
    eventId: "event-1",
    sourceSurface: "ready_gate_overlay",
    nowMs: 1_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "ready_tap",
    nowMs: 1_800,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "both_ready_observed",
    nowMs: 2_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "daily_join_success",
    nowMs: 3_450,
  });

  assert.deepEqual(getReadyGateToDateLatencyDurations(ctx), {
    readyGateOpenToReadyTapMs: 800,
    readyTapToBothReadyMs: 200,
    readyTapToPrepareEntryMs: null,
    readyTapToDateRouteMs: null,
    readyTapToDailyJoinMs: 1_650,
    readyTapToRemoteSeenMs: null,
    readyTapToFirstRemoteFrameMs: null,
    bothReadyToDateRouteMs: null,
    bothReadyToDailyTokenMs: null,
    bothReadyToDailyJoinMs: 1_450,
    bothReadyToRemoteSeenMs: null,
    bothReadyToFirstRemoteFrameMs: null,
    bothReadyToVideoStageShellMs: null,
    bothReadyToLocalVideoReadyMs: null,
    dateRouteBootstrapMs: null,
    dateRouteToDailyJoinMs: null,
    dailyJoinToRemoteSeenMs: null,
    dailyJoinToFirstRemoteFrameMs: null,
    remoteSeenToFirstRemoteFrameMs: null,
    firstRemoteFrameToReadableMs: null,
    dailyTokenDurationMs: null,
    dailyTokenMintDurationMs: null,
    dailyJoinDurationMs: null,
    dailyReconnectDurationMs: null,
    extensionRefreshDurationMs: null,
    dailyRoomCreateDurationMs: null,
    prepareEntryDurationMs: null,
    providerVerifyDurationMs: null,
    permissionCheckDurationMs: null,
  });

  assert.equal(
    buildReadyGateToDateLatencyPayload({
      context: ctx,
      checkpoint: "daily_join_success",
      sourceAction: "daily_join_success",
      outcome: "success",
    }).latency_bucket,
    "1_2s",
  );
});

test("Ready Gate context preserves the pre-handoff swipe result checkpoint", () => {
  const initialContext = recordReadyGateToDateLatencyCheckpoint({
    platform: "web",
    sessionId: "session-swipe-result-preserved",
    eventId: "event-sprint-6",
    sourceSurface: "event_lobby",
    checkpoint: "swipe_result",
    nowMs: 500,
  });
  assert.equal(initialContext.swipeResultObservedAtMs, 500);

  const readyGateContext = startReadyGateToDateLatencyContext({
    platform: "web",
    sessionId: "session-swipe-result-preserved",
    eventId: "event-sprint-6",
    sourceSurface: "ready_gate_overlay",
    nowMs: 900,
  });

  assert.equal(readyGateContext.swipeResultObservedAtMs, 500);
  assert.equal(readyGateContext.readyGateOpenedAtMs, 900);
  assert.equal(readyGateContext.sourceSurface, "ready_gate_overlay");
  assert.equal(readyGateContext.eventId, "event-sprint-6");
});

test("Ready Gate context resets attempt timestamps when the gate reopens", () => {
  const sessionId = "session-ready-gate-reopen";
  recordReadyGateToDateLatencyCheckpoint({
    platform: "web",
    sessionId,
    eventId: "event-sprint-6",
    sourceSurface: "event_lobby",
    checkpoint: "swipe_result",
    nowMs: 100,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId,
    checkpoint: "ready_tap",
    nowMs: 200,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId,
    checkpoint: "both_ready_observed",
    nowMs: 300,
  });

  const reopened = startReadyGateToDateLatencyContext({
    platform: "web",
    sessionId,
    eventId: "event-sprint-6",
    sourceSurface: "ready_gate_overlay",
    nowMs: 1_000,
  });

  assert.equal(reopened.swipeResultObservedAtMs, 100);
  assert.equal(reopened.readyGateOpenedAtMs, 1_000);
  assert.equal(reopened.readyTapAtMs, undefined);
  assert.equal(reopened.bothReadyObservedAtMs, undefined);
});

test("Phase 7 Daily performance checkpoints compute token-free segment durations", async () => {
  const ctx = startReadyGateToDateLatencyContext({
    platform: "web",
    sessionId: "session-phase7",
    eventId: "event-phase7",
    sourceSurface: "video_date_daily_performance",
    nowMs: 10_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-phase7",
    sourceSurface: "video_date_daily_performance",
    checkpoint: "daily_room_create_started",
    nowMs: 11_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-phase7",
    sourceSurface: "video_date_daily_performance",
    checkpoint: "daily_room_create_success",
    nowMs: 12_250,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-phase7",
    sourceSurface: "video_date_daily_performance",
    checkpoint: "daily_token_mint_started",
    nowMs: 12_300,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-phase7",
    sourceSurface: "video_date_daily_performance",
    checkpoint: "daily_token_mint_success",
    nowMs: 12_470,
  });

  const payload = buildReadyGateToDateLatencyPayload({
    context: ctx,
    checkpoint: "daily_token_mint_success",
    sourceAction: "daily_token_mint_success",
    outcome: "success",
    extra: {
      daily_performance_segment: "token_mint",
      daily_token_mint_ms: 170,
      token_ms: 170,
      token: "must_not_survive",
    },
  });

  assert.equal(payload.daily_room_create_ms, 1_250);
  assert.equal(payload.daily_token_mint_ms, 170);
  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(payload), {
    platform: "web",
    source_surface: "video_date_daily_performance",
    source_action: "daily_token_mint_success",
    outcome: "success",
    latency_bucket: "2_5s",
    daily_performance_segment: "token_mint",
    duration_ms: 2470,
    daily_room_create_ms: 1250,
    daily_token_mint_ms: 170,
    token_ms: 170,
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: {
      session_id: "42c3c061-6339-4ef5-98d6-b45ed2c26723",
      checkpoint: "daily_token_mint_success",
      ...payload,
    },
  });

  assert.deepEqual(result, { ok: true, queued: true });
  await flushVideoDateLaunchLatencyCheckpoints();
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.checkpoint, "daily_token_mint_success");
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.latency_ms, 170);
});

test("launch latency checkpoint observability preserves safe first-frame dimensions", async () => {
  const rawProperties = {
    session_id: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
    checkpoint: "first_remote_frame",
    platform: "web",
    source_surface: "video_date_daily",
    source_action: "remote_video_frame_callback",
    outcome: "success",
    entry_attempt_id: "vde_mabc123_z9y8x7",
    video_date_trace_id: "vde_mabc123_z9y8x7",
    ready_tap_to_first_remote_frame_ms: 1900,
    both_ready_to_first_remote_frame_ms: 700,
    cached_prepare_entry: true,
    provider_verify_skipped: true,
    provider_verify_reason: "fresh_room_proof",
    auth_ms: 21,
    prepare_rpc_ms: 84,
    room_create_or_verify_ms: 0,
    token_ms: 147,
    confirm_prepare_ms: 93,
    edge_total_ms: 421,
    token: "must_not_survive",
  };

  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(rawProperties), {
    platform: "web",
    source_surface: "video_date_daily",
    source_action: "remote_video_frame_callback",
    outcome: "success",
    entry_attempt_id: "vde_mabc123_z9y8x7",
    video_date_trace_id: "vde_mabc123_z9y8x7",
    ready_tap_to_first_remote_frame_ms: 1900,
    both_ready_to_first_remote_frame_ms: 700,
    cached_prepare_entry: true,
    provider_verify_skipped: true,
    provider_verify_reason: "fresh_room_proof",
    auth_ms: 21,
    prepare_rpc_ms: 84,
    room_create_or_verify_ms: 0,
    token_ms: 147,
    confirm_prepare_ms: 93,
    edge_total_ms: 421,
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: rawProperties,
  });

  assert.deepEqual(result, { ok: true, queued: true });
  await flushVideoDateLaunchLatencyCheckpoints();
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.checkpoint, "first_remote_frame");
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.latency_ms, 1900);
});

test("launch latency checkpoint sanitization rejects secret-shaped payload keys", () => {
  assert.deepEqual(
    sanitizeVideoDateLaunchLatencyPayload({
      platform: "web",
      source_surface: "video_date_daily",
      source_action: "daily_join_success",
      outcome: "success",
      daily_join_ms: 612,
      token: "must_not_survive",
      daily_token: "must_not_survive",
      meeting_token: "must_not_survive",
      api_key: "must_not_survive",
      Authorization: "Bearer must_not_survive",
      nested: { token: "must_not_survive" },
    }),
    {
      platform: "web",
      source_surface: "video_date_daily",
      source_action: "daily_join_success",
      outcome: "success",
      daily_join_ms: 612,
    },
  );
});

test("permission prewarm skip checkpoint is safe and allowlisted", async () => {
  const rawProperties = {
    session_id: "3a54f630-2dec-4529-8dfa-349741bc593c",
    checkpoint: "permission_check_skipped",
    platform: "web",
    source_surface: "ready_gate_overlay",
    source_action: "permission_prewarm_silent_no_permissions_api",
    outcome: "no_op",
    reason_code: "skipped_no_permissions_api",
    token: "must_not_survive",
  };

  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(rawProperties), {
    platform: "web",
    source_surface: "ready_gate_overlay",
    source_action: "permission_prewarm_silent_no_permissions_api",
    outcome: "no_op",
    reason_code: "skipped_no_permissions_api",
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: rawProperties,
  });

  assert.deepEqual(result, { ok: true, queued: true });
  await flushVideoDateLaunchLatencyCheckpoints();
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.checkpoint, "permission_check_skipped");
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.latency_ms, null);
});

test("date route module preloaded checkpoint is safe and allowlisted", async () => {
  const rawProperties = {
    session_id: "5fd87bec-7088-41d0-a9f5-bc215510fda7",
    checkpoint: "date_route_module_preloaded",
    platform: "native",
    source_surface: "ready_gate_overlay",
    source_action: "route_preload_success",
    outcome: "success",
    date_route_module_preload_ms: 123,
    mutual_swipe_to_room_ready_ms: 810,
    eligible_pre_create_status: "warmup_ready",
    token: "must_not_survive",
  };

  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(rawProperties), {
    platform: "native",
    source_surface: "ready_gate_overlay",
    source_action: "route_preload_success",
    outcome: "success",
    date_route_module_preload_ms: 123,
    mutual_swipe_to_room_ready_ms: 810,
    eligible_pre_create_status: "warmup_ready",
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: rawProperties,
  });

  assert.deepEqual(result, { ok: true, queued: true });
  await flushVideoDateLaunchLatencyCheckpoints();
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.checkpoint, "date_route_module_preloaded");
  assert.equal(firstQueuedCheckpoint(capturedArgs)?.latency_ms, 123);
});
