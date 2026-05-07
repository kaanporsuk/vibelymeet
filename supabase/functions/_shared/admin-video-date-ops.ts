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

export type VideoDateTimelineRole = "admin";

export const VIDEO_DATE_TIMELINE_ALLOWED_ROLES = [
  "admin",
] as const satisfies readonly VideoDateTimelineRole[];

export type VideoDateSessionTimelineRow = {
  timeline_seq: number;
  occurred_at: string;
  source: string;
  operation: string;
  outcome: string;
  reason_code: string | null;
  event_id: string | null;
  actor_id: string | null;
  session_id: string;
  detail: unknown;
};

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SENSITIVE_TIMELINE_KEY_PATTERN =
  /(^|[_-])(authorization|auth|header|headers|auth_header|authorization_header|bearer|jwt|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|service[_-]?role|secret|password|supabase[_-]?service[_-]?role[_-]?key|daily[_-]?api[_-]?key|meeting[_-]?token|room[_-]?token)$/i;

const JWT_LIKE_VALUE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_SHAPE.test(value.trim());
}

export function hasVideoDateTimelineRole(
  rows: Array<{ role?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) =>
    VIDEO_DATE_TIMELINE_ALLOWED_ROLES.includes(row.role as VideoDateTimelineRole),
  );
}

function timelineSortTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

export function redactVideoDateTimelineDetail(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Max depth]";
  if (Array.isArray(value)) {
    return value.map((item) => redactVideoDateTimelineDetail(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && (JWT_LIKE_VALUE.test(value) || value.startsWith("Bearer "))) {
      return "[REDACTED]";
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
      key,
      SENSITIVE_TIMELINE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redactVideoDateTimelineDetail(innerValue, depth + 1),
    ]),
  );
}

export function safeVideoDateTimelineRows(rows: VideoDateSessionTimelineRow[]): VideoDateSessionTimelineRow[] {
  return [...rows]
    .sort((a, b) => {
      const seqA = Number.isFinite(a.timeline_seq) ? a.timeline_seq : Number.MAX_SAFE_INTEGER;
      const seqB = Number.isFinite(b.timeline_seq) ? b.timeline_seq : Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;
      return timelineSortTimestamp(a.occurred_at) - timelineSortTimestamp(b.occurred_at);
    })
    .map((row) => ({
      ...row,
      detail: redactVideoDateTimelineDetail(row.detail),
    }));
}

export function extractVideoDateTimelineTraceIds(detail: unknown): {
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
} {
  if (!detail || typeof detail !== "object") {
    return { entryAttemptId: null, videoDateTraceId: null };
  }
  const record = detail as Record<string, unknown>;
  const entryAttemptId = typeof record.entry_attempt_id === "string" ? record.entry_attempt_id : null;
  const videoDateTraceId = typeof record.video_date_trace_id === "string" ? record.video_date_trace_id : null;
  return { entryAttemptId, videoDateTraceId };
}

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

export type QueueDrainReasonCount = { reason: string; count: number };

export type QueueDrainSummary = {
  attempts: number;
  successes: number;
  no_ops: number;
  blocked: number;
  failures: number;
  failure_rate: number | null;
  non_success_rate: number | null;
  top_failure_reasons: QueueDrainReasonCount[];
  top_no_op_reasons: QueueDrainReasonCount[];
  top_blocked_reasons: QueueDrainReasonCount[];
};

export type FirstFrameDedupeInputRow = {
  session_id?: string | null;
  actor_id?: string | null;
  created_at?: string | null;
};

export const RECOVERABLE_COLLISION_REASON_CODE = "already_matched";

export const COLLISION_REASON_CODES = new Set([
  RECOVERABLE_COLLISION_REASON_CODE,
  "participant_has_active_session_conflict",
  "active_session_conflict",
]);

export const EXPECTED_QUEUE_DRAIN_NO_OP_REASON_CODES = new Set([
  "no_queued_session",
  "session_not_promotable",
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

function normalizedQueueDrainOutcome(row: QueueDrainInputRow): "success" | "no_op" | "blocked" | "failure" {
  const outcome = (row.outcome ?? "").trim().toLowerCase();
  const reason = (row.reason_code ?? "").trim().toLowerCase();
  if (outcome === "no_op" || EXPECTED_QUEUE_DRAIN_NO_OP_REASON_CODES.has(reason)) return "no_op";
  if (outcome === "success") return "success";
  if (outcome === "blocked") return "blocked";
  return "failure";
}

function countQueueDrainReasons(rows: QueueDrainInputRow[]): QueueDrainReasonCount[] {
  const reasonCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const reason = row.reason_code || "unknown";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 5);
}

export function summarizeQueueDrain(rows: QueueDrainInputRow[]): QueueDrainSummary {
  const successRows = rows.filter((row) => normalizedQueueDrainOutcome(row) === "success");
  const noOpRows = rows.filter((row) => normalizedQueueDrainOutcome(row) === "no_op");
  const blockedRows = rows.filter((row) => normalizedQueueDrainOutcome(row) === "blocked");
  const failureRows = rows.filter((row) => normalizedQueueDrainOutcome(row) === "failure");
  const nonSuccessCount = noOpRows.length + blockedRows.length + failureRows.length;

  return {
    attempts: rows.length,
    successes: successRows.length,
    no_ops: noOpRows.length,
    blocked: blockedRows.length,
    failures: failureRows.length,
    failure_rate: safeRate(failureRows.length, rows.length),
    non_success_rate: safeRate(nonSuccessCount, rows.length),
    top_failure_reasons: countQueueDrainReasons(failureRows),
    top_no_op_reasons: countQueueDrainReasons(noOpRows),
    top_blocked_reasons: countQueueDrainReasons(blockedRows),
  };
}

function firstFrameDedupeTime(row: FirstFrameDedupeInputRow): number {
  const time = new Date(row.created_at ?? "").getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

export function dedupeEarliestRowsBySessionActor<T extends FirstFrameDedupeInputRow>(rows: T[]): T[] {
  const keyedRows = new Map<string, { row: T; index: number; time: number }>();
  const unkeyedRows: Array<{ row: T; index: number; time: number }> = [];

  rows.forEach((row, index) => {
    const time = firstFrameDedupeTime(row);
    if (!row.session_id || !row.actor_id) {
      unkeyedRows.push({ row, index, time });
      return;
    }

    const key = `${row.session_id}:${row.actor_id}`;
    const existing = keyedRows.get(key);
    if (!existing || time < existing.time || (time === existing.time && index < existing.index)) {
      keyedRows.set(key, { row, index, time });
    }
  });

  return [...keyedRows.values(), ...unkeyedRows]
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((entry) => entry.row);
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
