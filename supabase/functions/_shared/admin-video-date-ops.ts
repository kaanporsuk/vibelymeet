export type VideoDateOpsWindowId = "24h" | "7d";

export type VideoDateOpsWindowDefinition = {
  id: VideoDateOpsWindowId;
  label: string;
  hours: number;
};

export const VIDEO_DATE_OPS_WINDOWS = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7d", hours: 24 * 7 },
] as const satisfies readonly VideoDateOpsWindowDefinition[];

export type MetricStatus = "healthy" | "warning" | "critical" | "unknown" | "external_only";

export type LatencySummary = {
  sample_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
};

export type SwipeRecoveryInputRow = {
  reason_code?: string | null;
  session_id?: string | null;
};

export type SwipeRecoverySummary = {
  total_swipe_rows: number;
  collision_rows: number;
  recovered_rows: number;
  unrecovered_rows: number;
  collision_rate: number | null;
  recovery_rate: number | null;
};

export type QueueDrainInputRow = {
  outcome?: string | null;
  reason_code?: string | null;
};

export type QueueDrainSummary = {
  attempts: number;
  failures: number;
  failure_rate: number | null;
  top_failure_reasons: Array<{ reason: string; count: number }>;
};

export const RECOVERABLE_COLLISION_REASON_CODE = "already_matched";

export const COLLISION_REASON_CODES = new Set([
  RECOVERABLE_COLLISION_REASON_CODE,
  "participant_has_active_session_conflict",
  "active_session_conflict",
]);

export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!sorted.length) return null;
  if (p <= 0) return Math.round(sorted[0]);
  if (p >= 1) return Math.round(sorted[sorted.length - 1]);

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return Math.round(sorted[lower]);

  const weight = index - lower;
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

export function summarizeLatencyMs(values: number[]): LatencySummary {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    sample_count: usable.length,
    p50_ms: percentile(usable, 0.5),
    p95_ms: percentile(usable, 0.95),
    max_ms: percentile(usable, 1),
  };
}

export function summarizeSwipeRecovery(rows: SwipeRecoveryInputRow[]): SwipeRecoverySummary {
  const collisionRows = rows.filter((row) => COLLISION_REASON_CODES.has(row.reason_code ?? ""));
  const recoveredRows = collisionRows.filter(
    (row) => row.reason_code === RECOVERABLE_COLLISION_REASON_CODE && !!row.session_id,
  );
  const collisionCount = collisionRows.length;
  const recoveredCount = recoveredRows.length;

  return {
    total_swipe_rows: rows.length,
    collision_rows: collisionCount,
    recovered_rows: recoveredCount,
    unrecovered_rows: Math.max(0, collisionCount - recoveredCount),
    collision_rate: safeRate(collisionCount, rows.length),
    recovery_rate: safeRate(recoveredCount, collisionCount),
  };
}

export function summarizeQueueDrain(rows: QueueDrainInputRow[]): QueueDrainSummary {
  const failureRows = rows.filter((row) => row.outcome !== "success");
  const reasonCounts = failureRows.reduce<Record<string, number>>((acc, row) => {
    const reason = row.reason_code || "unknown";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  return {
    attempts: rows.length,
    failures: failureRows.length,
    failure_rate: safeRate(failureRows.length, rows.length),
    top_failure_reasons: Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 5),
  };
}

export function classifyLowerIsBetter(
  value: number | null | undefined,
  warning: number,
  critical: number,
): MetricStatus {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value >= critical) return "critical";
  if (value >= warning) return "warning";
  return "healthy";
}

export function classifyHigherIsBetter(
  value: number | null | undefined,
  warning: number,
  critical: number,
): MetricStatus {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value <= critical) return "critical";
  if (value <= warning) return "warning";
  return "healthy";
}
