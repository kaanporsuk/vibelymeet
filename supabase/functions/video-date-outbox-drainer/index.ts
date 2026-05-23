import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isDailyRoomAlreadyExistsErrorText,
  videoDateRoomNameForSession,
  videoDateRoomUrlForName,
} from "../daily-room/dailyRoomContracts.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_DOMAIN = Deno.env.get("DAILY_DOMAIN")?.trim() || "vibelyapp.daily.co";
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400;

type WorkerRequest = {
  batch_size?: number;
  lease_seconds?: number;
  dry_run?: boolean;
  source?: string;
};

type OutboxRow = {
  id: number;
  session_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  dedupe_key: string | null;
  claim_expires_at: string | null;
};

type VideoSessionRoomRow = {
  id: string;
  daily_room_name: string | null;
  daily_room_url: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
};

type ProcessResult =
  | { success: true; reason: string; permanent?: false }
  | { success: false; reason: string; retryAfterSeconds?: number; permanent?: boolean };

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

function stringField(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const PERMANENT_NOTIFICATION_SUPPRESSIONS = new Set([
  "account_paused",
  "blocked_pair",
  "forbidden",
  "invalid_notification_payload",
  "invalid_request",
  "match_muted",
  "no_player_id",
  "no_preferences",
  "paused",
  "quiet_hours",
  "suppressed_blocked_pair",
  "unknown_category",
  "user_disabled",
]);

function providerStatusFromReason(reason: string | null): number | null {
  if (!reason) return null;
  const match = reason.match(/(?:http_|status_)(\d{3})/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function notificationPayloadFailureResult(payload: Record<string, unknown> | null): ProcessResult {
  const reason =
    payload ? stringField(payload, "reason", "error", "code", "onesignal_reason") : null;
  const onesignalReason = payload ? stringField(payload, "onesignal_reason") : null;
  const status =
    typeof payload?.status === "number"
      ? payload.status
      : providerStatusFromReason(reason) ?? providerStatusFromReason(onesignalReason);
  const normalizedReason = reason?.toLowerCase() ?? "notification_payload_not_success";
  const detail = `notification_${normalizedReason}`.slice(0, 160);

  if (PERMANENT_NOTIFICATION_SUPPRESSIONS.has(normalizedReason)) {
    return { success: false, reason: detail, permanent: true };
  }

  if (normalizedReason === "onesignal_error" || normalizedReason.startsWith("onesignal_")) {
    if (status === 429) return { success: false, reason: detail, retryAfterSeconds: 60 };
    if (status != null && status >= 500) return { success: false, reason: detail, retryAfterSeconds: 30 };
    if (status != null && status >= 400) return { success: false, reason: detail, permanent: true };
    return { success: false, reason: detail, retryAfterSeconds: 60 };
  }

  return { success: false, reason: detail, retryAfterSeconds: 60 };
}

function safeProviderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

async function readProviderCode(res: Response): Promise<{
  text: string;
  providerCode: string | null;
}> {
  const text = await res.clone().text().catch(() => "");
  if (!text) return { text: "", providerCode: null };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      text,
      providerCode:
        safeProviderCode(parsed.code) ??
        safeProviderCode(parsed.error_code) ??
        safeProviderCode(parsed.error) ??
        safeProviderCode(parsed.info) ??
        safeProviderCode(parsed.message),
    };
  } catch {
    return { text, providerCode: null };
  }
}

function dailyHeaders(): HeadersInit | null {
  const dailyApiKey = Deno.env.get("DAILY_API_KEY")?.trim();
  if (!dailyApiKey) return null;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dailyApiKey}`,
  };
}

function dailyRoomProperties(): Record<string, unknown> {
  return {
    max_participants: 2,
    enable_chat: false,
    enable_screenshare: false,
    enable_recording: false,
    enable_knocking: false,
    enforce_unique_user_ids: true,
    start_video_off: false,
    start_audio_off: false,
    exp: Math.floor(Date.now() / 1000) + DAILY_VIDEO_DATE_ROOM_TTL_SECONDS,
    eject_at_room_exp: true,
  };
}

function providerRetryAfter(status: number | null): number {
  if (status === 429) return 60;
  if (status == null || status >= 500) return 30;
  return 120;
}

async function getDailyRoomState(roomName: string, retries = 2): Promise<{
  exists: boolean;
  expired: boolean;
  expiresAt: string | null;
}> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");

  const res = await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers,
  });
  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (3 - retries)));
    return getDailyRoomState(roomName, retries - 1);
  }
  if (res.status === 404) return { exists: false, expired: false, expiresAt: null };
  if (!res.ok) {
    const { providerCode } = await readProviderCode(res);
    throw new Error(`daily_lookup_failed:${res.status}:${providerCode ?? "unknown"}`);
  }

  const body = (await res.json().catch(() => null)) as { config?: { exp?: unknown } } | null;
  const exp = typeof body?.config?.exp === "number" ? body.config.exp : null;
  return {
    exists: true,
    expired: exp != null && exp <= Math.floor(Date.now() / 1000),
    expiresAt: exp == null ? null : new Date(exp * 1000).toISOString(),
  };
}

async function createDailyRoom(roomName: string, retries = 2): Promise<{
  roomName: string;
  roomUrl: string;
  expiresAt: string | null;
  alreadyExisted: boolean;
}> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");
  const properties = dailyRoomProperties();
  const res = await fetch(`${DAILY_API_URL}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: roomName, privacy: "private", properties }),
  });

  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (3 - retries)));
    return createDailyRoom(roomName, retries - 1);
  }

  if (res.status === 400) {
    const errorBody = await readProviderCode(res);
    if (isDailyRoomAlreadyExistsErrorText(errorBody.text)) {
      return {
        roomName,
        roomUrl: videoDateRoomUrlForName(roomName, DAILY_DOMAIN),
        expiresAt: new Date(Number(properties.exp) * 1000).toISOString(),
        alreadyExisted: true,
      };
    }
    throw new Error(`daily_create_failed:${res.status}:${errorBody.providerCode ?? "unknown"}`);
  }

  if (!res.ok) {
    const { providerCode } = await readProviderCode(res);
    throw new Error(`daily_create_failed:${res.status}:${providerCode ?? "unknown"}`);
  }

  const body = (await res.json().catch(() => null)) as { name?: unknown; url?: unknown; config?: { exp?: unknown } } | null;
  const exp = typeof body?.config?.exp === "number" ? body.config.exp : Number(properties.exp);
  return {
    roomName: typeof body?.name === "string" ? body.name : roomName,
    roomUrl: typeof body?.url === "string" ? body.url : videoDateRoomUrlForName(roomName, DAILY_DOMAIN),
    expiresAt: Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : null,
    alreadyExisted: false,
  };
}

async function deleteDailyRoom(roomName: string, retries = 2): Promise<"deleted" | "not_found_idempotent"> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");
  const res = await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (3 - retries)));
    return deleteDailyRoom(roomName, retries - 1);
  }
  if (res.ok) return "deleted";
  if (res.status === 404) return "not_found_idempotent";
  const { providerCode } = await readProviderCode(res);
  throw new Error(`daily_delete_failed:${res.status}:${providerCode ?? "unknown"}`);
}

async function ensureVideoDateRoom(
  supabase: SupabaseServiceClient,
  row: OutboxRow,
): Promise<ProcessResult> {
  const sessionId = row.session_id ?? stringField(row.payload, "sessionId", "session_id");
  if (!sessionId) return { success: false, reason: "missing_session_id", permanent: true };

  const { data, error } = await supabase
    .from("video_sessions")
    .select("id,daily_room_name,daily_room_url,daily_room_verified_at,daily_room_expires_at,ended_at,state,phase")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) return { success: false, reason: "session_lookup_failed", retryAfterSeconds: 30 };
  if (!data) return { success: false, reason: "session_not_found", permanent: true };

  const session = data as VideoSessionRoomRow;
  const requestedRoomName = stringField(row.payload, "roomName", "room_name");
  if (session.ended_at || session.state === "ended" || session.phase === "ended") {
    const terminalRoomName = requestedRoomName ?? session.daily_room_name;
    if (terminalRoomName) {
      try {
        await deleteDailyRoom(terminalRoomName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusMatch = message.match(/:(\d{3}):/);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        return {
          success: false,
          reason: `terminal_room_cleanup_failed:${message}`.slice(0, 160),
          retryAfterSeconds: providerRetryAfter(status),
          permanent: message === "daily_api_key_missing",
        };
      }
    }
    return { success: true, reason: "skipped_ended_session" };
  }

  const roomName =
    requestedRoomName ??
    session.daily_room_name ??
    videoDateRoomNameForSession(sessionId);
  const canonicalUrl = videoDateRoomUrlForName(roomName, DAILY_DOMAIN);

  try {
    const providerState = await getDailyRoomState(roomName);
    let roomUrl = session.daily_room_url ?? canonicalUrl;
    let expiresAt = providerState.expiresAt;
    let reason = providerState.exists ? "provider_room_exists" : "provider_room_created";

    if (providerState.expired) {
      await deleteDailyRoom(roomName);
    }

    if (!providerState.exists || providerState.expired) {
      const created = await createDailyRoom(roomName);
      roomUrl = created.roomUrl;
      expiresAt = created.expiresAt;
      reason = created.alreadyExisted ? "provider_room_already_existed" : "provider_room_created";
    }

    const { data: updatedSession, error: updateError } = await supabase
      .from("video_sessions")
      .update({
        daily_room_name: roomName,
        daily_room_url: roomUrl,
        daily_room_verified_at: new Date().toISOString(),
        daily_room_expires_at: expiresAt,
        daily_room_provider_verify_reason: "outbox_drainer_v2",
      })
      .eq("id", sessionId)
      .is("ended_at", null)
      .select("id")
      .maybeSingle();

    if (updateError) return { success: false, reason: "session_room_update_failed", retryAfterSeconds: 30 };
    if (!updatedSession) {
      await deleteDailyRoom(roomName);
      return { success: true, reason: "skipped_terminal_after_provider_verify" };
    }
    return { success: true, reason };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = message.match(/:(\d{3}):/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    return {
      success: false,
      reason: message.slice(0, 160),
      retryAfterSeconds: providerRetryAfter(status),
      permanent: message === "daily_api_key_missing",
    };
  }
}

async function deleteVideoDateRoom(
  supabase: SupabaseServiceClient,
  row: OutboxRow,
): Promise<ProcessResult> {
  const sessionId = row.session_id ?? stringField(row.payload, "sessionId", "session_id");
  let roomName = stringField(row.payload, "roomName", "room_name");
  let session: VideoSessionRoomRow | null = null;

  if (sessionId) {
    const { data, error } = await supabase
      .from("video_sessions")
      .select("id,daily_room_name,daily_room_url,ended_at,state,phase")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return { success: false, reason: "session_lookup_failed", retryAfterSeconds: 30 };
    session = (data as VideoSessionRoomRow | null) ?? null;
    roomName = roomName ?? session?.daily_room_name ?? null;
    if (session && !session.ended_at && session.state !== "ended" && session.phase !== "ended") {
      return { success: false, reason: "delete_deferred_active_session", retryAfterSeconds: 60 };
    }
  }

  if (!roomName) return { success: true, reason: "missing_room_name_noop" };

  try {
    const outcome = await deleteDailyRoom(roomName);
    if (sessionId && session && (session.ended_at || session.state === "ended" || session.phase === "ended")) {
      await supabase
        .from("video_sessions")
        .update({ daily_room_name: null, daily_room_url: null })
        .eq("id", sessionId)
        .eq("daily_room_name", roomName);
    }
    return { success: true, reason: outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = message.match(/:(\d{3}):/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    return {
      success: false,
      reason: message.slice(0, 160),
      retryAfterSeconds: providerRetryAfter(status),
      permanent: message === "daily_api_key_missing",
    };
  }
}

async function sendNotification(
  supabaseUrl: string,
  serviceKey: string,
  row: OutboxRow,
): Promise<ProcessResult> {
  const userId = stringField(row.payload, "user_id", "userId");
  const category = stringField(row.payload, "category", "type");
  const title = stringField(row.payload, "title");
  const body = stringField(row.payload, "body");
  const data = isObjectPayload(row.payload.data) ? row.payload.data : {};
  if (!userId || !category) return { success: false, reason: "invalid_notification_payload", permanent: true };
  const requestBody: Record<string, unknown> = {
    user_id: userId,
    category,
    data,
    dedupe_key: stringField(row.payload, "dedupe_key", "dedupeKey") ?? row.dedupe_key ?? undefined,
  };
  if (title) requestBody.title = title;
  if (body) requestBody.body = body;
  if (Array.isArray(row.payload.channels)) requestBody.channels = row.payload.channels;
  if (typeof row.payload.priority === "string") requestBody.priority = row.payload.priority;
  if (typeof row.payload.group_key === "string") requestBody.group_key = row.payload.group_key;
  if (typeof row.payload.groupKey === "string") requestBody.group_key = row.payload.groupKey;
  if (typeof row.payload.expires_at === "string") requestBody.expires_at = row.payload.expires_at;
  if (typeof row.payload.expiresAt === "string") requestBody.expires_at = row.payload.expiresAt;
  if (isObjectPayload(row.payload.action)) requestBody.action = row.payload.action;
  if (typeof row.payload.actor_id === "string") requestBody.actor_id = row.payload.actor_id;
  if (typeof row.payload.actorId === "string") requestBody.actor_id = row.payload.actorId;
  if (typeof row.payload.bypass_preferences === "boolean") requestBody.bypass_preferences = row.payload.bypass_preferences;

  const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    return {
      success: false,
      reason: `notification_http_${res.status}`,
      retryAfterSeconds: res.status >= 500 ? 30 : 120,
      permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
    };
  }

  const responseBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (responseBody?.success === false || responseBody?.ok === false) {
    return notificationPayloadFailureResult(responseBody);
  }
  return { success: true, reason: "notification_sent" };
}

async function processOutboxRow(
  supabase: SupabaseServiceClient,
  supabaseUrl: string,
  serviceKey: string,
  row: OutboxRow,
): Promise<ProcessResult> {
  const kind = row.kind.toLowerCase();
  if (kind === "noop" || kind === "telemetry.noop") return { success: true, reason: "noop" };
  if (kind === "daily.ensure_video_date_room" || kind === "daily.ensure_room" || kind === "ensure_video_date_room") {
    return ensureVideoDateRoom(supabase, row);
  }
  if (kind === "daily.delete_video_date_room" || kind === "daily.delete_room" || kind === "delete_video_date_room") {
    return deleteVideoDateRoom(supabase, row);
  }
  if (kind === "notification.send" || kind === "push.send") {
    return sendNotification(supabaseUrl, serviceKey, row);
  }
  return { success: false, reason: `unsupported_outbox_kind:${kind}`, permanent: true };
}

async function completeOutboxRow(
  supabase: SupabaseServiceClient,
  workerId: string,
  row: OutboxRow,
  result: ProcessResult,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_video_date_provider_outbox_v2", {
    p_outbox_id: row.id,
    p_worker_id: workerId,
    p_success: result.success,
    p_error: result.success ? null : result.reason,
    p_retry_after_seconds: result.success ? null : result.retryAfterSeconds ?? null,
    p_permanent: result.success ? false : result.permanent === true,
  });
  if (error) {
    console.error("video-date-outbox-drainer complete error", JSON.stringify({
      outbox_id: row.id,
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
  const workerId = `video-date-outbox-${crypto.randomUUID()}`;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "missing_supabase_env" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey) as SupabaseServiceClient;

  if (body.dry_run) {
    const { data, error } = await supabase
      .from("video_date_provider_outbox")
      .select("id,session_id,kind,attempts,next_attempt_at,state,claim_expires_at,dedupe_key")
      .in("state", ["pending", "claimed"])
      .order("next_attempt_at", { ascending: true })
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

  const { data: claimed, error: claimError } = await supabase.rpc("claim_video_date_provider_outbox_v2", {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (claimError) return json({ ok: false, error: claimError.message }, 500);

  const rows = ((claimed ?? []) as OutboxRow[]).map((row) => ({
    ...row,
    payload: isObjectPayload(row.payload) ? row.payload : {},
  }));

  let completed = 0;
  let retried = 0;
  let permanentlyFailed = 0;
  const failures: Array<{ id: number; kind: string; reason: string }> = [];

  for (const row of rows) {
    const result = await processOutboxRow(supabase, supabaseUrl, serviceKey, row);
    const completedLease = await completeOutboxRow(supabase, workerId, row, result);
    if (!completedLease) {
      failures.push({ id: row.id, kind: row.kind, reason: "completion_rpc_failed" });
      continue;
    }
    if (result.success) completed += 1;
    else if (result.permanent) {
      permanentlyFailed += 1;
      failures.push({ id: row.id, kind: row.kind, reason: result.reason });
    } else {
      retried += 1;
      failures.push({ id: row.id, kind: row.kind, reason: result.reason });
    }
  }

  console.log(JSON.stringify({
    event: "video_date_outbox_drainer_run",
    worker_id: workerId,
    source: body.source ?? null,
    claimed: rows.length,
    completed,
    retried,
    permanently_failed: permanentlyFailed,
    latency_ms: Date.now() - startedAt,
  }));

  return json({
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    completed,
    retried,
    permanently_failed: permanentlyFailed,
    failures,
    latency_ms: Date.now() - startedAt,
  });
});
