import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  adminJsonResponse,
  authenticateAdminRequest,
  sanitizeErrorMessage,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";
import {
  VIDEO_DATE_OPS_WINDOWS,
  classifyHigherIsBetter,
  classifyLowerIsBetter,
  dedupeEarliestRowsBySessionActor,
  hasVideoDateTimelineRole,
  isValidUuid,
  percentile,
  safeVideoDateTimelineRows,
  safeRate,
  summarizeLatencyMs,
  summarizeSwipeRecovery,
  type MetricStatus,
  type VideoDateSessionTimelineRow,
  type VideoDateOpsWindowDefinition,
} from "../_shared/admin-video-date-ops.ts";

const MAX_ROWS = 10_000;
const PUSH_PROVIDER_FAILURE_STATUSES = new Set(["failed", "bounced"]);
const SLOW_LAUNCH_SESSION_LIMIT = 20;
const SLOW_LAUNCH_TIMELINE_SESSION_LIMIT = 5;
const SLOW_LAUNCH_TIMELINE_ROW_LIMIT = 12;
const SPRINT7_OPS_HEALTH_RPC_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(15_000, Number(Deno.env.get("VIDEO_DATE_OPS_HEALTH_RPC_TIMEOUT_MS") ?? 4_500) || 4_500),
);

type SupabaseErrorLike = { message: string };
type SupabaseRowsResult = { data: unknown[] | null; error: SupabaseErrorLike | null };
type SupabaseSingleResult = { data: unknown | null; error: SupabaseErrorLike | null };
type SupabaseRpcResult = { data: unknown; error: SupabaseErrorLike | null };

type SupabaseQueryLike = PromiseLike<SupabaseRowsResult> & {
  eq(column: string, value: unknown): SupabaseQueryLike;
  gte(column: string, value: unknown): SupabaseQueryLike;
  in(column: string, values: readonly unknown[]): SupabaseQueryLike;
  is(column: string, value: unknown): SupabaseQueryLike;
  not(column: string, operator: string, value: unknown): SupabaseQueryLike;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): SupabaseQueryLike;
  limit(count: number): SupabaseQueryLike;
  maybeSingle(): PromiseLike<SupabaseSingleResult>;
};

type SupabaseFromBuilderLike = {
  select(columns: string): SupabaseQueryLike;
};

type SupabaseClientLike = {
  from(table: string): SupabaseFromBuilderLike;
  rpc(functionName: string, args?: Record<string, unknown>): PromiseLike<SupabaseRpcResult>;
};

type TimedRpcResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true; sourceError: string };

type EventLoopRow = {
  created_at: string;
  event_id: string | null;
  actor_id?: string | null;
  session_id: string | null;
  operation?: string | null;
  outcome: string | null;
  reason_code: string | null;
};

type VideoSessionRow = {
  id: string;
  event_id: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
};

type DailyPerformanceDecisionRow = {
  window_id: string | null;
  window_label: string | null;
  event_id: string | null;
  first_frame_sample_count: number | null;
  first_frame_p95_ms: number | null;
  first_frame_p99_ms: number | null;
  room_sample_count: number | null;
  room_p95_ms: number | null;
  room_p99_ms: number | null;
  token_sample_count: number | null;
  token_p95_ms: number | null;
  token_p99_ms: number | null;
  join_sample_count: number | null;
  join_p95_ms: number | null;
  join_p99_ms: number | null;
  reconnect_sample_count: number | null;
  reconnect_p95_ms: number | null;
  extension_refresh_sample_count: number | null;
  extension_refresh_p95_ms: number | null;
  room_pool_recommended: boolean | null;
  decision_reason: string | null;
  decision_status: MetricStatus | "insufficient_data" | null;
};

type DailyPerformanceEmissionHealthRow = {
  window_id: string | null;
  window_label: string | null;
  event_id: string | null;
  segment_key: string | null;
  segment_label: string | null;
  sample_count: number | null;
  success_count: number | null;
  failure_count: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  last_sample_at: string | null;
  minimum_samples: number | null;
  blocks_rollout_gate: boolean | null;
  emission_status: string | null;
  missing_for_rollout_gate: boolean | null;
};

type Sprint7SafetyPrivacyOpsHealthPayload = {
  ok: boolean;
  generated_at: string | null;
  event_id: string | null;
  privacy_contract: Record<string, unknown> | null;
  windows: Record<string, unknown>[];
  source_error?: string;
};

type ProviderOutboxNotificationRow = {
  session_id?: string | null;
  kind?: string | null;
  state?: string | null;
  attempts?: number | null;
  next_attempt_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
};

type ProviderFailureLogRow = {
  target_kind?: string | null;
  session_id?: string | null;
  provider?: string | null;
  operation?: string | null;
  error_code?: string | null;
  permanent?: boolean | null;
  lease_lost?: boolean | null;
  created_at?: string | null;
};

type ProviderDeadLetterRow = {
  target_kind?: string | null;
  session_id?: string | null;
  provider?: string | null;
  operation?: string | null;
  reason?: string | null;
  created_at?: string | null;
};

type NotificationLogHealthRow = {
  category?: string | null;
  delivered?: boolean | null;
  suppressed_reason?: string | null;
  created_at?: string | null;
  data?: unknown;
};

type PushNotificationTelemetryRow = {
  status?: string | null;
  platform?: string | null;
  error_code?: string | null;
  created_at?: string | null;
};

type LaunchLatencyCheckpointRow = {
  created_at?: string | null;
  latency_ms: number | null;
  event_id: string | null;
  actor_id?: string | null;
  session_id?: string | null;
  reason_code?: string | null;
  detail?: Record<string, unknown> | null;
};

type SegmentLatencySummary = {
  key: string;
  label: string;
  sample_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
};

type CohortLatencySummary = SegmentLatencySummary & {
  dimensions: Record<string, string>;
};

type SlowLaunchSessionSummary = {
  session_id: string | null;
  actor_id: string | null;
  event_id: string | null;
  occurred_at: string | null;
  latency_ms: number | null;
  platform: string;
  daily_prewarm: string;
  timeline_rows?: VideoDateSessionTimelineRow[];
  timeline_error?: string;
};

const LAUNCH_SEGMENT_KEYS = [
  ["prepare_entry_ms", "Prepare entry"],
  ["provider_verify_ms", "Provider verify"],
  ["permission_check_ms", "Permission check"],
  ["date_route_bootstrap_ms", "Date route bootstrap"],
  ["daily_join_ms", "Daily join"],
  ["daily_join_to_first_remote_frame_ms", "Join -> first frame"],
  ["both_ready_to_first_remote_frame_ms", "Both ready -> first frame"],
] as const;

const VIDEO_DATE_NOTIFICATION_CATEGORIES = [
  "ready_gate",
  "partner_ready",
  "date_starting",
  "reconnection",
  "date_reminder",
  "post_date_feedback_reminder",
] as const;

type QueryResult<T> = {
  rows: T[];
  error?: string;
  truncated: boolean;
};

type AdminVideoDateOpsRequest = {
  action?: string | null;
  event_id?: string | null;
  session_id?: string | null;
};

const jsonResponse = (req: Request, body: unknown, status = 200) =>
  adminJsonResponse(req, body, status);

const typedErrorResponse = (req: Request, code: string, message: string, status: number) =>
  jsonResponse(req, { ok: false, code, error: message }, status);

async function withOpsTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  sourceError: string,
): Promise<TimedRpcResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise).then((value) => ({ timedOut: false as const, value })),
      new Promise<TimedRpcResult<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ timedOut: true, sourceError }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}

function parseEventId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const eventId = (body as AdminVideoDateOpsRequest).event_id;
  return typeof eventId === "string" && eventId.trim() ? eventId : null;
}

function parseSessionId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const sessionId = (body as AdminVideoDateOpsRequest).session_id;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

function parseAction(body: unknown): "metrics" | "get_session_timeline" {
  if (!body || typeof body !== "object") return "metrics";
  return (body as AdminVideoDateOpsRequest).action === "get_session_timeline"
    ? "get_session_timeline"
    : "metrics";
}

function isReadyGateOpen(row: EventLoopRow): boolean {
  return (
    row.operation === "handle_swipe" &&
    row.outcome === "success" &&
    row.reason_code === "match_immediate"
  );
}

function firstJoinedAtMs(session: VideoSessionRow): number | null {
  const joined = [session.participant_1_joined_at, session.participant_2_joined_at]
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  return joined.length ? Math.min(...joined) : null;
}

async function fetchRows<T>(
  query: PromiseLike<SupabaseRowsResult>,
): Promise<QueryResult<T>> {
  const { data, error } = await query;
  const rows = (data ?? []) as T[];
  return {
    rows,
    error: error ? sanitizeErrorMessage(error.message) : undefined,
    truncated: rows.length >= MAX_ROWS,
  };
}

async function fetchByIds<T>(
  service: SupabaseClientLike,
  table: string,
  select: string,
  ids: string[],
): Promise<QueryResult<T>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 500) {
    chunks.push(uniqueIds.slice(i, i + 500));
  }

  const allRows: T[] = [];
  for (const chunk of chunks) {
    const { data, error } = await service.from(table).select(select).in("id", chunk).limit(MAX_ROWS);
    if (error) return { rows: allRows, error: sanitizeErrorMessage(error.message), truncated: allRows.length >= MAX_ROWS };
    allRows.push(...((data ?? []) as T[]));
    if (allRows.length >= MAX_ROWS) break;
  }

  return { rows: allRows.slice(0, MAX_ROWS), truncated: allRows.length >= MAX_ROWS };
}

async function fetchRowsForSessionIds<T>(
  service: SupabaseClientLike,
  table: string,
  select: string,
  sessionIds: string[],
  configureQuery: (query: SupabaseQueryLike) => SupabaseQueryLike,
): Promise<QueryResult<T>> {
  const uniqueIds = Array.from(new Set(sessionIds.filter(Boolean)));
  const allRows: T[] = [];

  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500);
    const { data, error } = await configureQuery(
      service.from(table).select(select).in("session_id", chunk),
    ).limit(MAX_ROWS);
    if (error) {
      return {
        rows: allRows.slice(0, MAX_ROWS),
        error: sanitizeErrorMessage(error.message),
        truncated: allRows.length >= MAX_ROWS,
      };
    }
    allRows.push(...((data ?? []) as T[]));
    if (allRows.length >= MAX_ROWS) break;
  }

  return { rows: allRows.slice(0, MAX_ROWS), truncated: allRows.length >= MAX_ROWS };
}

function emptyRows<T>(): QueryResult<T> {
  return { rows: [], truncated: false };
}

function combineSourceErrors(...results: Array<QueryResult<unknown> | null | undefined>): string | undefined {
  const errors = results.map((result) => result?.error).filter((error): error is string => Boolean(error));
  return errors.length ? errors.join(";") : undefined;
}

function topStringCounts<T>(
  rows: T[],
  selector: (row: T) => string | null | undefined,
  fallback = "unknown",
  limit = 6,
) {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const raw = selector(row);
    const key = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

async function getEventSessionIds(
  service: SupabaseClientLike,
  eventId: string | null,
): Promise<QueryResult<{ id: string }>> {
  if (!eventId) return emptyRows();
  return fetchRows<{ id: string }>(
    service
      .from("video_sessions")
      .select("id")
      .eq("event_id", eventId)
      .order("started_at", { ascending: false })
      .limit(MAX_ROWS),
  );
}

async function getReadyGateLatency(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  let query = service
    .from("event_loop_observability_events")
    .select("created_at,event_id,session_id,operation,outcome,reason_code")
    .gte("created_at", sinceIso)
    .eq("operation", "handle_swipe")
    .not("session_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);

  if (eventId) query = query.eq("event_id", eventId);

  const readyRows = await fetchRows<EventLoopRow>(query);
  if (readyRows.error) {
    return {
      sample_count: 0,
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
      status: "unknown" as MetricStatus,
      source_error: readyRows.error,
      truncated: readyRows.truncated,
    };
  }

  const earliestOpenBySession = new Map<string, EventLoopRow>();
  readyRows.rows.filter(isReadyGateOpen).forEach((row) => {
    if (!row.session_id) return;
    const existing = earliestOpenBySession.get(row.session_id);
    if (!existing || new Date(row.created_at).getTime() < new Date(existing.created_at).getTime()) {
      earliestOpenBySession.set(row.session_id, row);
    }
  });

  const sessions = await fetchByIds<VideoSessionRow>(
    service,
    "video_sessions",
    "id,event_id,participant_1_joined_at,participant_2_joined_at",
    Array.from(earliestOpenBySession.keys()),
  );

  if (sessions.error) {
    return {
      sample_count: 0,
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
      status: "unknown" as MetricStatus,
      source_error: sessions.error,
      truncated: readyRows.truncated || sessions.truncated,
    };
  }

  const latencies = sessions.rows.flatMap((session) => {
    const openRow = earliestOpenBySession.get(session.id);
    const joinedAt = firstJoinedAtMs(session);
    if (!openRow || joinedAt === null) return [];
    const latencyMs = joinedAt - new Date(openRow.created_at).getTime();
    return latencyMs >= 0 ? [latencyMs] : [];
  });

  const summary = summarizeLatencyMs(latencies);
  return {
    ...summary,
    status: classifyLowerIsBetter(summary.p95_ms, 10_000, 20_000),
    truncated: readyRows.truncated || sessions.truncated,
  };
}

function numericDetailMs(detail: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function detailBoolLabel(detail: Record<string, unknown> | null | undefined, key: string): string {
  const value = detail?.[key];
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

function detailStringLabel(detail: Record<string, unknown> | null | undefined, key: string): string {
  const value = detail?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function summarizeSegment(key: string, label: string, values: number[]): SegmentLatencySummary {
  return {
    key,
    label,
    ...summarizeLatencyMs(values),
  };
}

function prewarmLookupKey(row: Pick<LaunchLatencyCheckpointRow, "session_id" | "actor_id">): string | null {
  if (!row.session_id || !row.actor_id) return null;
  return `${row.session_id}:${row.actor_id}`;
}

async function fetchSlowLaunchTimelineRows(
  service: SupabaseClientLike,
  sessionId: string,
): Promise<{ rows: VideoDateSessionTimelineRow[]; error?: string }> {
  const { data, error } = await service.rpc("get_video_date_session_timeline", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("admin-video-date-ops slow launch timeline rpc:", sanitizeErrorMessage(error.message));
    return { rows: [], error: "timeline_unavailable" };
  }

  return {
    rows: safeVideoDateTimelineRows((data ?? []) as VideoDateSessionTimelineRow[])
      .slice(-SLOW_LAUNCH_TIMELINE_ROW_LIMIT),
  };
}

async function attachSlowLaunchTimelines(
  service: SupabaseClientLike,
  sessions: SlowLaunchSessionSummary[],
): Promise<SlowLaunchSessionSummary[]> {
  const sessionIds = Array.from(
    new Set(
      sessions
        .slice(0, SLOW_LAUNCH_TIMELINE_SESSION_LIMIT)
        .flatMap((session) => session.session_id ? [session.session_id] : []),
    ),
  );
  const timelineEntries = await Promise.all(
    sessionIds.map(async (sessionId) => [sessionId, await fetchSlowLaunchTimelineRows(service, sessionId)] as const),
  );
  const timelineBySession = new Map(timelineEntries);

  return sessions.map((session) => {
    if (!session.session_id) return session;
    const timeline = timelineBySession.get(session.session_id);
    if (!timeline) return session;
    return {
      ...session,
      timeline_rows: timeline.rows,
      ...(timeline.error ? { timeline_error: timeline.error } : {}),
    };
  });
}

async function getReadyTapToFirstRemoteFrameLatency(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  let allCheckpointQuery = service
    .from("event_loop_observability_events")
    .select("created_at,latency_ms,event_id,actor_id,session_id,reason_code,detail")
    .gte("created_at", sinceIso)
    .eq("operation", "video_date_launch_latency_checkpoint")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (eventId) allCheckpointQuery = allCheckpointQuery.eq("event_id", eventId);

  const result = await fetchRows<LaunchLatencyCheckpointRow>(allCheckpointQuery);
  if (result.error) {
    return {
      sample_count: 0,
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
      raw_sample_count: 0,
      segment_breakdown: [] as SegmentLatencySummary[],
      cohort_breakdown: [] as CohortLatencySummary[],
      slowest_sessions: [] as SlowLaunchSessionSummary[],
      status: "unknown" as MetricStatus,
      source_error: result.error,
      truncated: result.truncated,
    };
  }

  const prewarmOutcomeByActorSession = new Map<string, string>();
  for (const row of result.rows) {
    const key = prewarmLookupKey(row);
    if (!key) continue;
    if (row.reason_code === "daily_prewarm_consumed") {
      prewarmOutcomeByActorSession.set(key, "consumed");
    } else if (row.reason_code === "daily_prewarm_fallback" && prewarmOutcomeByActorSession.get(key) !== "consumed") {
      prewarmOutcomeByActorSession.set(key, "fallback");
    }
  }

  const rawFirstFrameRows = result.rows.filter((row) => row.reason_code === "first_remote_frame");
  const firstFrameRows = dedupeEarliestRowsBySessionActor(rawFirstFrameRows);

  const latencies = firstFrameRows.flatMap((row) => {
    const latencyMs =
      typeof row.latency_ms === "number" && Number.isFinite(row.latency_ms) && row.latency_ms >= 0
        ? Math.round(row.latency_ms)
        : numericDetailMs(row.detail, "ready_tap_to_first_remote_frame_ms");
    return latencyMs === null ? [] : [latencyMs];
  });

  const segmentBreakdown = LAUNCH_SEGMENT_KEYS.map(([key, label]) =>
    summarizeSegment(
      key,
      label,
      firstFrameRows.flatMap((row) => {
        const value = numericDetailMs(row.detail, key);
        return value == null ? [] : [value];
      }),
    )
  );

  const cohortValues = new Map<string, { dimensions: Record<string, string>; values: number[] }>();
  for (const row of firstFrameRows) {
    const latencyMs =
      typeof row.latency_ms === "number" && Number.isFinite(row.latency_ms) && row.latency_ms >= 0
        ? Math.round(row.latency_ms)
        : numericDetailMs(row.detail, "ready_tap_to_first_remote_frame_ms");
    if (latencyMs == null) continue;
    const prewarmKey = prewarmLookupKey(row);
    const prewarmOutcome = prewarmKey
      ? prewarmOutcomeByActorSession.get(prewarmKey) ?? "none"
      : "unknown";
    const dimensions = {
      platform: detailStringLabel(row.detail, "platform"),
      cached_prepare_entry: detailBoolLabel(row.detail, "cached_prepare_entry"),
      provider_verify_skipped: detailBoolLabel(row.detail, "provider_verify_skipped"),
      permission_handoff_used: detailBoolLabel(row.detail, "permission_handoff_used"),
      daily_prewarm: prewarmOutcome,
    };
    const key = Object.entries(dimensions).map(([name, value]) => `${name}:${value}`).join("|");
    const existing = cohortValues.get(key) ?? { dimensions, values: [] as number[] };
    existing.values.push(latencyMs);
    cohortValues.set(key, existing);
  }

  const cohortBreakdown = Array.from(cohortValues.entries())
    .map(([key, entry]) => ({
      ...summarizeSegment(key, key, entry.values),
      dimensions: entry.dimensions,
    }))
    .sort((a, b) => (b.p95_ms ?? -1) - (a.p95_ms ?? -1))
    .slice(0, 12);

  const slowestSessionsWithoutTimelines = firstFrameRows
    .map((row) => {
      const latencyMs =
        typeof row.latency_ms === "number" && Number.isFinite(row.latency_ms) && row.latency_ms >= 0
          ? Math.round(row.latency_ms)
          : numericDetailMs(row.detail, "ready_tap_to_first_remote_frame_ms");
      const prewarmKey = prewarmLookupKey(row);
      return {
        session_id: row.session_id ?? null,
        actor_id: row.actor_id ?? null,
        event_id: row.event_id ?? null,
        occurred_at: row.created_at ?? null,
        latency_ms: latencyMs,
        platform: detailStringLabel(row.detail, "platform"),
        daily_prewarm: prewarmKey
          ? prewarmOutcomeByActorSession.get(prewarmKey) ?? "none"
          : "unknown",
      };
    })
    .filter((row) => typeof row.latency_ms === "number")
    .sort((a, b) => Number(b.latency_ms) - Number(a.latency_ms))
    .slice(0, SLOW_LAUNCH_SESSION_LIMIT);
  const slowestSessions = await attachSlowLaunchTimelines(service, slowestSessionsWithoutTimelines);

  const summary = summarizeLatencyMs(latencies);
  return {
    ...summary,
    raw_sample_count: rawFirstFrameRows.length,
    segment_breakdown: segmentBreakdown,
    cohort_breakdown: cohortBreakdown,
    slowest_sessions: slowestSessions,
    status: classifyLowerIsBetter(summary.p95_ms, 8_000, 15_000),
    truncated: result.truncated,
  };
}

async function getSwipeRecovery(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  let query = service
    .from("v_event_loop_swipe_mutual_events")
    .select("reason_code,session_id")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (eventId) query = query.eq("event_id", eventId);

  const result = await fetchRows<{ reason_code: string | null; session_id: string | null }>(query);
  if (result.error) {
    return {
      total_swipe_rows: 0,
      collision_rows: 0,
      recovered_rows: 0,
      unrecovered_rows: 0,
      collision_rate: null,
      recovery_rate: null,
      collision_status: "unknown" as MetricStatus,
      recovery_status: "unknown" as MetricStatus,
      source_error: result.error,
      truncated: result.truncated,
    };
  }

  const summary = summarizeSwipeRecovery(result.rows);
  return {
    ...summary,
    collision_status: classifyLowerIsBetter(summary.collision_rate, 0.03, 0.08),
    recovery_status: classifyHigherIsBetter(summary.recovery_rate, 0.7, 0.4),
    truncated: result.truncated,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSprint7OpsStatus(value: unknown): MetricStatus {
  return value === "healthy" || value === "warning" || value === "critical"
    ? value
    : "unknown";
}

async function getNotificationOutboxHealth(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  const sessionLookup = await getEventSessionIds(service, eventId);
  const eventSessionIds = eventId
    ? sessionLookup.rows.map((row) => row.id).filter(Boolean)
    : null;
  const sessionFilterUnavailable = Boolean(eventId && sessionLookup.error);
  const sessionFilterTruncated = Boolean(eventId && sessionLookup.truncated);
  const nowMs = Date.now();
  const staleThresholdMs = 5 * 60 * 1000;

  let providerOutbox: QueryResult<ProviderOutboxNotificationRow> = emptyRows();
  let providerFailures: QueryResult<ProviderFailureLogRow> = emptyRows();
  let providerDeadLetters: QueryResult<ProviderDeadLetterRow> = emptyRows();

  if (eventId && eventSessionIds?.length) {
    [providerOutbox, providerFailures, providerDeadLetters] = await Promise.all([
      fetchRowsForSessionIds<ProviderOutboxNotificationRow>(
        service,
        "video_date_provider_outbox",
        "session_id,kind,state,attempts,next_attempt_at,created_at,updated_at,last_error",
        eventSessionIds,
        (query) =>
          query
            .gte("created_at", sinceIso)
            .in("kind", ["notification.send"])
            .order("created_at", { ascending: false }),
      ),
      fetchRowsForSessionIds<ProviderFailureLogRow>(
        service,
        "video_date_provider_outbox_failure_log",
        "target_kind,session_id,provider,operation,error_code,permanent,lease_lost,created_at",
        eventSessionIds,
        (query) =>
          query
            .gte("created_at", sinceIso)
            .in("target_kind", ["outbox", "provider"])
            .order("created_at", { ascending: false }),
      ),
      fetchRowsForSessionIds<ProviderDeadLetterRow>(
        service,
        "video_date_provider_dead_letters",
        "target_kind,session_id,provider,operation,reason,created_at",
        eventSessionIds,
        (query) =>
          query
            .gte("created_at", sinceIso)
            .in("target_kind", ["outbox", "provider"])
            .order("created_at", { ascending: false }),
      ),
    ]);
  } else if (!eventId) {
    const outboxQuery = service
      .from("video_date_provider_outbox")
      .select("session_id,kind,state,attempts,next_attempt_at,created_at,updated_at,last_error")
      .gte("created_at", sinceIso)
      .in("kind", ["notification.send"])
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    const failureQuery = service
      .from("video_date_provider_outbox_failure_log")
      .select("target_kind,session_id,provider,operation,error_code,permanent,lease_lost,created_at")
      .gte("created_at", sinceIso)
      .in("target_kind", ["outbox", "provider"])
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    const deadLetterQuery = service
      .from("video_date_provider_dead_letters")
      .select("target_kind,session_id,provider,operation,reason,created_at")
      .gte("created_at", sinceIso)
      .in("target_kind", ["outbox", "provider"])
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    [providerOutbox, providerFailures, providerDeadLetters] = await Promise.all([
      fetchRows<ProviderOutboxNotificationRow>(outboxQuery),
      fetchRows<ProviderFailureLogRow>(failureQuery),
      fetchRows<ProviderDeadLetterRow>(deadLetterQuery),
    ]);
  }

  let notificationLogQuery = service
    .from("notification_log")
    .select("category,delivered,suppressed_reason,created_at,data")
    .gte("created_at", sinceIso)
    .in("category", VIDEO_DATE_NOTIFICATION_CATEGORIES)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (eventId) notificationLogQuery = notificationLogQuery.eq("data->>event_id", eventId);

  const [notificationLog, pushTelemetry] = await Promise.all([
    fetchRows<NotificationLogHealthRow>(notificationLogQuery),
    fetchRows<PushNotificationTelemetryRow>(
      service
        .from("push_notification_events")
        .select("status,platform,error_code,created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
    ),
  ]);

  const outboxPending = providerOutbox.rows.filter((row) => row.state === "pending").length;
  const outboxClaimed = providerOutbox.rows.filter((row) => row.state === "claimed").length;
  const outboxDone = providerOutbox.rows.filter((row) => row.state === "done").length;
  const outboxFailed = providerOutbox.rows.filter((row) => row.state === "failed").length;
  const staleActiveRows = providerOutbox.rows.filter((row) => {
    if (row.state !== "pending" && row.state !== "claimed") return false;
    const nextAttemptMs = typeof row.next_attempt_at === "string" ? new Date(row.next_attempt_at).getTime() : NaN;
    const updatedMs = typeof row.updated_at === "string" ? new Date(row.updated_at).getTime() : NaN;
    const markerMs = Number.isFinite(nextAttemptMs) ? nextAttemptMs : updatedMs;
    return Number.isFinite(markerMs) && nowMs - markerMs > staleThresholdMs;
  }).length;
  const maxAttempts = providerOutbox.rows.reduce((max, row) => Math.max(max, Number(row.attempts ?? 0)), 0);

  const appLogRows = notificationLog.rows.length;
  const appDelivered = notificationLog.rows.filter((row) => row.delivered === true).length;
  const appSuppressed = notificationLog.rows.filter((row) => typeof row.suppressed_reason === "string" && row.suppressed_reason.length > 0).length;
  const appProviderErrors = notificationLog.rows.filter((row) => {
    const reason = row.suppressed_reason ?? "";
    return /error|failed|provider|onesignal/i.test(reason);
  }).length;

  const pushFailed = pushTelemetry.rows.filter((row) => {
    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    return PUSH_PROVIDER_FAILURE_STATUSES.has(status) || Boolean(row.error_code);
  }).length;
  const pushTelemetryAffectsStatus = !eventId;
  const failurePermanent = providerFailures.rows.filter((row) => row.permanent === true).length;
  const deadLetterCount = providerDeadLetters.rows.length;
  const sourceError = combineSourceErrors(
    sessionLookup,
    providerOutbox,
    providerFailures,
    providerDeadLetters,
    notificationLog,
    pushTelemetry,
  );
  const status: MetricStatus = sourceError || sessionFilterUnavailable || sessionFilterTruncated
    ? "unknown"
    : deadLetterCount > 0 || outboxFailed > 0 || failurePermanent > 0
      ? "critical"
      : staleActiveRows > 0 || providerFailures.rows.length > 0 || appProviderErrors > 0 || (pushTelemetryAffectsStatus && pushFailed > 0)
        ? "warning"
        : "healthy";

  return {
    status,
    source: "admin-video-date-ops",
    event_id: eventId,
    since: sinceIso,
    ...(sourceError ? { source_error: sourceError } : {}),
    event_session_filter: eventId
      ? {
          session_count: eventSessionIds?.length ?? 0,
          truncated: sessionFilterTruncated,
          unavailable: sessionFilterUnavailable,
        }
      : null,
    app_notification_log: {
      source: "notification_log",
      event_filter_applied: Boolean(eventId),
      rows: appLogRows,
      delivered: appDelivered,
      suppressed: appSuppressed,
      provider_error_like_rows: appProviderErrors,
      delivery_rate: safeRate(appDelivered, appLogRows),
      top_categories: topStringCounts(notificationLog.rows, (row) => row.category),
      top_suppressed_reasons: topStringCounts(
        notificationLog.rows.filter((row) => Boolean(row.suppressed_reason)),
        (row) => row.suppressed_reason,
      ),
      truncated: notificationLog.truncated,
    },
    video_date_provider_outbox: {
      source: "video_date_provider_outbox",
      kind_filter: ["notification.send"],
      rows: providerOutbox.rows.length,
      pending: outboxPending,
      claimed: outboxClaimed,
      done: outboxDone,
      failed: outboxFailed,
      stale_active_rows: staleActiveRows,
      max_attempts: maxAttempts,
      top_last_errors: topStringCounts(
        providerOutbox.rows.filter((row) => Boolean(row.last_error)),
        (row) => row.last_error,
      ),
      truncated: providerOutbox.truncated,
    },
    provider_failure_log: {
      source: "video_date_provider_outbox_failure_log",
      rows: providerFailures.rows.length,
      permanent: failurePermanent,
      lease_lost: providerFailures.rows.filter((row) => row.lease_lost === true).length,
      top_operations: topStringCounts(providerFailures.rows, (row) => row.operation),
      top_error_codes: topStringCounts(providerFailures.rows, (row) => row.error_code),
      truncated: providerFailures.truncated,
    },
    provider_dead_letters: {
      source: "video_date_provider_dead_letters",
      rows: deadLetterCount,
      top_reasons: topStringCounts(providerDeadLetters.rows, (row) => row.reason),
      truncated: providerDeadLetters.truncated,
    },
    push_provider_telemetry: {
      source: "push_notification_events",
      note: "Provider/webhook telemetry is not authoritative for transactional send-notification rows unless production webhook correlation is confirmed.",
      event_filter_supported: false,
      status_affects_window: pushTelemetryAffectsStatus,
      rows: pushTelemetry.rows.length,
      failed: pushFailed,
      top_statuses: topStringCounts(pushTelemetry.rows, (row) => row.status),
      sent_or_delivered: pushTelemetry.rows.filter((row) =>
        row.status === "sent" || row.status === "delivered" || row.status === "opened" || row.status === "clicked"
      ).length,
      opened_or_clicked: pushTelemetry.rows.filter((row) => row.status === "opened" || row.status === "clicked").length,
      top_platforms: topStringCounts(pushTelemetry.rows, (row) => row.platform),
      top_error_codes: topStringCounts(
        pushTelemetry.rows.filter((row) => Boolean(row.error_code)),
        (row) => row.error_code,
      ),
      truncated: pushTelemetry.truncated,
    },
  };
}

function getTimerDriftExternalMetric() {
  return {
    status: "external_only" as MetricStatus,
    source: "posthog",
    event_name: "video_date_timer_drift_recovered_by_server_truth",
    count: null,
    rate: null,
    note:
      "Timer drift recovery is emitted to PostHog and is not stored in Supabase. Use the PostHog event trend for exact counts.",
  };
}

function emptyDailyPerformanceDecision(
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
  sourceError?: string,
) {
  return {
    window_id: window.id,
    window_label: window.label,
    event_id: eventId,
    first_frame_sample_count: 0,
    first_frame_p95_ms: null,
    first_frame_p99_ms: null,
    room_sample_count: 0,
    room_p95_ms: null,
    room_p99_ms: null,
    token_sample_count: 0,
    token_p95_ms: null,
    token_p99_ms: null,
    join_sample_count: 0,
    join_p95_ms: null,
    join_p99_ms: null,
    reconnect_sample_count: 0,
    reconnect_p95_ms: null,
    extension_refresh_sample_count: 0,
    extension_refresh_p95_ms: null,
    room_pool_recommended: false,
    decision_reason: sourceError ? "source_unavailable" : "no_samples",
    decision_status: "unknown" as MetricStatus,
    ...(sourceError ? { source_error: sourceError } : {}),
  };
}

async function getDailyPerformanceDecision(
  service: SupabaseClientLike,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
) {
  let query = service
    .from("vw_video_date_daily_pool_decision")
    .select(
      "window_id,window_label,event_id,first_frame_sample_count,first_frame_p95_ms,first_frame_p99_ms,room_sample_count,room_p95_ms,room_p99_ms,token_sample_count,token_p95_ms,token_p99_ms,join_sample_count,join_p95_ms,join_p99_ms,reconnect_sample_count,reconnect_p95_ms,extension_refresh_sample_count,extension_refresh_p95_ms,room_pool_recommended,decision_reason,decision_status",
    )
    .eq("window_id", window.id)
    .order("event_id", { ascending: true, nullsFirst: true })
    .limit(1);

  if (eventId) query = query.eq("event_id", eventId);

  const result = await fetchRows<DailyPerformanceDecisionRow>(query);
  if (result.error) {
    return emptyDailyPerformanceDecision(window, eventId, result.error);
  }

  const row = result.rows[0];
  if (!row) return emptyDailyPerformanceDecision(window, eventId);

  return {
    window_id: row.window_id ?? window.id,
    window_label: row.window_label ?? window.label,
    event_id: row.event_id ?? eventId,
    first_frame_sample_count: Number(row.first_frame_sample_count ?? 0),
    first_frame_p95_ms: row.first_frame_p95_ms ?? null,
    first_frame_p99_ms: row.first_frame_p99_ms ?? null,
    room_sample_count: Number(row.room_sample_count ?? 0),
    room_p95_ms: row.room_p95_ms ?? null,
    room_p99_ms: row.room_p99_ms ?? null,
    token_sample_count: Number(row.token_sample_count ?? 0),
    token_p95_ms: row.token_p95_ms ?? null,
    token_p99_ms: row.token_p99_ms ?? null,
    join_sample_count: Number(row.join_sample_count ?? 0),
    join_p95_ms: row.join_p95_ms ?? null,
    join_p99_ms: row.join_p99_ms ?? null,
    reconnect_sample_count: Number(row.reconnect_sample_count ?? 0),
    reconnect_p95_ms: row.reconnect_p95_ms ?? null,
    extension_refresh_sample_count: Number(row.extension_refresh_sample_count ?? 0),
    extension_refresh_p95_ms: row.extension_refresh_p95_ms ?? null,
    room_pool_recommended: row.room_pool_recommended === true,
    decision_reason: row.decision_reason ?? "unknown",
    decision_status:
      row.decision_status === "healthy" ||
      row.decision_status === "warning" ||
      row.decision_status === "critical" ||
      row.decision_status === "unknown"
        ? row.decision_status
        : "unknown",
    truncated: result.truncated,
  };
}

async function getDailyPerformanceEmissionHealth(
  service: SupabaseClientLike,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
) {
  let query = service
    .from("vw_video_date_daily_performance_emission_health")
    .select(
      "window_id,window_label,event_id,segment_key,segment_label,sample_count,success_count,failure_count,p95_ms,p99_ms,last_sample_at,minimum_samples,blocks_rollout_gate,emission_status,missing_for_rollout_gate",
    )
    .eq("window_id", window.id)
    .in("segment_key", ["daily_join", "first_remote_frame"])
    .order("segment_key", { ascending: true })
    .limit(4);

  query = eventId ? query.eq("event_id", eventId) : query.is("event_id", null);

  const result = await fetchRows<DailyPerformanceEmissionHealthRow>(query);
  if (result.error) {
    return {
      missing_for_rollout_gate_count: 0,
      segments: [] as DailyPerformanceEmissionHealthRow[],
      status: "unknown" as MetricStatus,
      source_error: result.error,
      truncated: result.truncated,
    };
  }

  if (result.rows.length === 0) {
    return {
      missing_for_rollout_gate_count: 2,
      segments: [] as DailyPerformanceEmissionHealthRow[],
      status: "critical" as MetricStatus,
      truncated: result.truncated,
    };
  }

  const missing = result.rows.filter((row) => row.missing_for_rollout_gate === true);
  const staleOrDark = result.rows.filter((row) => row.emission_status === "dark" || row.emission_status === "stale");
  return {
    missing_for_rollout_gate_count: missing.length,
    segments: result.rows,
    status: missing.length > 0 ? "critical" as MetricStatus : staleOrDark.length > 0 ? "warning" as MetricStatus : "healthy" as MetricStatus,
    truncated: result.truncated,
  };
}

const SPRINT7_PRIVACY_CONTRACT_FALLBACK = {
  scope: "service_role_only",
  payload_shape: "counts_enum_reasons_and_operational_ids_only",
  excludes: [
    "daily_tokens",
    "provider_secrets",
    "auth_headers",
    "profile_text",
    "profile_names",
    "emails",
    "phone_numbers",
    "media_urls",
    "freeform_report_details",
  ],
} as const;

function emptySprint7SafetyPrivacyOpsHealth(
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
  sourceError?: string,
) {
  return {
    window_id: window.id,
    window_label: window.label,
    event_id: eventId,
    status: "unknown" as MetricStatus,
    source: "get_video_date_sprint7_ops_health",
    generated_at: null,
    privacy_contract: SPRINT7_PRIVACY_CONTRACT_FALLBACK,
    stuck_ready_gate_count: 0,
    stuck_entry_count: 0,
    overdue_date_count: 0,
    pending_survey_recovery_count: 0,
    prepare_entry_failure_count: 0,
    daily_join_failure_count: 0,
    client_stuck_observed_count: 0,
    report_count: 0,
    pending_report_count: 0,
    report_with_block_count: 0,
    block_count: 0,
    webhook_dlq_count: 0,
    unresolved_webhook_dlq_count: 0,
    retryable_webhook_dlq_count: 0,
    webhook_dlq_error_classes: {},
    orphan_room_cleanup_rows: 0,
    orphan_room_cleanup_failed_count: 0,
    orphan_room_destructive_candidate_count: 0,
    orphan_room_safety_interlock_skip_count: 0,
    ...(sourceError ? { source_error: sourceError } : {}),
  };
}

async function getSprint7SafetyPrivacyOpsHealthPayload(
  service: SupabaseClientLike,
  eventId: string | null,
): Promise<Sprint7SafetyPrivacyOpsHealthPayload> {
  const rpcResult = await withOpsTimeout(
    service.rpc("get_video_date_sprint7_ops_health", {
      p_event_id: eventId,
    }),
    SPRINT7_OPS_HEALTH_RPC_TIMEOUT_MS,
    "sprint7_ops_health_timeout",
  );

  if (rpcResult.timedOut) {
    return {
      ok: false,
      generated_at: null,
      event_id: eventId,
      privacy_contract: null,
      windows: [],
      source_error: rpcResult.sourceError,
    };
  }

  const { data, error } = rpcResult.value;

  if (error) {
    return {
      ok: false,
      generated_at: null,
      event_id: eventId,
      privacy_contract: null,
      windows: [],
      source_error: sanitizeErrorMessage(error.message),
    };
  }

  if (!isRecord(data)) {
    return {
      ok: false,
      generated_at: null,
      event_id: eventId,
      privacy_contract: null,
      windows: [],
      source_error: "invalid_sprint7_ops_health_payload",
    };
  }

  const windows = Array.isArray(data.windows)
    ? data.windows.filter(isRecord)
    : [];

  return {
    ok: data.ok === true,
    generated_at: typeof data.generated_at === "string" ? data.generated_at : null,
    event_id: typeof data.event_id === "string" ? data.event_id : eventId,
    privacy_contract: isRecord(data.privacy_contract) ? data.privacy_contract : null,
    windows,
    ...(data.ok === true ? {} : { source_error: "sprint7_ops_health_not_ok" }),
  };
}

function selectSprint7SafetyPrivacyOpsHealth(
  payload: Sprint7SafetyPrivacyOpsHealthPayload,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
) {
  const base = emptySprint7SafetyPrivacyOpsHealth(window, eventId, payload.source_error);
  if (payload.source_error) return base;

  const row = payload.windows.find((candidate) => candidate.window_id === window.id);
  if (!row) {
    return emptySprint7SafetyPrivacyOpsHealth(
      window,
      eventId,
      "sprint7_ops_health_window_missing",
    );
  }

  return {
    ...base,
    ...row,
    window_id: window.id,
    window_label: typeof row.window_label === "string" ? row.window_label : window.label,
    event_id: typeof row.event_id === "string" ? row.event_id : eventId,
    status: normalizeSprint7OpsStatus(row.status),
    source: "get_video_date_sprint7_ops_health",
    generated_at: payload.generated_at,
    privacy_contract: payload.privacy_contract ?? SPRINT7_PRIVACY_CONTRACT_FALLBACK,
  };
}

async function buildWindowMetrics(
  service: SupabaseClientLike,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
  sprint7SafetyPrivacyOpsHealthPayload: Sprint7SafetyPrivacyOpsHealthPayload,
) {
  const sinceIso = new Date(Date.now() - window.hours * 60 * 60 * 1000).toISOString();
  const [
    readyTapToFirstRemoteFrame,
    readyGateLatency,
    simultaneousSwipeRecovery,
    dailyPerformanceDecision,
    dailyPerformanceEmissionHealth,
    notificationOutboxHealth,
  ] = await Promise.all([
    getReadyTapToFirstRemoteFrameLatency(service, sinceIso, eventId),
    getReadyGateLatency(service, sinceIso, eventId),
    getSwipeRecovery(service, sinceIso, eventId),
    getDailyPerformanceDecision(service, window, eventId),
    getDailyPerformanceEmissionHealth(service, window, eventId),
    getNotificationOutboxHealth(service, sinceIso, eventId),
  ]);

  return {
    id: window.id,
    label: window.label,
    hours: window.hours,
    since: sinceIso,
    ready_tap_to_first_remote_frame_latency: readyTapToFirstRemoteFrame,
    ready_gate_open_to_date_join_latency: readyGateLatency,
    simultaneous_swipe_recovery: simultaneousSwipeRecovery,
    daily_performance_decision: dailyPerformanceDecision,
    daily_performance_emission_health: dailyPerformanceEmissionHealth,
    notification_outbox_health: notificationOutboxHealth,
    safety_privacy_ops_health: selectSprint7SafetyPrivacyOpsHealth(
      sprint7SafetyPrivacyOpsHealthPayload,
      window,
      eventId,
    ),
    timer_drift_recovered_by_server_truth: getTimerDriftExternalMetric(),
  };
}

async function getSessionTimeline(service: SupabaseClientLike, sessionId: string) {
  const { data: sessionRow, error: sessionError } = await service
    .from("video_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("admin-video-date-ops timeline session lookup:", sanitizeErrorMessage(sessionError.message));
    return { ok: false as const, status: 500, code: "internal_error", error: "Timeline lookup failed" };
  }

  if (!sessionRow) {
    return { ok: false as const, status: 404, code: "not_found", error: "Video session not found" };
  }

  const { data, error } = await service.rpc("get_video_date_session_timeline", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("admin-video-date-ops timeline rpc:", sanitizeErrorMessage(error.message));
    return { ok: false as const, status: 500, code: "internal_error", error: "Timeline unavailable" };
  }

  return {
    ok: true as const,
    rows: safeVideoDateTimelineRows((data ?? []) as VideoDateSessionTimelineRow[]),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return typedErrorResponse(req, "origin_not_allowed", "Origin not allowed", 403);
  }

  if (req.method !== "POST") {
    return typedErrorResponse(req, "method_not_allowed", "Method not allowed", 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = parseAction(body);

    const auth = await authenticateAdminRequest(req, { requireAdmin: false });
    if (!auth.ok) {
      return typedErrorResponse(req, auth.code.toLowerCase(), auth.message, auth.status);
    }

    const roleRows = auth.context.roles.map((role) => ({ role }));
    const hasAccess = action === "get_session_timeline"
      ? hasVideoDateTimelineRole(roleRows)
      : auth.context.isAdmin;

    if (!hasAccess) {
      return typedErrorResponse(req, "forbidden", "Forbidden", 403);
    }

    const service = auth.context.adminClient as unknown as SupabaseClientLike;

    if (action === "get_session_timeline") {
      const sessionId = parseSessionId(body);
      if (!isValidUuid(sessionId)) {
        return typedErrorResponse(req, "invalid_session_id", "A valid video session UUID is required", 400);
      }

      const timeline = await getSessionTimeline(service, sessionId);
      if (!timeline.ok) {
        return typedErrorResponse(req, timeline.code, timeline.error, timeline.status);
      }

      return jsonResponse(req, {
        ok: true,
        generated_at: new Date().toISOString(),
        session_id: sessionId,
        rows: timeline.rows,
      });
    }

    const eventId = parseEventId(body);
    const sprint7SafetyPrivacyOpsHealth = await getSprint7SafetyPrivacyOpsHealthPayload(service, eventId);

    const windows = await Promise.all(
      VIDEO_DATE_OPS_WINDOWS.map((window) =>
        buildWindowMetrics(service, window, eventId, sprint7SafetyPrivacyOpsHealth),
      ),
    );

    return jsonResponse(req, {
      ok: true,
      generated_at: new Date().toISOString(),
      event_id: eventId,
      windows,
    });
  } catch (error) {
    console.error("admin-video-date-ops:", sanitizeErrorMessage(error));
    return typedErrorResponse(req, "internal_error", "Internal server error", 500);
  }
});
