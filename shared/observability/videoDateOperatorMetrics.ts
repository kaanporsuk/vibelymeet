import {
  LobbyPostDateEvents,
  type LobbyPostDatePlatform,
} from "../analytics/lobbyToPostDateJourney";

export type VideoDateOperatorMetricId =
  | "ready_tap_to_first_remote_frame_latency"
  | "ready_gate_open_to_date_join_latency"
  | "simultaneous_swipe_collision_rate"
  | "survey_to_next_ready_gate_conversion"
  | "queue_drain_failure_rate"
  | "queue_fairness_starvation_rate"
  | "timer_drift_recovered_by_server_truth";

export type VideoDateOperatorMetricSource =
  | "database_truth"
  | "analytics"
  | "mixed"
  | "partial_existing_truth";

export type VideoDateOperatorMetricStatus = "healthy" | "warning" | "critical" | "unknown";

export type VideoDateOperatorThresholdDirection = "lower_is_better" | "higher_is_better";

export type VideoDateOperatorThresholds = {
  warning: number;
  critical: number;
  direction: VideoDateOperatorThresholdDirection;
};

export type VideoDateOperatorMetricDefinition = {
  id: VideoDateOperatorMetricId;
  label: string;
  source: VideoDateOperatorMetricSource;
  primarySources: string[];
  thresholds: VideoDateOperatorThresholds;
  unit: "milliseconds" | "rate";
  limitation?: string;
};

export const VIDEO_DATE_OPERATOR_METRIC_DEFINITIONS = [
  {
    id: "ready_tap_to_first_remote_frame_latency",
    label: "Ready tap to first remote frame latency",
    source: "mixed",
    primarySources: ["video_date_launch_latency_checkpoint", "ready_gate_to_date_latency_checkpoint"],
    thresholds: { warning: 8_000, critical: 15_000, direction: "lower_is_better" },
    unit: "milliseconds",
    limitation: "Durable samples require the authenticated client launch-latency checkpoint mirror.",
  },
  {
    id: "ready_gate_open_to_date_join_latency",
    label: "Ready Gate open to date join latency",
    source: "mixed",
    primarySources: ["event_loop_observability_events", "video_sessions"],
    thresholds: { warning: 10_000, critical: 20_000, direction: "lower_is_better" },
    unit: "milliseconds",
    limitation: "Ready Gate open is derived from promotion observability rows, not a dedicated column.",
  },
  {
    id: "simultaneous_swipe_collision_rate",
    label: "Simultaneous swipe collision rate",
    source: "mixed",
    primarySources: [
      "simultaneous_swipe_conflict_detected",
      "simultaneous_swipe_recovery_succeeded",
      "v_event_loop_swipe_mutual_events",
      "event_loop_observability_events",
    ],
    thresholds: { warning: 0.03, critical: 0.08, direction: "lower_is_better" },
    unit: "rate",
    limitation:
      "After the simultaneous-swipe recovery migration, already_matched rows with a session id represent recovered same-pair sessions.",
  },
  {
    id: "survey_to_next_ready_gate_conversion",
    label: "Survey to next Ready Gate conversion",
    source: "mixed",
    primarySources: [
      "post_date_continuity_survey_complete",
      "post_date_continuity_next_action_decided",
      "post_date_continuity_route_taken",
      "date_feedback",
      "event_loop_observability_events",
    ],
    thresholds: { warning: 0.35, critical: 0.2, direction: "higher_is_better" },
    unit: "rate",
  },
  {
    id: "queue_drain_failure_rate",
    label: "Queue drain failure rate",
    source: "database_truth",
    primarySources: ["v_event_loop_drain_events", "v_event_loop_observability_metric_streams"],
    thresholds: { warning: 0.05, critical: 0.15, direction: "lower_is_better" },
    unit: "rate",
  },
  {
    id: "queue_fairness_starvation_rate",
    label: "Queue fairness starvation rate",
    source: "database_truth",
    primarySources: [
      "v_video_date_queue_fairness_candidates",
      "v_video_date_queue_fairness_event_health",
      "get_video_date_queue_fairness_health",
    ],
    thresholds: { warning: 0.05, critical: 0.15, direction: "lower_is_better" },
    unit: "rate",
    limitation: "Current queued-slot health uses a 120s starvation threshold and 15-minute no-match/runtime-block windows.",
  },
  {
    id: "timer_drift_recovered_by_server_truth",
    label: "Timer drift recovered by server truth",
    source: "analytics",
    primarySources: [
      "video_date_timer_drift_detected",
      "video_date_timer_drift_recovered_by_server_truth",
      "video_sessions",
    ],
    thresholds: { warning: 0.03, critical: 0.08, direction: "lower_is_better" },
    unit: "rate",
  },
] as const satisfies readonly VideoDateOperatorMetricDefinition[];

export const VIDEO_DATE_OPERATOR_METRIC_IDS = VIDEO_DATE_OPERATOR_METRIC_DEFINITIONS.map(
  (metric) => metric.id,
) as readonly VideoDateOperatorMetricId[];

export type VideoDateOperatorOutcome =
  | "success"
  | "failure"
  | "blocked"
  | "no_op"
  | "timeout"
  | "recovered";

export type VideoDateLatencyBucket =
  | "lt_500ms"
  | "500ms_1s"
  | "1_2s"
  | "2_5s"
  | "5_15s"
  | "15_60s"
  | "gt_60s";

export function bucketVideoDateLatencyMs(durationMs: number | null | undefined): VideoDateLatencyBucket {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return "gt_60s";
  const safeMs = Math.max(0, Math.round(durationMs));
  if (safeMs < 500) return "lt_500ms";
  if (safeMs < 1_000) return "500ms_1s";
  if (safeMs < 2_000) return "1_2s";
  if (safeMs < 5_000) return "2_5s";
  if (safeMs < 15_000) return "5_15s";
  if (safeMs < 60_000) return "15_60s";
  return "gt_60s";
}

export type ReadyGateToDateLatencyCheckpoint =
  | "swipe_result"
  | "ready_gate_impression"
  | "ready_tap"
  | "ready_gate_transition_started"
  | "ready_gate_transition_success"
  | "both_ready_observed"
  | "both_ready_observed_via_rpc_short_circuit"
  | "mutual_swipe_observed"
  | "room_pre_create_started"
  | "room_pre_create_success"
  | "room_pre_create_failure"
  | "daily_room_create_started"
  | "daily_room_create_success"
  | "daily_room_create_failure"
  | "prepare_entry_started"
  | "prepare_entry_success"
  | "prepare_entry_failure"
  | "provider_verify_started"
  | "provider_verify_success"
  | "provider_verify_skipped"
  | "token_created"
  | "navigation_started"
  | "date_route_entered"
  | "date_route_module_preloaded"
  | "video_stage_shell_visible"
  | "permission_check_started"
  | "permission_check_success"
  | "permission_check_skipped"
  | "enter_handshake_started"
  | "enter_handshake_success"
  | "enter_handshake_failure"
  | "daily_token_started"
  | "daily_token_success"
  | "daily_token_failure"
  | "daily_token_mint_started"
  | "daily_token_mint_success"
  | "daily_token_mint_failure"
  | "daily_join_started"
  | "daily_join_success"
  | "daily_join_failure"
  | "daily_reconnect_started"
  | "daily_reconnect_success"
  | "daily_reconnect_failure"
  | "extension_refresh_started"
  | "extension_refresh_success"
  | "extension_refresh_failure"
  | "local_video_ready"
  | "remote_seen"
  | "first_remote_frame"
  | "remote_readable"
  | "warmup_timer_started"
  | "daily_prewarm_started"
  | "daily_prewarm_camera_ready"
  | "daily_prewarm_preauth_success"
  | "daily_prewarm_join_started"
  | "daily_prewarm_join_success"
  | "daily_prewarm_join_failure"
  | "daily_prewarm_consumed"
  | "daily_prewarm_fallback"
  | "daily_prewarm_destroyed"
  | "video_date_route_preload_started"
  | "video_date_route_preload_success";

export type ReadyGateToDateLatencyContext = {
  platform: LobbyPostDatePlatform;
  sessionId: string;
  eventId?: string | null;
  sourceSurface: string;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  cachedPrepareEntry?: boolean | null;
  providerVerifySkipped?: boolean | null;
  permissionHandoffUsed?: boolean | null;
  readyGateOpenedAtMs?: number;
  readyTapAtMs?: number;
  readyGateTransitionStartedAtMs?: number;
  readyGateTransitionCompletedAtMs?: number;
  bothReadyObservedAtMs?: number;
  prepareEntryStartedAtMs?: number;
  prepareEntryCompletedAtMs?: number;
  providerVerifyStartedAtMs?: number;
  providerVerifyCompletedAtMs?: number;
  tokenCreatedAtMs?: number;
  navigationStartedAtMs?: number;
  dateRouteEnteredAtMs?: number;
  videoStageShellVisibleAtMs?: number;
  permissionCheckStartedAtMs?: number;
  permissionCheckCompletedAtMs?: number;
  enterHandshakeStartedAtMs?: number;
  enterHandshakeCompletedAtMs?: number;
  dailyTokenStartedAtMs?: number;
  dailyTokenCompletedAtMs?: number;
  dailyJoinStartedAtMs?: number;
  dailyJoinCompletedAtMs?: number;
  localVideoReadyAtMs?: number;
  remoteSeenAtMs?: number;
  firstRemoteFrameAtMs?: number;
  remoteReadableAtMs?: number;
  warmupTimerStartedAtMs?: number;
  dailyPrewarmStartedAtMs?: number;
  dailyPrewarmCameraReadyAtMs?: number;
  dailyPrewarmPreAuthSuccessAtMs?: number;
  dailyPrewarmJoinStartedAtMs?: number;
  dailyPrewarmJoinCompletedAtMs?: number;
  dailyPrewarmConsumedAtMs?: number;
  dailyPrewarmFallbackAtMs?: number;
  dailyPrewarmDestroyedAtMs?: number;
  videoDateRoutePreloadStartedAtMs?: number;
  videoDateRoutePreloadCompletedAtMs?: number;
  swipeResultObservedAtMs?: number;
  mutualSwipeObservedAtMs?: number;
  roomPreCreateStartedAtMs?: number;
  roomPreCreateSuccessAtMs?: number;
  roomPreCreateFailureAtMs?: number;
  dailyRoomCreateStartedAtMs?: number;
  dailyRoomCreateCompletedAtMs?: number;
  dailyTokenMintStartedAtMs?: number;
  dailyTokenMintCompletedAtMs?: number;
  dailyReconnectStartedAtMs?: number;
  dailyReconnectCompletedAtMs?: number;
  extensionRefreshStartedAtMs?: number;
  extensionRefreshCompletedAtMs?: number;
  attemptCount?: number;
};

export type ReadyGateToDateLatencyDurations = {
  readyGateOpenToReadyTapMs: number | null;
  readyTapToBothReadyMs: number | null;
  readyTapToPrepareEntryMs: number | null;
  readyTapToDateRouteMs: number | null;
  readyTapToDailyJoinMs: number | null;
  readyTapToRemoteSeenMs: number | null;
  readyTapToFirstRemoteFrameMs: number | null;
  bothReadyToDateRouteMs: number | null;
  bothReadyToDailyTokenMs: number | null;
  bothReadyToDailyJoinMs: number | null;
  bothReadyToRemoteSeenMs: number | null;
  bothReadyToFirstRemoteFrameMs: number | null;
  bothReadyToVideoStageShellMs: number | null;
  bothReadyToLocalVideoReadyMs: number | null;
  dateRouteBootstrapMs: number | null;
  dateRouteToDailyJoinMs: number | null;
  dailyJoinToRemoteSeenMs: number | null;
  dailyJoinToFirstRemoteFrameMs: number | null;
  remoteSeenToFirstRemoteFrameMs: number | null;
  firstRemoteFrameToReadableMs: number | null;
  dailyTokenDurationMs: number | null;
  dailyTokenMintDurationMs: number | null;
  dailyJoinDurationMs: number | null;
  dailyReconnectDurationMs: number | null;
  extensionRefreshDurationMs: number | null;
  dailyRoomCreateDurationMs: number | null;
  prepareEntryDurationMs: number | null;
  providerVerifyDurationMs: number | null;
  permissionCheckDurationMs: number | null;
};

const readyGateToDateLatencyContexts = new Map<string, ReadyGateToDateLatencyContext>();

function diffMs(fromMs: number | null | undefined, toMs: number | null | undefined): number | null {
  if (typeof fromMs !== "number" || typeof toMs !== "number") return null;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.max(0, Math.round(toMs - fromMs));
}

function checkpointField(checkpoint: ReadyGateToDateLatencyCheckpoint): keyof ReadyGateToDateLatencyContext {
  switch (checkpoint) {
    case "swipe_result":
      return "swipeResultObservedAtMs";
    case "ready_gate_impression":
      return "readyGateOpenedAtMs";
    case "ready_tap":
      return "readyTapAtMs";
    case "ready_gate_transition_started":
      return "readyGateTransitionStartedAtMs";
    case "ready_gate_transition_success":
      return "readyGateTransitionCompletedAtMs";
    case "both_ready_observed":
    case "both_ready_observed_via_rpc_short_circuit":
      return "bothReadyObservedAtMs";
    case "mutual_swipe_observed":
      return "mutualSwipeObservedAtMs";
    case "room_pre_create_started":
      return "roomPreCreateStartedAtMs";
    case "room_pre_create_success":
      return "roomPreCreateSuccessAtMs";
    case "room_pre_create_failure":
      return "roomPreCreateFailureAtMs";
    case "daily_room_create_started":
      return "dailyRoomCreateStartedAtMs";
    case "daily_room_create_success":
    case "daily_room_create_failure":
      return "dailyRoomCreateCompletedAtMs";
    case "prepare_entry_started":
      return "prepareEntryStartedAtMs";
    case "prepare_entry_success":
    case "prepare_entry_failure":
      return "prepareEntryCompletedAtMs";
    case "provider_verify_started":
      return "providerVerifyStartedAtMs";
    case "provider_verify_success":
    case "provider_verify_skipped":
      return "providerVerifyCompletedAtMs";
    case "token_created":
      return "tokenCreatedAtMs";
    case "navigation_started":
      return "navigationStartedAtMs";
    case "date_route_entered":
      return "dateRouteEnteredAtMs";
    case "date_route_module_preloaded":
      return "videoDateRoutePreloadCompletedAtMs";
    case "video_stage_shell_visible":
      return "videoStageShellVisibleAtMs";
    case "permission_check_started":
      return "permissionCheckStartedAtMs";
    case "permission_check_success":
    case "permission_check_skipped":
      return "permissionCheckCompletedAtMs";
    case "enter_handshake_started":
      return "enterHandshakeStartedAtMs";
    case "enter_handshake_success":
    case "enter_handshake_failure":
      return "enterHandshakeCompletedAtMs";
    case "daily_token_started":
      return "dailyTokenStartedAtMs";
    case "daily_token_success":
    case "daily_token_failure":
      return "dailyTokenCompletedAtMs";
    case "daily_token_mint_started":
      return "dailyTokenMintStartedAtMs";
    case "daily_token_mint_success":
    case "daily_token_mint_failure":
      return "dailyTokenMintCompletedAtMs";
    case "daily_join_started":
      return "dailyJoinStartedAtMs";
    case "daily_join_success":
    case "daily_join_failure":
      return "dailyJoinCompletedAtMs";
    case "daily_reconnect_started":
      return "dailyReconnectStartedAtMs";
    case "daily_reconnect_success":
    case "daily_reconnect_failure":
      return "dailyReconnectCompletedAtMs";
    case "extension_refresh_started":
      return "extensionRefreshStartedAtMs";
    case "extension_refresh_success":
    case "extension_refresh_failure":
      return "extensionRefreshCompletedAtMs";
    case "local_video_ready":
      return "localVideoReadyAtMs";
    case "remote_seen":
      return "remoteSeenAtMs";
    case "first_remote_frame":
      return "firstRemoteFrameAtMs";
    case "remote_readable":
      return "remoteReadableAtMs";
    case "warmup_timer_started":
      return "warmupTimerStartedAtMs";
    case "daily_prewarm_started":
      return "dailyPrewarmStartedAtMs";
    case "daily_prewarm_camera_ready":
      return "dailyPrewarmCameraReadyAtMs";
    case "daily_prewarm_preauth_success":
      return "dailyPrewarmPreAuthSuccessAtMs";
    case "daily_prewarm_join_started":
      return "dailyPrewarmJoinStartedAtMs";
    case "daily_prewarm_join_success":
    case "daily_prewarm_join_failure":
      return "dailyPrewarmJoinCompletedAtMs";
    case "daily_prewarm_consumed":
      return "dailyPrewarmConsumedAtMs";
    case "daily_prewarm_fallback":
      return "dailyPrewarmFallbackAtMs";
    case "daily_prewarm_destroyed":
      return "dailyPrewarmDestroyedAtMs";
    case "video_date_route_preload_started":
      return "videoDateRoutePreloadStartedAtMs";
    case "video_date_route_preload_success":
      return "videoDateRoutePreloadCompletedAtMs";
  }
}

export function startReadyGateToDateLatencyContext({
  platform,
  sessionId,
  eventId,
  sourceSurface,
  entryAttemptId,
  videoDateTraceId,
  cachedPrepareEntry,
  providerVerifySkipped,
  permissionHandoffUsed,
  nowMs = Date.now(),
}: {
  platform: LobbyPostDatePlatform;
  sessionId: string;
  eventId?: string | null;
  sourceSurface: string;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  cachedPrepareEntry?: boolean | null;
  providerVerifySkipped?: boolean | null;
  permissionHandoffUsed?: boolean | null;
  nowMs?: number;
}): ReadyGateToDateLatencyContext {
  const previous = readyGateToDateLatencyContexts.get(sessionId);
  const context: ReadyGateToDateLatencyContext = {
    platform,
    sessionId,
    eventId,
    sourceSurface,
    swipeResultObservedAtMs: previous?.swipeResultObservedAtMs,
  };
  context.entryAttemptId = entryAttemptId;
  context.videoDateTraceId = videoDateTraceId;
  context.cachedPrepareEntry = cachedPrepareEntry;
  context.providerVerifySkipped = providerVerifySkipped;
  context.permissionHandoffUsed = permissionHandoffUsed;
  context.readyGateOpenedAtMs = nowMs;
  readyGateToDateLatencyContexts.set(sessionId, context);
  return context;
}

export function getReadyGateToDateLatencyContext(
  sessionId: string | null | undefined,
): ReadyGateToDateLatencyContext | null {
  if (!sessionId) return null;
  return readyGateToDateLatencyContexts.get(sessionId) ?? null;
}

export function recordReadyGateToDateLatencyCheckpoint({
  sessionId,
  platform,
  eventId,
  sourceSurface = "unknown",
  checkpoint,
  nowMs = Date.now(),
  attemptCount,
  entryAttemptId,
  videoDateTraceId,
  cachedPrepareEntry,
  providerVerifySkipped,
  permissionHandoffUsed,
}: {
  sessionId: string;
  platform?: LobbyPostDatePlatform;
  eventId?: string | null;
  sourceSurface?: string;
  checkpoint: ReadyGateToDateLatencyCheckpoint;
  nowMs?: number;
  attemptCount?: number;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  cachedPrepareEntry?: boolean | null;
  providerVerifySkipped?: boolean | null;
  permissionHandoffUsed?: boolean | null;
}): ReadyGateToDateLatencyContext {
  const context =
    readyGateToDateLatencyContexts.get(sessionId) ??
    {
      platform: platform ?? "web",
      sessionId,
      eventId,
      sourceSurface,
    };
  if (platform) context.platform = platform;
  if (eventId !== undefined) context.eventId = eventId;
  if (sourceSurface) context.sourceSurface = sourceSurface;
  if (attemptCount !== undefined) context.attemptCount = attemptCount;
  if (entryAttemptId !== undefined) context.entryAttemptId = entryAttemptId;
  if (videoDateTraceId !== undefined) context.videoDateTraceId = videoDateTraceId;
  if (cachedPrepareEntry !== undefined) context.cachedPrepareEntry = cachedPrepareEntry;
  if (providerVerifySkipped !== undefined) context.providerVerifySkipped = providerVerifySkipped;
  if (permissionHandoffUsed !== undefined) context.permissionHandoffUsed = permissionHandoffUsed;

  const field = checkpointField(checkpoint);
  (context as Record<string, unknown>)[field] = nowMs;
  readyGateToDateLatencyContexts.set(sessionId, context);
  return context;
}

export function getReadyGateToDateLatencyDurations(
  context: ReadyGateToDateLatencyContext | null | undefined,
): ReadyGateToDateLatencyDurations {
  return {
    readyGateOpenToReadyTapMs: diffMs(context?.readyGateOpenedAtMs, context?.readyTapAtMs),
    readyTapToBothReadyMs: diffMs(context?.readyTapAtMs, context?.bothReadyObservedAtMs),
    readyTapToPrepareEntryMs: diffMs(context?.readyTapAtMs, context?.prepareEntryCompletedAtMs),
    readyTapToDateRouteMs: diffMs(context?.readyTapAtMs, context?.dateRouteEnteredAtMs),
    readyTapToDailyJoinMs: diffMs(context?.readyTapAtMs, context?.dailyJoinCompletedAtMs),
    readyTapToRemoteSeenMs: diffMs(context?.readyTapAtMs, context?.remoteSeenAtMs),
    readyTapToFirstRemoteFrameMs: diffMs(context?.readyTapAtMs, context?.firstRemoteFrameAtMs),
    bothReadyToDateRouteMs: diffMs(context?.bothReadyObservedAtMs, context?.dateRouteEnteredAtMs),
    bothReadyToDailyTokenMs: diffMs(context?.bothReadyObservedAtMs, context?.dailyTokenCompletedAtMs),
    bothReadyToDailyJoinMs: diffMs(context?.bothReadyObservedAtMs, context?.dailyJoinCompletedAtMs),
    bothReadyToRemoteSeenMs: diffMs(context?.bothReadyObservedAtMs, context?.remoteSeenAtMs),
    bothReadyToFirstRemoteFrameMs: diffMs(context?.bothReadyObservedAtMs, context?.firstRemoteFrameAtMs),
    bothReadyToVideoStageShellMs: diffMs(context?.bothReadyObservedAtMs, context?.videoStageShellVisibleAtMs),
    bothReadyToLocalVideoReadyMs: diffMs(context?.bothReadyObservedAtMs, context?.localVideoReadyAtMs),
    dateRouteBootstrapMs: diffMs(context?.dateRouteEnteredAtMs, context?.dailyJoinStartedAtMs),
    dateRouteToDailyJoinMs: diffMs(context?.dateRouteEnteredAtMs, context?.dailyJoinCompletedAtMs),
    dailyJoinToRemoteSeenMs: diffMs(context?.dailyJoinCompletedAtMs, context?.remoteSeenAtMs),
    dailyJoinToFirstRemoteFrameMs: diffMs(context?.dailyJoinCompletedAtMs, context?.firstRemoteFrameAtMs),
    remoteSeenToFirstRemoteFrameMs: diffMs(context?.remoteSeenAtMs, context?.firstRemoteFrameAtMs),
    firstRemoteFrameToReadableMs: diffMs(context?.firstRemoteFrameAtMs, context?.remoteReadableAtMs),
    dailyTokenDurationMs: diffMs(context?.dailyTokenStartedAtMs, context?.dailyTokenCompletedAtMs),
    dailyTokenMintDurationMs: diffMs(context?.dailyTokenMintStartedAtMs, context?.dailyTokenMintCompletedAtMs),
    dailyJoinDurationMs: diffMs(context?.dailyJoinStartedAtMs, context?.dailyJoinCompletedAtMs),
    dailyReconnectDurationMs: diffMs(context?.dailyReconnectStartedAtMs, context?.dailyReconnectCompletedAtMs),
    extensionRefreshDurationMs: diffMs(context?.extensionRefreshStartedAtMs, context?.extensionRefreshCompletedAtMs),
    dailyRoomCreateDurationMs: diffMs(context?.dailyRoomCreateStartedAtMs, context?.dailyRoomCreateCompletedAtMs),
    prepareEntryDurationMs: diffMs(context?.prepareEntryStartedAtMs, context?.prepareEntryCompletedAtMs),
    providerVerifyDurationMs: diffMs(context?.providerVerifyStartedAtMs, context?.providerVerifyCompletedAtMs),
    permissionCheckDurationMs: diffMs(context?.permissionCheckStartedAtMs, context?.permissionCheckCompletedAtMs),
  };
}

export function buildReadyGateToDateLatencyPayload({
  context,
  checkpoint,
  sourceAction,
  outcome,
  reasonCode,
  durationMs,
  attemptCount,
  extra,
}: {
  context: ReadyGateToDateLatencyContext;
  checkpoint: ReadyGateToDateLatencyCheckpoint;
  sourceAction: string;
  outcome: VideoDateOperatorOutcome;
  reasonCode?: string | null;
  durationMs?: number | null;
  attemptCount?: number;
  extra?: Record<string, string | number | boolean | null | undefined>;
}) {
  const checkpointAtMs = context[checkpointField(checkpoint)] as number | undefined;
  const fallbackDurationMs =
    checkpoint === "ready_tap"
      ? diffMs(context.readyGateOpenedAtMs, checkpointAtMs)
      : diffMs(context.bothReadyObservedAtMs ?? context.readyGateOpenedAtMs, checkpointAtMs);
  const resolvedDurationMs = durationMs ?? fallbackDurationMs;
  const durations = getReadyGateToDateLatencyDurations(context);

  return {
    platform: context.platform,
    session_id: context.sessionId,
    event_id: context.eventId ?? null,
    source_surface: context.sourceSurface,
    source_action: sourceAction,
    checkpoint,
    outcome,
    reason_code: reasonCode ?? null,
    attempt_count: attemptCount ?? context.attemptCount ?? null,
    entry_attempt_id: context.entryAttemptId ?? null,
    video_date_trace_id: context.videoDateTraceId ?? null,
    cached_prepare_entry: context.cachedPrepareEntry ?? null,
    provider_verify_skipped: context.providerVerifySkipped ?? null,
    permission_handoff_used: context.permissionHandoffUsed ?? null,
    duration_ms: resolvedDurationMs,
    latency_bucket: bucketVideoDateLatencyMs(resolvedDurationMs),
    ...durations,
    ready_gate_open_to_ready_tap_ms: durations.readyGateOpenToReadyTapMs,
    ready_tap_to_both_ready_ms: durations.readyTapToBothReadyMs,
    ready_tap_to_prepare_entry_ms: durations.readyTapToPrepareEntryMs,
    ready_tap_to_date_route_ms: durations.readyTapToDateRouteMs,
    ready_tap_to_daily_join_ms: durations.readyTapToDailyJoinMs,
    ready_tap_to_remote_seen_ms: durations.readyTapToRemoteSeenMs,
    ready_tap_to_first_remote_frame_ms: durations.readyTapToFirstRemoteFrameMs,
    both_ready_to_date_route_ms: durations.bothReadyToDateRouteMs,
    both_ready_to_daily_token_ms: durations.bothReadyToDailyTokenMs,
    both_ready_to_daily_join_ms: durations.bothReadyToDailyJoinMs,
    both_ready_to_remote_seen_ms: durations.bothReadyToRemoteSeenMs,
    both_ready_to_first_remote_frame_ms: durations.bothReadyToFirstRemoteFrameMs,
    both_ready_to_video_stage_shell_ms: durations.bothReadyToVideoStageShellMs,
    both_ready_to_local_video_ready_ms: durations.bothReadyToLocalVideoReadyMs,
    date_route_bootstrap_ms: durations.dateRouteBootstrapMs,
    date_route_to_daily_join_ms: durations.dateRouteToDailyJoinMs,
    daily_join_to_remote_seen_ms: durations.dailyJoinToRemoteSeenMs,
    daily_join_to_first_remote_frame_ms: durations.dailyJoinToFirstRemoteFrameMs,
    remote_seen_to_first_remote_frame_ms: durations.remoteSeenToFirstRemoteFrameMs,
    first_remote_frame_to_readable_ms: durations.firstRemoteFrameToReadableMs,
    daily_token_ms: durations.dailyTokenDurationMs,
    daily_token_mint_ms: durations.dailyTokenMintDurationMs,
    daily_join_ms: durations.dailyJoinDurationMs,
    daily_reconnect_ms: durations.dailyReconnectDurationMs,
    extension_refresh_ms: durations.extensionRefreshDurationMs,
    daily_room_create_ms: durations.dailyRoomCreateDurationMs,
    prepare_entry_ms: durations.prepareEntryDurationMs,
    provider_verify_ms: durations.providerVerifyDurationMs,
    permission_check_ms: durations.permissionCheckDurationMs,
    ...(extra ?? {}),
  };
}

export function classifyVideoDateOperatorMetric(
  value: number | null | undefined,
  thresholds: VideoDateOperatorThresholds,
): VideoDateOperatorMetricStatus {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";

  if (thresholds.direction === "higher_is_better") {
    if (value <= thresholds.critical) return "critical";
    if (value <= thresholds.warning) return "warning";
    return "healthy";
  }

  if (value >= thresholds.critical) return "critical";
  if (value >= thresholds.warning) return "warning";
  return "healthy";
}

export const VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME =
  LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED;

export const VIDEO_DATE_TIMER_DRIFT_LEGACY_RECOVERY_EVENT_NAME =
  LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH;

export const VIDEO_DATE_TIMER_DRIFT_MEANINGFUL_MS = 1_000;

export type VideoDateTimerDriftBucket =
  | "lt_1s"
  | "1_5s"
  | "5_15s"
  | "15_60s"
  | "gt_60s";

export type VideoDateTimerDriftRecoverySource =
  | "foreground_reconcile"
  | "sync_reconnect"
  | "session_reload"
  | "realtime"
  | "route_hydration";

export type VideoDateTimerDriftPhase = "handshake" | "date" | "ended";

export type VideoDateTimerDriftDirection = "client_ahead" | "client_behind" | "aligned";

export type VideoDateTimerDriftRecoveredPayload = {
  platform: LobbyPostDatePlatform;
  session_id: string;
  event_id?: string;
  source_surface: "video_date";
  source_action: VideoDateTimerDriftRecoverySource;
  outcome: Extract<VideoDateOperatorOutcome, "recovered">;
  drift_ms: number;
  drift_bucket: VideoDateTimerDriftBucket;
  drift_direction: VideoDateTimerDriftDirection;
  recovery_source: VideoDateTimerDriftRecoverySource;
  local_phase: VideoDateTimerDriftPhase;
  server_phase: VideoDateTimerDriftPhase;
  phase: "date";
  survey_recovered: boolean;
  date_phase_restored: boolean;
  ended_state_corrected: boolean;
};

export function bucketVideoDateTimerDriftMs(driftMs: number): VideoDateTimerDriftBucket {
  const safeMs = Math.max(0, Math.round(Math.abs(driftMs)));
  if (safeMs < 1_000) return "lt_1s";
  if (safeMs < 5_000) return "1_5s";
  if (safeMs < 15_000) return "5_15s";
  if (safeMs < 60_000) return "15_60s";
  return "gt_60s";
}

export function shouldTrackVideoDateTimerDriftRecovery({
  previousTimeLeftSeconds,
  correctedTimeLeftSeconds,
  thresholdMs = VIDEO_DATE_TIMER_DRIFT_MEANINGFUL_MS,
}: {
  previousTimeLeftSeconds: number | null | undefined;
  correctedTimeLeftSeconds: number | null | undefined;
  thresholdMs?: number;
}): boolean {
  if (typeof previousTimeLeftSeconds !== "number" || !Number.isFinite(previousTimeLeftSeconds)) {
    return false;
  }
  if (typeof correctedTimeLeftSeconds !== "number" || !Number.isFinite(correctedTimeLeftSeconds)) {
    return false;
  }
  const driftMs = Math.round(Math.abs(previousTimeLeftSeconds - correctedTimeLeftSeconds) * 1_000);
  return driftMs >= thresholdMs;
}

export function buildVideoDateTimerDriftRecoveredPayload({
  platform,
  sessionId,
  eventId,
  previousTimeLeftSeconds,
  correctedTimeLeftSeconds,
  recoverySource,
  phase,
  serverPhase = phase,
  surveyRecovered = false,
  datePhaseRestored = phase === "date",
  endedStateCorrected = false,
}: {
  platform: LobbyPostDatePlatform;
  sessionId: string | null | undefined;
  eventId?: string | null;
  previousTimeLeftSeconds: number | null | undefined;
  correctedTimeLeftSeconds: number | null | undefined;
  recoverySource: VideoDateTimerDriftRecoverySource;
  phase: VideoDateTimerDriftPhase;
  serverPhase?: VideoDateTimerDriftPhase;
  surveyRecovered?: boolean;
  datePhaseRestored?: boolean;
  endedStateCorrected?: boolean;
}): VideoDateTimerDriftRecoveredPayload | null {
  if (!sessionId || phase !== "date") return null;
  if (!shouldTrackVideoDateTimerDriftRecovery({ previousTimeLeftSeconds, correctedTimeLeftSeconds })) {
    return null;
  }

  const driftMs = Math.round(Math.abs(previousTimeLeftSeconds! - correctedTimeLeftSeconds!) * 1_000);
  const driftDirection: VideoDateTimerDriftDirection =
    previousTimeLeftSeconds! > correctedTimeLeftSeconds!
      ? "client_ahead"
      : previousTimeLeftSeconds! < correctedTimeLeftSeconds!
        ? "client_behind"
        : "aligned";

  return {
    platform,
    session_id: sessionId,
    ...(eventId ? { event_id: eventId } : {}),
    source_surface: "video_date",
    source_action: recoverySource,
    outcome: "recovered",
    drift_ms: driftMs,
    drift_bucket: bucketVideoDateTimerDriftMs(driftMs),
    drift_direction: driftDirection,
    recovery_source: recoverySource,
    local_phase: phase,
    server_phase: serverPhase,
    phase: "date",
    survey_recovered: surveyRecovered,
    date_phase_restored: datePhaseRestored,
    ended_state_corrected: endedStateCorrected,
  };
}
