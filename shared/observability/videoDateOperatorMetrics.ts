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
    source: "partial_existing_truth",
    primarySources: ["v_event_loop_swipe_mutual_events", "event_loop_observability_events"],
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
    primarySources: ["video_date_timer_drift_recovered_by_server_truth", "video_sessions"],
    thresholds: { warning: 0.03, critical: 0.08, direction: "lower_is_better" },
    unit: "rate",
  },
] as const satisfies readonly VideoDateOperatorMetricDefinition[];

export const VIDEO_DATE_OPERATOR_METRIC_IDS = VIDEO_DATE_OPERATOR_METRIC_DEFINITIONS.map(
  (metric) => metric.id,
) as readonly VideoDateOperatorMetricId[];

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
  LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH;

export const VIDEO_DATE_TIMER_DRIFT_MEANINGFUL_MS = 3_000;

export type VideoDateTimerDriftBucket =
  | "under_3s"
  | "3s_to_10s"
  | "10s_to_30s"
  | "30s_plus";

export type VideoDateTimerDriftRecoverySource =
  | "timing_fetch"
  | "realtime_update"
  | "session_truth_sync";

export type VideoDateTimerDriftPhase = "handshake" | "date" | "ended";

export type VideoDateTimerDriftDirection = "client_ahead" | "client_behind" | "aligned";

export type VideoDateTimerDriftRecoveredPayload = {
  platform: LobbyPostDatePlatform;
  session_id: string;
  event_id?: string;
  drift_ms: number;
  drift_bucket: VideoDateTimerDriftBucket;
  drift_direction: VideoDateTimerDriftDirection;
  recovery_source: VideoDateTimerDriftRecoverySource;
  phase: "date";
};

export function bucketVideoDateTimerDriftMs(driftMs: number): VideoDateTimerDriftBucket {
  const safeMs = Math.max(0, Math.round(Math.abs(driftMs)));
  if (safeMs < 3_000) return "under_3s";
  if (safeMs < 10_000) return "3s_to_10s";
  if (safeMs < 30_000) return "10s_to_30s";
  return "30s_plus";
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
}: {
  platform: LobbyPostDatePlatform;
  sessionId: string | null | undefined;
  eventId?: string | null;
  previousTimeLeftSeconds: number | null | undefined;
  correctedTimeLeftSeconds: number | null | undefined;
  recoverySource: VideoDateTimerDriftRecoverySource;
  phase: VideoDateTimerDriftPhase;
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
    drift_ms: driftMs,
    drift_bucket: bucketVideoDateTimerDriftMs(driftMs),
    drift_direction: driftDirection,
    recovery_source: recoverySource,
    phase: "date",
  };
}
