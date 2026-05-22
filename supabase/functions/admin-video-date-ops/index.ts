import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
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
  summarizeQueueDrain,
  summarizeSwipeRecovery,
  type MetricStatus,
  type VideoDateSessionTimelineRow,
  type VideoDateOpsWindowDefinition,
} from "../_shared/admin-video-date-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ROWS = 10_000;
const SURVEY_CONVERSION_WINDOW_MS = 10 * 60 * 1000;
const SLOW_LAUNCH_SESSION_LIMIT = 20;
const SLOW_LAUNCH_TIMELINE_SESSION_LIMIT = 5;
const SLOW_LAUNCH_TIMELINE_ROW_LIMIT = 12;

type SupabaseErrorLike = { message: string };
type SupabaseRowsResult = { data: unknown[] | null; error: SupabaseErrorLike | null };
type SupabaseSingleResult = { data: unknown | null; error: SupabaseErrorLike | null };
type SupabaseRpcResult = { data: unknown; error: SupabaseErrorLike | null };

type SupabaseQueryLike = PromiseLike<SupabaseRowsResult> & {
  eq(column: string, value: unknown): SupabaseQueryLike;
  gte(column: string, value: unknown): SupabaseQueryLike;
  in(column: string, values: readonly unknown[]): SupabaseQueryLike;
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

type FeedbackRow = {
  created_at: string;
  session_id: string | null;
  user_id: string | null;
};

type QueueDrainRow = {
  outcome: string | null;
  reason_code: string | null;
};

type QueueFairnessHealthRow = {
  event_id: string | null;
  queued_session_count: number | null;
  queued_participant_slots: number | null;
  oldest_wait_seconds: number | null;
  p95_wait_seconds: number | null;
  starved_slots_120s: number | null;
  starved_slots_300s: number | null;
  both_hot_ready_slots: number | null;
  not_both_hot_ready_slots: number | null;
  reliability_penalized_slots: number | null;
  max_candidate_score: number | null;
  avg_candidate_score: number | null;
  actor_platform_slots: Record<string, number> | null;
  actor_gender_slots: Record<string, number> | null;
  drain_attempts_15m: number | null;
  drain_successes_15m: number | null;
  no_match_attempts_15m: number | null;
  runtime_blocked_attempts_15m: number | null;
  fairness_status: MetricStatus | null;
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
  ["room_warmup_ms", "Room warmup"],
  ["prepare_entry_ms", "Prepare entry"],
  ["provider_verify_ms", "Provider verify"],
  ["permission_check_ms", "Permission check"],
  ["date_route_bootstrap_ms", "Date route bootstrap"],
  ["daily_join_ms", "Daily join"],
  ["daily_join_to_first_remote_frame_ms", "Join -> first frame"],
  ["both_ready_to_first_remote_frame_ms", "Both ready -> first frame"],
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const typedErrorResponse = (code: string, message: string, status: number) =>
  jsonResponse({ ok: false, code, error: message }, status);

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
    (row.operation === "handle_swipe" &&
      row.outcome === "success" &&
      row.reason_code === "match_immediate") ||
    (row.operation === "promote_ready_gate_if_eligible" && row.outcome === "success")
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
    error: error?.message,
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
    if (error) return { rows: allRows, error: error.message, truncated: allRows.length >= MAX_ROWS };
    allRows.push(...((data ?? []) as T[]));
    if (allRows.length >= MAX_ROWS) break;
  }

  return { rows: allRows.slice(0, MAX_ROWS), truncated: allRows.length >= MAX_ROWS };
}

async function fetchFeedbackRowsForSessions(
  service: SupabaseClientLike,
  sessionIds: string[],
  sinceIso: string,
): Promise<QueryResult<FeedbackRow>> {
  const uniqueIds = Array.from(new Set(sessionIds.filter(Boolean)));
  const allRows: FeedbackRow[] = [];

  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500);
    const { data, error } = await service
      .from("date_feedback")
      .select("created_at,session_id,user_id")
      .gte("created_at", sinceIso)
      .in("session_id", chunk)
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);

    if (error) return { rows: allRows, error: error.message, truncated: allRows.length >= MAX_ROWS };
    allRows.push(...((data ?? []) as FeedbackRow[]));
    if (allRows.length >= MAX_ROWS) break;
  }

  return { rows: allRows.slice(0, MAX_ROWS), truncated: allRows.length >= MAX_ROWS };
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
    .in("operation", ["handle_swipe", "promote_ready_gate_if_eligible"])
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
    console.error("admin-video-date-ops slow launch timeline rpc:", error.message);
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

async function getSurveyToNextReadyGate(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  const eventSessions = eventId
    ? await fetchRows<Pick<VideoSessionRow, "id" | "event_id">>(
        service
          .from("video_sessions")
          .select("id,event_id")
          .eq("event_id", eventId)
          .order("started_at", { ascending: false })
          .limit(MAX_ROWS),
      )
    : null;

  if (eventSessions?.error) {
    return {
      surveys: 0,
      next_ready_gate_opens: 0,
      conversion_rate: null,
      status: "unknown" as MetricStatus,
      source_error: eventSessions.error,
      truncated: eventSessions.truncated,
    };
  }

  const feedbackResult = eventSessions
    ? await fetchFeedbackRowsForSessions(
        service,
        eventSessions.rows.map((session) => session.id),
        sinceIso,
      )
    : await fetchRows<FeedbackRow>(
        service
          .from("date_feedback")
          .select("created_at,session_id,user_id")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .limit(MAX_ROWS),
      );

  if (feedbackResult.error) {
    return {
      surveys: 0,
      next_ready_gate_opens: 0,
      conversion_rate: null,
      status: "unknown" as MetricStatus,
      source_error: feedbackResult.error,
      truncated: feedbackResult.truncated,
    };
  }

  const sessionLookup = eventSessions ?? await fetchByIds<Pick<VideoSessionRow, "id" | "event_id">>(
    service,
    "video_sessions",
    "id,event_id",
    feedbackResult.rows.map((row) => row.session_id ?? ""),
  );

  if (sessionLookup.error) {
    return {
      surveys: 0,
      next_ready_gate_opens: 0,
      conversion_rate: null,
      status: "unknown" as MetricStatus,
      source_error: sessionLookup.error,
      truncated: feedbackResult.truncated || sessionLookup.truncated,
    };
  }

  const eventBySession = new Map(sessionLookup.rows.map((session) => [session.id, session.event_id]));
  const surveys = feedbackResult.rows
    .map((row) => ({
      createdAtMs: new Date(row.created_at).getTime(),
      eventId: row.session_id ? eventBySession.get(row.session_id) ?? null : null,
      userId: row.user_id,
    }))
    .filter((row) => row.eventId && row.userId && Number.isFinite(row.createdAtMs))
    .filter((row) => !eventId || row.eventId === eventId);

  let readyQuery = service
    .from("event_loop_observability_events")
    .select("created_at,event_id,actor_id,session_id,operation,outcome,reason_code")
    .gte("created_at", sinceIso)
    .in("operation", ["handle_swipe", "promote_ready_gate_if_eligible"])
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);

  if (eventId) readyQuery = readyQuery.eq("event_id", eventId);

  const readyResult = await fetchRows<EventLoopRow>(readyQuery);
  if (readyResult.error) {
    return {
      surveys: surveys.length,
      next_ready_gate_opens: 0,
      conversion_rate: null,
      status: "unknown" as MetricStatus,
      source_error: readyResult.error,
      truncated: feedbackResult.truncated || sessionLookup.truncated || readyResult.truncated,
    };
  }

  const readyRows = readyResult.rows
    .filter(isReadyGateOpen)
    .map((row) => ({
      createdAtMs: new Date(row.created_at).getTime(),
      eventId: row.event_id,
      actorId: row.actor_id,
    }))
    .filter((row) => row.eventId && row.actorId && Number.isFinite(row.createdAtMs));

  const conversions = surveys.filter((survey) =>
    readyRows.some(
      (ready) =>
        ready.eventId === survey.eventId &&
        ready.actorId === survey.userId &&
        ready.createdAtMs >= survey.createdAtMs &&
        ready.createdAtMs <= survey.createdAtMs + SURVEY_CONVERSION_WINDOW_MS,
    ),
  ).length;

  const conversionRate = safeRate(conversions, surveys.length);
  return {
    surveys: surveys.length,
    next_ready_gate_opens: conversions,
    conversion_rate: conversionRate,
    status: classifyHigherIsBetter(conversionRate, 0.35, 0.2),
    truncated: feedbackResult.truncated || sessionLookup.truncated || readyResult.truncated,
  };
}

async function getQueueDrainFailures(
  service: SupabaseClientLike,
  sinceIso: string,
  eventId: string | null,
) {
  let query = service
    .from("v_event_loop_observability_metric_streams")
    .select("outcome,reason_code")
    .gte("created_at", sinceIso)
    .eq("metric_stream", "drain_rpc_outer")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (eventId) query = query.eq("event_id", eventId);

  const result = await fetchRows<QueueDrainRow>(query);
  if (result.error) {
    return {
      attempts: 0,
      successes: 0,
      no_ops: 0,
      blocked: 0,
      failures: 0,
      failure_rate: null,
      non_success_rate: null,
      top_failure_reasons: [],
      top_no_op_reasons: [],
      top_blocked_reasons: [],
      status: "unknown" as MetricStatus,
      source_error: result.error,
      truncated: result.truncated,
    };
  }

  const summary = summarizeQueueDrain(result.rows);
  return {
    ...summary,
    status: classifyLowerIsBetter(summary.failure_rate, 0.05, 0.15),
    truncated: result.truncated,
  };
}

function worstMetricStatus(statuses: Array<MetricStatus | null | undefined>): MetricStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("unknown")) return "unknown";
  return "healthy";
}

async function getQueueFairnessHealth(
  service: SupabaseClientLike,
  eventId: string | null,
) {
  let query = service
    .from("v_video_date_queue_fairness_event_health")
    .select(
      "event_id,queued_session_count,queued_participant_slots,oldest_wait_seconds,p95_wait_seconds,starved_slots_120s,starved_slots_300s,both_hot_ready_slots,not_both_hot_ready_slots,reliability_penalized_slots,max_candidate_score,avg_candidate_score,actor_platform_slots,actor_gender_slots,drain_attempts_15m,drain_successes_15m,no_match_attempts_15m,runtime_blocked_attempts_15m,fairness_status",
    )
    .order("oldest_wait_seconds", { ascending: false })
    .limit(MAX_ROWS);

  if (eventId) query = query.eq("event_id", eventId);

  const result = await fetchRows<QueueFairnessHealthRow>(query);
  if (result.error) {
    return {
      event_count: 0,
      queued_session_count: 0,
      queued_participant_slots: 0,
      starved_slots_120s: 0,
      starved_slots_300s: 0,
      starvation_rate_120s: null,
      oldest_wait_seconds: null,
      p95_wait_seconds: null,
      both_hot_ready_slots: 0,
      not_both_hot_ready_slots: 0,
      reliability_penalized_slots: 0,
      no_match_attempts_15m: 0,
      runtime_blocked_attempts_15m: 0,
      top_events: [] as QueueFairnessHealthRow[],
      status: "unknown" as MetricStatus,
      source_error: result.error,
      truncated: result.truncated,
    };
  }

  const totals = result.rows.reduce(
    (acc, row) => {
      const queuedParticipantSlots = Number(row.queued_participant_slots ?? 0);
      acc.queued_session_count += Number(row.queued_session_count ?? 0);
      acc.queued_participant_slots += queuedParticipantSlots;
      acc.starved_slots_120s += Number(row.starved_slots_120s ?? 0);
      acc.starved_slots_300s += Number(row.starved_slots_300s ?? 0);
      acc.both_hot_ready_slots += Number(row.both_hot_ready_slots ?? 0);
      acc.not_both_hot_ready_slots += Number(row.not_both_hot_ready_slots ?? 0);
      acc.reliability_penalized_slots += Number(row.reliability_penalized_slots ?? 0);
      acc.no_match_attempts_15m += Number(row.no_match_attempts_15m ?? 0);
      acc.runtime_blocked_attempts_15m += Number(row.runtime_blocked_attempts_15m ?? 0);
      acc.oldest_wait_seconds = Math.max(acc.oldest_wait_seconds, Number(row.oldest_wait_seconds ?? 0));
      if (typeof row.p95_wait_seconds === "number" && Number.isFinite(row.p95_wait_seconds)) {
        acc.p95_wait_values.push(row.p95_wait_seconds);
      }
      if (queuedParticipantSlots > 0) acc.active_event_count += 1;
      return acc;
    },
    {
      queued_session_count: 0,
      queued_participant_slots: 0,
      starved_slots_120s: 0,
      starved_slots_300s: 0,
      both_hot_ready_slots: 0,
      not_both_hot_ready_slots: 0,
      reliability_penalized_slots: 0,
      no_match_attempts_15m: 0,
      runtime_blocked_attempts_15m: 0,
      oldest_wait_seconds: 0,
      p95_wait_values: [] as number[],
      active_event_count: 0,
    },
  );

  const starvationRate = safeRate(totals.starved_slots_120s, totals.queued_participant_slots);
  const status = worstMetricStatus(result.rows.map((row) => row.fairness_status));

  return {
    event_count: result.rows.length,
    active_event_count: totals.active_event_count,
    queued_session_count: totals.queued_session_count,
    queued_participant_slots: totals.queued_participant_slots,
    starved_slots_120s: totals.starved_slots_120s,
    starved_slots_300s: totals.starved_slots_300s,
    starvation_rate_120s: starvationRate,
    oldest_wait_seconds: totals.oldest_wait_seconds || null,
    p95_wait_seconds: percentile(totals.p95_wait_values, 0.95),
    both_hot_ready_slots: totals.both_hot_ready_slots,
    not_both_hot_ready_slots: totals.not_both_hot_ready_slots,
    reliability_penalized_slots: totals.reliability_penalized_slots,
    no_match_attempts_15m: totals.no_match_attempts_15m,
    runtime_blocked_attempts_15m: totals.runtime_blocked_attempts_15m,
    top_events: result.rows.slice(0, 8),
    status,
    truncated: result.truncated,
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

async function buildWindowMetrics(
  service: SupabaseClientLike,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
) {
  const sinceIso = new Date(Date.now() - window.hours * 60 * 60 * 1000).toISOString();
  const [
    readyTapToFirstRemoteFrame,
    readyGateLatency,
    simultaneousSwipeRecovery,
    surveyToNextReadyGate,
    queueDrainFailures,
    queueFairness,
    dailyPerformanceDecision,
  ] = await Promise.all([
    getReadyTapToFirstRemoteFrameLatency(service, sinceIso, eventId),
    getReadyGateLatency(service, sinceIso, eventId),
    getSwipeRecovery(service, sinceIso, eventId),
    getSurveyToNextReadyGate(service, sinceIso, eventId),
    getQueueDrainFailures(service, sinceIso, eventId),
    getQueueFairnessHealth(service, eventId),
    getDailyPerformanceDecision(service, window, eventId),
  ]);

  return {
    id: window.id,
    label: window.label,
    hours: window.hours,
    since: sinceIso,
    ready_tap_to_first_remote_frame_latency: readyTapToFirstRemoteFrame,
    ready_gate_open_to_date_join_latency: readyGateLatency,
    simultaneous_swipe_recovery: simultaneousSwipeRecovery,
    survey_to_next_ready_gate_conversion: surveyToNextReadyGate,
    queue_drain_failures: queueDrainFailures,
    queue_fairness: queueFairness,
    daily_performance_decision: dailyPerformanceDecision,
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
    console.error("admin-video-date-ops timeline session lookup:", sessionError.message);
    return { ok: false as const, status: 500, code: "internal_error", error: "Timeline lookup failed" };
  }

  if (!sessionRow) {
    return { ok: false as const, status: 404, code: "not_found", error: "Video session not found" };
  }

  const { data, error } = await service.rpc("get_video_date_session_timeline", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("admin-video-date-ops timeline rpc:", error.message);
    return { ok: false as const, status: 500, code: "internal_error", error: "Timeline unavailable" };
  }

  return {
    ok: true as const,
    rows: safeVideoDateTimelineRows((data ?? []) as VideoDateSessionTimelineRow[]),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return typedErrorResponse("method_not_allowed", "Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return typedErrorResponse("unauthorized", "Unauthorized", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return typedErrorResponse("internal_error", "Function is not configured", 500);
    }

    const body = await req.json().catch(() => ({}));
    const action = parseAction(body);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return typedErrorResponse("unauthorized", "Unauthorized", 401);
    }

    const allowedRoles = ["admin"];
    const { data: roleRows, error: roleError } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", allowedRoles);

    const hasAccess = action === "get_session_timeline"
      ? hasVideoDateTimelineRole(roleRows)
      : (roleRows ?? []).some((row) => row.role === "admin");

    if (roleError || !hasAccess) {
      return typedErrorResponse("forbidden", "Forbidden", 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return typedErrorResponse("internal_error", "Function is not configured", 500);
    }

    const service = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClientLike;

    if (action === "get_session_timeline") {
      const sessionId = parseSessionId(body);
      if (!isValidUuid(sessionId)) {
        return typedErrorResponse("invalid_session_id", "A valid video session UUID is required", 400);
      }

      const timeline = await getSessionTimeline(service, sessionId);
      if (!timeline.ok) {
        return typedErrorResponse(timeline.code, timeline.error, timeline.status);
      }

      return jsonResponse({
        ok: true,
        generated_at: new Date().toISOString(),
        session_id: sessionId,
        rows: timeline.rows,
      });
    }

    const eventId = parseEventId(body);

    const windows = await Promise.all(
      VIDEO_DATE_OPS_WINDOWS.map((window) => buildWindowMetrics(service, window, eventId)),
    );

    return jsonResponse({
      ok: true,
      generated_at: new Date().toISOString(),
      event_id: eventId,
      windows,
    });
  } catch (error) {
    console.error("admin-video-date-ops:", error);
    return typedErrorResponse("internal_error", "Internal server error", 500);
  }
});
