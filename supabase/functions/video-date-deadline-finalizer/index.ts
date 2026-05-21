import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type WorkerRequest = {
  batch_size?: number;
  lease_seconds?: number;
  dry_run?: boolean;
  source?: string;
};

type DeadlineRow = {
  id: number;
  session_id: string;
  kind: string;
  due_at: string;
  attempts: number;
  claim_expires_at: string | null;
};

// Edge workers call migration-defined RPCs before generated Supabase DB types
// know about them. Keep this service client dynamic and constrain payloads at
// the function boundary instead.
type SupabaseServiceClient = any;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function authOk(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (!cronSecret) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  return safeEqual(authHeader, `Bearer ${cronSecret}`) || safeEqual(cronHeader, cronSecret);
}

async function parseBody(req: Request): Promise<WorkerRequest> {
  if (req.method === "GET") return {};
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      batch_size: typeof parsed.batch_size === "number" ? parsed.batch_size : undefined,
      lease_seconds: typeof parsed.lease_seconds === "number" ? parsed.lease_seconds : undefined,
      dry_run: parsed.dry_run === true,
      source: typeof parsed.source === "string" ? parsed.source.slice(0, 80) : undefined,
    };
  } catch {
    return {};
  }
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

async function markDeadlineFailure(
  supabase: SupabaseServiceClient,
  workerId: string,
  row: DeadlineRow,
  reason: string,
  permanent = false,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_video_session_deadline_v2", {
    p_deadline_id: row.id,
    p_worker_id: workerId,
    p_success: false,
    p_error: reason.slice(0, 1000),
    p_retry_after_seconds: permanent ? null : 30,
    p_permanent: permanent,
  });
  if (error) {
    console.error("video-date-deadline-finalizer complete error", JSON.stringify({
      deadline_id: row.id,
      kind: row.kind,
      message: error.message,
    }));
    return false;
  }
  const payload = data as { ok?: boolean } | null;
  return payload?.ok === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!authOk(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  const startedAt = Date.now();
  const body = await parseBody(req);
  const batchSize = boundedInt(body.batch_size, 25, 1, 100);
  const leaseSeconds = boundedInt(body.lease_seconds, 60, 5, 300);
  const workerId = `video-date-deadline-${crypto.randomUUID()}`;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "missing_supabase_env" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey) as SupabaseServiceClient;

  if (body.dry_run) {
    const { data, error } = await supabase
      .from("video_session_deadlines")
      .select("id,session_id,kind,due_at,attempts,state,claim_expires_at")
      .in("state", ["pending", "claimed"])
      .order("due_at", { ascending: true })
      .limit(batchSize);
    if (error) return json({ ok: false, dry_run: true, error: error.message }, 500);
    return json({
      ok: true,
      dry_run: true,
      worker_id: workerId,
      preview_count: data?.length ?? 0,
      preview: data ?? [],
      latency_ms: Date.now() - startedAt,
    });
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_video_session_deadlines_v2", {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (claimError) return json({ ok: false, error: claimError.message }, 500);

  const rows = (claimed ?? []) as DeadlineRow[];
  let finalized = 0;
  let retried = 0;
  let permanentlyFailed = 0;
  const failures: Array<{ id: number; kind: string; reason: string }> = [];

  for (const row of rows) {
    const { data, error } = await supabase.rpc("finalize_video_session_deadline_v2", {
      p_deadline_id: row.id,
      p_worker_id: workerId,
    });

    if (error) {
      const completed = await markDeadlineFailure(supabase, workerId, row, error.message, false);
      if (!completed) failures.push({ id: row.id, kind: row.kind, reason: "completion_rpc_failed" });
      retried += 1;
      failures.push({ id: row.id, kind: row.kind, reason: error.message });
      continue;
    }

    const payload = (data ?? {}) as {
      ok?: boolean;
      state?: string;
      error?: string;
      reason?: string;
      retryAfterSeconds?: number;
    };

    if (payload.ok === true && payload.state === "done") {
      finalized += 1;
      continue;
    }

    if (payload.ok === true && payload.state === "pending") {
      retried += 1;
      failures.push({ id: row.id, kind: row.kind, reason: payload.reason ?? "deadline_requeued" });
      continue;
    }

    if (payload.state === "failed") {
      permanentlyFailed += 1;
      failures.push({ id: row.id, kind: row.kind, reason: payload.error ?? "deadline_failed" });
      continue;
    }

    const reason = payload.error ?? payload.reason ?? "deadline_finalize_failed";
    const completed = await markDeadlineFailure(supabase, workerId, row, reason, false);
    if (!completed) failures.push({ id: row.id, kind: row.kind, reason: "completion_rpc_failed" });
    retried += 1;
    failures.push({ id: row.id, kind: row.kind, reason });
  }

  console.log(JSON.stringify({
    event: "video_date_deadline_finalizer_run",
    worker_id: workerId,
    source: body.source ?? null,
    claimed: rows.length,
    finalized,
    retried,
    permanently_failed: permanentlyFailed,
    latency_ms: Date.now() - startedAt,
  }));

  return json({
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    finalized,
    retried,
    permanently_failed: permanentlyFailed,
    failures,
    latency_ms: Date.now() - startedAt,
  });
});
