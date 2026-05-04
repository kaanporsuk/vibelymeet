import {
  LobbyPostDateEvents,
  type LobbyPostDatePlatform,
} from "../analytics/lobbyToPostDateJourney";

export type VideoDateOperatorMetricId =
  | "ready_gate_open_to_date_join_latency"
  | "simultaneous_swipe_collision_rate"
  | "survey_to_next_ready_gate_conversion"
  | "queue_drain_failure_rate"
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
  | "ready_gate_impression"
  | "ready_tap"
  | "ready_gate_transition_started"
  | "ready_gate_transition_success"
  | "both_ready_observed"
  | "room_warmup_started"
  | "room_warmup_success"
  | "room_warmup_failure"
  | "prepare_entry_started"
  | "prepare_entry_success"
  | "prepare_entry_failure"
  | "provider_verify_started"
  | "provider_verify_success"
  | "provider_verify_skipped"
  | "token_created"
  | "navigation_started"
  | "date_route_entered"
  | "video_stage_shell_visible"
  | "permission_check_started"
  | "permission_check_success"
  | "enter_handshake_started"
  | "enter_handshake_success"
  | "enter_handshake_failure"
  | "daily_token_started"
  | "daily_token_success"
  | "daily_token_failure"
  | "daily_join_started"
  | "daily_join_success"
  | "daily_join_failure"
  | "local_video_ready"
  | "remote_seen"
  | "first_remote_frame"
  | "remote_readable"
  | "warmup_timer_started";

export type ReadyGateToDateLatencyContext = {
  platform: LobbyPostDatePlatform;
  sessionId: string;
  eventId?: string | null;
  sourceSurface: string;
  readyGateOpenedAtMs?: number;
  readyTapAtMs?: number;
  readyGateTransitionStartedAtMs?: number;
  readyGateTransitionCompletedAtMs?: number;
  bothReadyObservedAtMs?: number;
  roomWarmupStartedAtMs?: number;
  roomWarmupCompletedAtMs?: number;
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
  attemptCount?: number;
};

export type ReadyGateToDateLatencyDurations = {
  readyGateOpenToReadyTapMs: number | null;
  bothReadyToDateRouteMs: number | null;
  bothReadyToDailyTokenMs: number | null;
  bothReadyToDailyJoinMs: number | null;
  bothReadyToRemoteSeenMs: number | null;
  bothReadyToFirstRemoteFrameMs: number | null;
  bothReadyToVideoStageShellMs: number | null;
  bothReadyToLocalVideoReadyMs: number | null;
  firstRemoteFrameToReadableMs: number | null;
  dailyTokenDurationMs: number | null;
  dailyJoinDurationMs: number | null;
  roomWarmupDurationMs: number | null;
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
    case "ready_gate_impression":
      return "readyGateOpenedAtMs";
    case "ready_tap":
      return "readyTapAtMs";
    case "ready_gate_transition_started":
      return "readyGateTransitionStartedAtMs";
    case "ready_gate_transition_success":
      return "readyGateTransitionCompletedAtMs";
    case "both_ready_observed":
      return "bothReadyObservedAtMs";
    case "room_warmup_started":
      return "roomWarmupStartedAtMs";
    case "room_warmup_success":
    case "room_warmup_failure":
      return "roomWarmupCompletedAtMs";
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
    case "video_stage_shell_visible":
      return "videoStageShellVisibleAtMs";
    case "permission_check_started":
      return "permissionCheckStartedAtMs";
    case "permission_check_success":
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
    case "daily_join_started":
      return "dailyJoinStartedAtMs";
    case "daily_join_success":
    case "daily_join_failure":
      return "dailyJoinCompletedAtMs";
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
  }
}

export function startReadyGateToDateLatencyContext({
  platform,
  sessionId,
  eventId,
  sourceSurface,
  nowMs = Date.now(),
}: {
  platform: LobbyPostDatePlatform;
  sessionId: string;
  eventId?: string | null;
  sourceSurface: string;
  nowMs?: number;
}): ReadyGateToDateLatencyContext {
  const context: ReadyGateToDateLatencyContext = {
    platform,
    sessionId,
    eventId,
    sourceSurface,
    readyGateOpenedAtMs: nowMs,
  };
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
}: {
  sessionId: string;
  platform?: LobbyPostDatePlatform;
  eventId?: string | null;
  sourceSurface?: string;
  checkpoint: ReadyGateToDateLatencyCheckpoint;
  nowMs?: number;
  attemptCount?: number;
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
    bothReadyToDateRouteMs: diffMs(context?.bothReadyObservedAtMs, context?.dateRouteEnteredAtMs),
    bothReadyToDailyTokenMs: diffMs(context?.bothReadyObservedAtMs, context?.dailyTokenCompletedAtMs),
    bothReadyToDailyJoinMs: diffMs(context?.bothReadyObservedAtMs, context?.dailyJoinCompletedAtMs),
    bothReadyToRemoteSeenMs: diffMs(context?.bothReadyObservedAtMs, context?.remoteSeenAtMs),
    bothReadyToFirstRemoteFrameMs: diffMs(context?.bothReadyObservedAtMs, context?.firstRemoteFrameAtMs),
    bothReadyToVideoStageShellMs: diffMs(context?.bothReadyObservedAtMs, context?.videoStageShellVisibleAtMs),
    bothReadyToLocalVideoReadyMs: diffMs(context?.bothReadyObservedAtMs, context?.localVideoReadyAtMs),
    firstRemoteFrameToReadableMs: diffMs(context?.firstRemoteFrameAtMs, context?.remoteReadableAtMs),
    dailyTokenDurationMs: diffMs(context?.dailyTokenStartedAtMs, context?.dailyTokenCompletedAtMs),
    dailyJoinDurationMs: diffMs(context?.dailyJoinStartedAtMs, context?.dailyJoinCompletedAtMs),
    roomWarmupDurationMs: diffMs(context?.roomWarmupStartedAtMs, context?.roomWarmupCompletedAtMs),
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
    duration_ms: resolvedDurationMs,
    latency_bucket: bucketVideoDateLatencyMs(resolvedDurationMs),
    ...durations,
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
