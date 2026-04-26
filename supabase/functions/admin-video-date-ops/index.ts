import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  VIDEO_DATE_OPS_WINDOWS,
  classifyHigherIsBetter,
  classifyLowerIsBetter,
  safeRate,
  summarizeLatencyMs,
  summarizeQueueDrain,
  summarizeSwipeRecovery,
  type MetricStatus,
  type VideoDateOpsWindowDefinition,
} from "../_shared/admin-video-date-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ROWS = 10_000;
const SURVEY_CONVERSION_WINDOW_MS = 10 * 60 * 1000;

type SupabaseClientLike = ReturnType<typeof createClient>;

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

type QueryResult<T> = {
  rows: T[];
  error?: string;
  truncated: boolean;
};

type AdminVideoDateOpsRequest = {
  event_id?: string | null;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function parseEventId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const eventId = (body as AdminVideoDateOpsRequest).event_id;
  return typeof eventId === "string" && eventId.trim() ? eventId : null;
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
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<QueryResult<T>> {
  const { data, error } = await query;
  const rows = data ?? [];
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
      failures: 0,
      failure_rate: null,
      top_failure_reasons: [],
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

async function buildWindowMetrics(
  service: SupabaseClientLike,
  window: VideoDateOpsWindowDefinition,
  eventId: string | null,
) {
  const sinceIso = new Date(Date.now() - window.hours * 60 * 60 * 1000).toISOString();
  const [
    readyGateLatency,
    simultaneousSwipeRecovery,
    surveyToNextReadyGate,
    queueDrainFailures,
  ] = await Promise.all([
    getReadyGateLatency(service, sinceIso, eventId),
    getSwipeRecovery(service, sinceIso, eventId),
    getSurveyToNextReadyGate(service, sinceIso, eventId),
    getQueueDrainFailures(service, sinceIso, eventId),
  ]);

  return {
    id: window.id,
    label: window.label,
    hours: window.hours,
    since: sinceIso,
    ready_gate_open_to_date_join_latency: readyGateLatency,
    simultaneous_swipe_recovery: simultaneousSwipeRecovery,
    survey_to_next_ready_gate_conversion: surveyToNextReadyGate,
    queue_drain_failures: queueDrainFailures,
    timer_drift_recovered_by_server_truth: getTimerDriftExternalMetric(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, error: "Function is not configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: adminRow, error: adminError } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (adminError || !adminRow) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return jsonResponse({ ok: false, error: "Function is not configured" }, 500);
    }

    const service = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
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
    return jsonResponse({ ok: false, error: "Internal server error" }, 500);
  }
});
