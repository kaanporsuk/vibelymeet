export const READY_GATE_REALTIME_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;
export const READY_GATE_REALTIME_RECONNECT_MAX_DELAY_MS = 5_000;

export const READY_GATE_REALTIME_TELEMETRY = {
  DEGRADED: "ready_gate_realtime_degraded",
  RECOVERED: "ready_gate_realtime_recovered",
  SNAPSHOT_GAP_RECOVERED: "ready_gate_snapshot_gap_recovered",
} as const;

export type ReadyGateRealtimeTelemetryName =
  (typeof READY_GATE_REALTIME_TELEMETRY)[keyof typeof READY_GATE_REALTIME_TELEMETRY];

export type ReadyGateRealtimeStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | string;

export type ReadyGateRealtimeSupervisorContext = {
  sessionId: string;
  eventId: string | null;
  platform: "web" | "native";
  sourceSurface: string;
  source: string;
  status?: ReadyGateRealtimeStatus | null;
  reason?: string | null;
  attempt?: number | null;
  delayMs?: number | null;
  error?: string | null;
};

export type ReadyGateSnapshotRecoveryResult = {
  ok: boolean;
  seq: number | null;
  error?: string | null;
};

export type ReadyGateRealtimeSupervisorOptions = {
  sessionId: string;
  eventId?: string | null;
  platform: "web" | "native";
  sourceSurface: string;
  onResubscribe: (context: ReadyGateRealtimeSupervisorContext) => void;
  onDegradedChange?: (degraded: boolean, context: ReadyGateRealtimeSupervisorContext) => void;
  fetchCanonicalSnapshot?: (
    context: ReadyGateRealtimeSupervisorContext,
  ) => Promise<ReadyGateSnapshotRecoveryResult | null | void>;
  emitTelemetry?: (
    eventName: ReadyGateRealtimeTelemetryName,
    payload: Record<string, unknown>,
  ) => void;
  nowMs?: () => number;
};

export type ReadyGateRealtimeSupervisor = {
  handleStatus: (source: string, status: ReadyGateRealtimeStatus, error?: unknown) => void;
  clearSource: (source: string, reason?: string) => void;
  recordSnapshotGapRecovered: (input: {
    source: string;
    targetSeq: number;
    expectedSeq?: number | null;
    snapshotSeq?: number | null;
  }) => void;
  isDegraded: () => boolean;
  dispose: () => void;
};

export function isReadyGateResilientClockEnabled(input: {
  timelineV2Enabled: boolean;
  aliasEnabled?: boolean;
}): boolean {
  return input.timelineV2Enabled || input.aliasEnabled === true;
}

export function isReadyGateResilientBroadcastEnabled(input: {
  broadcastV2Enabled: boolean;
  aliasEnabled?: boolean;
}): boolean {
  return input.broadcastV2Enabled || input.aliasEnabled === true;
}

export function getReadyGateRealtimeReconnectDelayMs(attempt: number): number {
  const normalizedAttempt =
    typeof attempt === "number" && Number.isFinite(attempt)
      ? Math.max(1, Math.floor(attempt))
      : 1;
  const configured = READY_GATE_REALTIME_RECONNECT_DELAYS_MS[normalizedAttempt - 1];
  if (configured != null) return configured;
  const lastConfigured = READY_GATE_REALTIME_RECONNECT_DELAYS_MS[
    READY_GATE_REALTIME_RECONNECT_DELAYS_MS.length - 1
  ];
  const extraExponent = normalizedAttempt - READY_GATE_REALTIME_RECONNECT_DELAYS_MS.length;
  return Math.min(
    Math.round(lastConfigured * 2 ** extraExponent),
    READY_GATE_REALTIME_RECONNECT_MAX_DELAY_MS,
  );
}

export function isReadyGateRealtimeFailureStatus(status: ReadyGateRealtimeStatus): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

export function readyGateRealtimeDegradedReason(status: ReadyGateRealtimeStatus): string {
  switch (status) {
    case "CHANNEL_ERROR":
      return "channel_error";
    case "TIMED_OUT":
      return "channel_timed_out";
    case "CLOSED":
      return "channel_closed";
    default:
      return "realtime_degraded";
  }
}

export function createReadyGateRealtimeSupervisor(
  options: ReadyGateRealtimeSupervisorOptions,
): ReadyGateRealtimeSupervisor {
  let disposed = false;
  let degraded = false;
  const degradedSources = new Set<string>();
  let resubscribeAttempt = 0;
  let resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  const nowMs = options.nowMs ?? Date.now;

  const clearResubscribeTimer = () => {
    if (!resubscribeTimer) return;
    clearTimeout(resubscribeTimer);
    resubscribeTimer = null;
  };

  const baseContext = (
    source: string,
    status?: ReadyGateRealtimeStatus | null,
    extra?: Partial<ReadyGateRealtimeSupervisorContext>,
  ): ReadyGateRealtimeSupervisorContext => ({
    sessionId: options.sessionId,
    eventId: options.eventId ?? null,
    platform: options.platform,
    sourceSurface: options.sourceSurface,
    source,
    status: status ?? null,
    ...extra,
  });

  const emit = (
    eventName: ReadyGateRealtimeTelemetryName,
    context: ReadyGateRealtimeSupervisorContext,
    extra?: Record<string, unknown>,
  ) => {
    options.emitTelemetry?.(eventName, {
      platform: context.platform,
      session_id: context.sessionId,
      event_id: context.eventId,
      source_surface: context.sourceSurface,
      source: context.source,
      status: context.status ?? null,
      reason: context.reason ?? null,
      attempt: context.attempt ?? null,
      delay_ms: context.delayMs ?? null,
      error: context.error ?? null,
      emitted_at_ms: nowMs(),
      ...extra,
    });
  };

  const setDegraded = (next: boolean, context: ReadyGateRealtimeSupervisorContext) => {
    if (degraded === next) {
      return;
    }

    degraded = next;
    options.onDegradedChange?.(next, context);
    emit(
      next ? READY_GATE_REALTIME_TELEMETRY.DEGRADED : READY_GATE_REALTIME_TELEMETRY.RECOVERED,
      context,
    );
  };

  const fetchCanonicalSnapshot = (context: ReadyGateRealtimeSupervisorContext) => {
    if (!options.fetchCanonicalSnapshot) return;
    void options.fetchCanonicalSnapshot(context).catch(() => undefined);
  };

  const handleStatus = (source: string, status: ReadyGateRealtimeStatus, error?: unknown) => {
    if (disposed) return;

    if (status === "SUBSCRIBED") {
      const sourceWasDegraded = degradedSources.delete(source);
      const wasRecovering = sourceWasDegraded || degraded || resubscribeAttempt > 0;
      const context = baseContext(source, status, {
        reason: wasRecovering ? "reconnected" : "subscribed",
      });
      fetchCanonicalSnapshot(context);
      if (degradedSources.size > 0) return;

      clearResubscribeTimer();
      resubscribeAttempt = 0;
      setDegraded(false, context);
      return;
    }

    if (!isReadyGateRealtimeFailureStatus(status)) return;
    degradedSources.add(source);
    if (resubscribeTimer) return;

    const attempt = resubscribeAttempt + 1;
    const delayMs = getReadyGateRealtimeReconnectDelayMs(attempt);
    resubscribeAttempt = attempt;
    const context = baseContext(source, status, {
      reason: readyGateRealtimeDegradedReason(status),
      attempt,
      delayMs,
      error: error instanceof Error ? error.message : error == null ? null : String(error),
    });
    setDegraded(true, context);

    resubscribeTimer = setTimeout(() => {
      resubscribeTimer = null;
      if (disposed) return;
      options.onResubscribe(context);
    }, delayMs);
  };

  const clearSource: ReadyGateRealtimeSupervisor["clearSource"] = (
    source,
    reason = "source_inactive",
  ) => {
    if (disposed) return;
    const sourceWasDegraded = degradedSources.delete(source);
    if (!sourceWasDegraded) return;
    const context = baseContext(source, null, { reason });
    if (degradedSources.size > 0) return;

    clearResubscribeTimer();
    resubscribeAttempt = 0;
    if (degraded) {
      degraded = false;
      options.onDegradedChange?.(false, context);
    }
  };

  const recordSnapshotGapRecovered: ReadyGateRealtimeSupervisor["recordSnapshotGapRecovered"] = (input) => {
    if (disposed) return;
    const context = baseContext(input.source, null, {
      reason: "sequence_gap_recovered",
    });
    emit(READY_GATE_REALTIME_TELEMETRY.SNAPSHOT_GAP_RECOVERED, context, {
      target_seq: input.targetSeq,
      expected_seq: input.expectedSeq ?? null,
      snapshot_seq: input.snapshotSeq ?? null,
    });
  };

  return {
    handleStatus,
    clearSource,
    recordSnapshotGapRecovered,
    isDegraded: () => degraded || degradedSources.size > 0,
    dispose: () => {
      disposed = true;
      degradedSources.clear();
      clearResubscribeTimer();
    },
  };
}
