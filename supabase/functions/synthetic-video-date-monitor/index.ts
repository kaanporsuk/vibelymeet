import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type MonitorRequest = {
  mode?: "status";
  event_id?: string | null;
};

type SyntheticHealthRow = {
  event_id: string;
  title: string | null;
  status: string | null;
  event_date: string | null;
  registration_count: number | string | null;
  session_count: number | string | null;
  active_session_count: number | string | null;
  stuck_over_2m_count: number | string | null;
  last_session_started_at: string | null;
};

type SessionHealthRow = {
  session_id: string;
  event_id: string | null;
  participant_1_id: string | null;
  participant_2_id: string | null;
  state: string | null;
  phase: string | null;
  ready_gate_status: string | null;
  daily_room_name: string | null;
  active_stuck_over_2m: boolean | null;
  active_age_seconds: number | null;
};

type Phase2ProbeResult = {
  probe: "daily_webhook" | "orphan_cleanup_dry_run";
  ok: boolean;
  status: number | null;
  reason: string | null;
  latency_ms: number;
  mode?: string;
  result?: unknown;
};

type DailyWebhookProbeTarget = {
  sessionId: string;
  roomName: string;
  actorId: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function parseBody(req: Request): Promise<MonitorRequest> {
  if (req.method === "GET") return {};
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as Partial<MonitorRequest>;
    return {
      mode: parsed.mode === "status" ? "status" : "status",
      event_id: typeof parsed.event_id === "string" && parsed.event_id.trim() ? parsed.event_id.trim() : null,
    };
  } catch {
    return {};
  }
}

function toInt(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function functionsBaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hmacSha256Base64(secretBytes: Uint8Array, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64(signature);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function dailyWebhookProbeTarget(sessionRows: SessionHealthRow[]): DailyWebhookProbeTarget | null {
  for (const row of sessionRows) {
    if (!row.daily_room_name || !row.participant_1_id) continue;
    if (row.state === "ended" || row.phase === "ended") continue;
    return {
      sessionId: row.session_id,
      roomName: row.daily_room_name,
      actorId: row.participant_1_id,
    };
  }
  return null;
}

function webhookProbeOk(
  response: Response,
  payload: Record<string, unknown>,
  target: DailyWebhookProbeTarget | null,
): boolean {
  if (!response.ok || payload.ok !== true) return false;
  const result = typeof payload.result === "string" ? payload.result : "";
  if (!target) return true;
  return result.endsWith("_join_reconciled") ||
    result === "ignored_feature_disabled" ||
    result === "ignored_terminal_session";
}

async function probeDailyWebhookPath(
  supabaseUrl: string,
  target: DailyWebhookProbeTarget | null,
): Promise<Phase2ProbeResult> {
  const startedAt = Date.now();
  const secret = Deno.env.get("DAILY_WEBHOOK_SECRET")?.trim();
  if (!secret) {
    return {
      probe: "daily_webhook",
      ok: false,
      status: null,
      reason: "daily_webhook_secret_missing",
      latency_ms: Date.now() - startedAt,
    };
  }
  const secretBytes = base64ToBytes(secret);
  if (!secretBytes) {
    return {
      probe: "daily_webhook",
      ok: false,
      status: null,
      reason: "daily_webhook_secret_invalid",
      latency_ms: Date.now() - startedAt,
    };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    id: `synthetic-video-date-monitor-${crypto.randomUUID()}`,
    type: "participant.joined",
    room_name: target?.roomName ?? "date-00000000000000000000000000000000",
    participant: {
      id: "synthetic-monitor",
      user_id: target?.actorId ?? "00000000-0000-4000-8000-000000000000",
    },
    timestamp: Number(timestamp),
  });
  const correctSignature = await hmacSha256Base64(secretBytes, `${timestamp}.${rawBody}`);

  try {
    const response = await fetch(`${functionsBaseUrl(supabaseUrl)}/video-date-daily-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": correctSignature,
      },
      body: rawBody,
    });
    const payload = await readJsonResponse(response);
    const ok = webhookProbeOk(response, payload, target);
    const result = typeof payload.result === "string" ? payload.result : null;
    return {
      probe: "daily_webhook",
      ok,
      status: response.status,
      reason: ok
        ? null
        : typeof payload.error === "string"
          ? payload.error
          : "daily_webhook_probe_failed",
      latency_ms: Date.now() - startedAt,
      mode: target
        ? result?.endsWith("_join_reconciled")
          ? "synthetic_session_reconciled"
          : "synthetic_session_guarded"
        : "endpoint_only_no_synthetic_room",
      result,
    };
  } catch (error) {
    return {
      probe: "daily_webhook",
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message.slice(0, 120) : "daily_webhook_probe_exception",
      latency_ms: Date.now() - startedAt,
    };
  }
}

async function probeOrphanCleanupDryRun(supabaseUrl: string, cronSecret: string): Promise<Phase2ProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${functionsBaseUrl(supabaseUrl)}/video-date-orphan-room-cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        source: "synthetic_video_date_monitor",
        dry_run: true,
        batch_size: 1,
        max_pages: 1,
      }),
    });
    const payload = await readJsonResponse(response);
    return {
      probe: "orphan_cleanup_dry_run",
      ok: response.ok && payload.ok !== false,
      status: response.status,
      reason: response.ok ? null : typeof payload.error === "string" ? payload.error : "orphan_cleanup_probe_failed",
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      probe: "orphan_cleanup_dry_run",
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message.slice(0, 120) : "orphan_cleanup_probe_exception",
      latency_ms: Date.now() - startedAt,
    };
  }
}

async function runPhase2PathProbes(
  supabaseUrl: string,
  cronSecret: string,
  webhookTarget: DailyWebhookProbeTarget | null,
): Promise<Phase2ProbeResult[]> {
  return Promise.all([
    probeDailyWebhookPath(supabaseUrl, webhookTarget),
    probeOrphanCleanupDryRun(supabaseUrl, cronSecret),
  ]);
}

function authOk(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  return safeEqual(authHeader, `Bearer ${cronSecret}`) || safeEqual(cronHeader, cronSecret);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!authOk(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const startedAt = Date.now();
  const body = await parseBody(req);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: "missing_supabase_env" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";

  const healthQuery = supabase
    .from("vw_synthetic_video_date_health")
    .select(
      "event_id,title,status,event_date,registration_count,session_count,active_session_count,stuck_over_2m_count,last_session_started_at",
    )
    .order("event_date", { ascending: true })
    .limit(10);

  const { data: rawHealthRows, error: healthError } = body.event_id
    ? await healthQuery.eq("event_id", body.event_id)
    : await healthQuery;

  if (healthError) {
    await supabase.rpc("record_event_loop_observability", {
      p_operation: "synthetic_video_date_monitor",
      p_outcome: "failure",
      p_reason_code: "health_view_error",
      p_latency_ms: Date.now() - startedAt,
      p_event_id: null,
      p_actor_id: null,
      p_session_id: null,
      p_detail: { error: healthError.message },
    });
    return jsonResponse({ ok: false, error: healthError.message }, 500);
  }

  const healthRows = (rawHealthRows ?? []) as SyntheticHealthRow[];
  const selected = healthRows[0] ?? null;
  const requestedEventId = body.event_id ?? null;
  const selectedEventId = selected?.event_id ?? null;

  const [sessionsResult, funnelResult, flagsResult] = await Promise.all([
    selectedEventId
      ? supabase
          .from("vw_session_health")
          .select("session_id,event_id,participant_1_id,participant_2_id,state,phase,ready_gate_status,daily_room_name,active_stuck_over_2m,active_age_seconds")
          .eq("event_id", selectedEventId)
          .order("last_state_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("vw_session_funnel")
      .select("*")
      .eq("is_test_event", true)
      .order("bucket_utc", { ascending: false })
      .limit(24),
    supabase
      .from("vw_video_date_flag_rollout")
      .select("flag_key,enabled,kill_switch_active,rollout_bps")
      .order("flag_key", { ascending: true }),
  ]);

  const sessionRows = ((sessionsResult.data ?? []) as SessionHealthRow[]).filter(Boolean);
  const stuckSessions = sessionRows.filter((row) => row.active_stuck_over_2m === true);
  const registrationCount = toInt(selected?.registration_count);
  const webhookTarget = dailyWebhookProbeTarget(sessionRows);
  const phase2Probes = await runPhase2PathProbes(supabaseUrl, cronSecret, webhookTarget);
  const failedPhase2Probes = phase2Probes.filter((probe) => !probe.ok);
  const dashboardErrors = [
    sessionsResult.error?.message,
    funnelResult.error?.message,
    flagsResult.error?.message,
  ].filter((message): message is string => typeof message === "string" && message.length > 0);
  const stuckCount = Math.max(toInt(selected?.stuck_over_2m_count), stuckSessions.length);

  const reasonCode = dashboardErrors.length > 0
    ? "dashboard_view_error"
    : failedPhase2Probes.length > 0
      ? "phase2_path_probe_failed"
    : !selected
    ? "no_test_event"
    : registrationCount < 2
    ? "synthetic_fixture_underprovisioned"
    : stuckCount > 0
        ? "stuck_session_detected"
        : "healthy";
  const outcome = reasonCode === "healthy"
    ? "success"
    : reasonCode === "stuck_session_detected" ||
        reasonCode === "dashboard_view_error" ||
        reasonCode === "phase2_path_probe_failed"
      ? "failure"
      : "blocked";

  await supabase.rpc("record_event_loop_observability", {
    p_operation: "synthetic_video_date_monitor",
    p_outcome: outcome,
    p_reason_code: reasonCode,
    p_latency_ms: Date.now() - startedAt,
    p_event_id: selectedEventId,
    p_actor_id: null,
    p_session_id: stuckSessions[0]?.session_id ?? null,
    p_detail: {
      mode: body.mode ?? "status",
      requested_event_id: requestedEventId,
      selected_event_id: selectedEventId,
      synthetic_event_count: healthRows.length,
      registration_count: registrationCount,
      session_count: toInt(selected?.session_count),
      active_session_count: toInt(selected?.active_session_count),
      stuck_over_2m_count: stuckCount,
      dashboard_errors: dashboardErrors,
      sessions_error: sessionsResult.error?.message ?? null,
      funnel_error: funnelResult.error?.message ?? null,
      flags_error: flagsResult.error?.message ?? null,
      phase2_probes: phase2Probes,
    },
  });

  return jsonResponse({
    ok: outcome === "success",
    outcome,
    reason_code: reasonCode,
    selected_event_id: selectedEventId,
    health: selected,
    synthetic_events: healthRows,
    recent_sessions: sessionRows,
    funnel: funnelResult.data ?? [],
    flags: flagsResult.data ?? [],
    phase2_probes: phase2Probes,
    latency_ms: Date.now() - startedAt,
  });
});
