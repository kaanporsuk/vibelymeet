import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  buildVideoDateRoomProperties,
  DAILY_VIDEO_DATE_ROOM_TTL_SECONDS as DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT,
  isDailyRoomAlreadyExistsErrorText,
  isDailyRoomUrlForName,
  resolveDailyRuntimeConfig,
  videoDateRoomNameForSession,
  videoDateRoomUrlForName,
} from "../daily-room/dailyRoomContracts.ts";
import {
  captureVideoDateProviderException,
  createClaimLeaseRefresher,
  deadLetterVideoDateProviderFailure,
  enforceProviderRateLimit,
  fetchWithTimeout,
  logVideoDateProviderFailure,
  parseRetryAfterSeconds,
  providerFailureCode,
  providerFailureMessage,
  providerFailureRetryAfter,
  providerFetchTimeoutMs,
  providerRateLimitConfig,
} from "../_shared/video-date-provider-reliability.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_RUNTIME_CONFIG = resolveDailyRuntimeConfig({
  dailyApiKey: Deno.env.get("DAILY_API_KEY")?.trim(),
  dailyDomainEnv: Deno.env.get("DAILY_DOMAIN")?.trim(),
  environment: Deno.env.get("ENVIRONMENT")?.trim(),
  allowLocalFallback: true,
  requireApiKey: true,
});
const DAILY_API_KEY = DAILY_RUNTIME_CONFIG.dailyApiKey ?? "";
const DAILY_DOMAIN = DAILY_RUNTIME_CONFIG.dailyDomain;
if (!DAILY_RUNTIME_CONFIG.ok) {
  console.error(JSON.stringify({
    event: "video_date_outbox_drainer_daily_config_blocked",
    code: "DAILY_CONFIG_BLOCKED",
    blockers: DAILY_RUNTIME_CONFIG.blockers,
    fallback_used: DAILY_RUNTIME_CONFIG.fallbackUsed,
  }));
} else if (DAILY_RUNTIME_CONFIG.fallbackUsed) {
  console.error(JSON.stringify({
    event: "video_date_outbox_drainer_daily_domain_local_fallback_used",
    code: "DAILY_DOMAIN_FALLBACK_USED",
    daily_domain: DAILY_DOMAIN,
  }));
}
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT;

type WorkerRequest = {
  batch_size?: number;
  lease_seconds?: number;
  dry_run?: boolean;
  health_check?: boolean;
  source?: string;
};

type OutboxRow = {
  id: number;
  session_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  dedupe_key: string | null;
  provider_idempotency_key?: string | null;
  claim_expires_at: string | null;
};

type VideoSessionRoomRow = {
  id: string;
  daily_room_name: string | null;
  daily_room_url: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  daily_room_provider_deleted_at?: string | null;
  daily_room_provider_delete_reason?: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
};

type ProcessResult =
  | { success: true; reason: string; permanent?: false }
  | { success: false; reason: string; retryAfterSeconds?: number; permanent?: boolean };

type CompletionResult = {
  ok: boolean;
  state: "done" | "pending" | "failed" | string | null;
  permanent: boolean;
  retryAfterSeconds: number | null;
  error?: string | null;
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

function isMissingProviderIdempotencyColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return (
    code === "42703" ||
    (
      /provider_idempotency_key/i.test(message) &&
      /(does not exist|not found|could not find)/i.test(message)
    )
  );
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
  if (req.method === "GET") {
    const url = new URL(req.url);
    const healthParam = url.searchParams.get("health_check") ??
      url.searchParams.get("notification_health_check") ??
      url.searchParams.get("health");
    return {
      dry_run: url.searchParams.get("dry_run") === "true",
      health_check: healthParam === "true" || healthParam === "1" || healthParam === "notification",
      source: url.searchParams.get("source")?.slice(0, 80) || undefined,
    };
  }
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      batch_size: typeof parsed.batch_size === "number" ? parsed.batch_size : undefined,
      lease_seconds: typeof parsed.lease_seconds === "number" ? parsed.lease_seconds : undefined,
      dry_run: parsed.dry_run === true,
      health_check: parsed.health_check === true || parsed.notification_health_check === true,
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

function safeProviderBodySnippet(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/Key\s+[A-Za-z0-9._~+/=-]+/gi, "Key [redacted]")
    .replace(/"Authorization"\s*:\s*"[^"]+"/gi, '"Authorization":"[redacted]"')
    .replace(/"apikey"\s*:\s*"[^"]+"/gi, '"apikey":"[redacted]"')
    .slice(0, 240);
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

async function sendNotificationAuthHealthCheck(
  supabaseUrl: string,
  serviceKey: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/send-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      health_check: true,
      source: "video-date-outbox-drainer",
    }),
  }, {
    provider: "supabase",
    operation: "send_notification_auth_health_check",
    timeoutMs: providerFetchTimeoutMs("supabase", "send_notification_function"),
    signal,
  });
  const responseText = await res.text().catch(() => "");
  const ok = res.ok;
  if (!ok) {
    console.error(JSON.stringify({
      event: "video_date_notification_auth_health_failed",
      status: res.status,
      reason: `notification_auth_health_http_${res.status}`,
      body_snippet: safeProviderBodySnippet(responseText),
    }));
  }
  return {
    ok,
    status: res.status,
    reason: ok ? "notification_auth_health_ok" : `notification_auth_health_http_${res.status}`,
    body_snippet: ok ? undefined : safeProviderBodySnippet(responseText),
  };
}

function isVideoDateNotificationCategory(category: string): boolean {
  return category === "ready_gate" ||
    category === "partner_ready" ||
    category === "date_starting" ||
    category === "reconnection" ||
    category === "date_reminder" ||
    category === "post_date_feedback_reminder";
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
  if (!DAILY_RUNTIME_CONFIG.ok || !DAILY_API_KEY) return null;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DAILY_API_KEY}`,
  };
}

function dailyRoomProperties(): Record<string, unknown> {
  return buildVideoDateRoomProperties({
    nowSeconds: Math.floor(Date.now() / 1000),
    ttlSeconds: DAILY_VIDEO_DATE_ROOM_TTL_SECONDS,
  });
}

function providerRetryAfter(status: number | null): number {
  if (status === 429) return 60;
  if (status == null || status >= 500) return 30;
  return 120;
}

async function getDailyRoomState(
  supabase: SupabaseServiceClient,
  roomName: string,
  retries = 2,
  signal?: AbortSignal,
): Promise<{
  exists: boolean;
  expired: boolean;
  expiresAt: string | null;
}> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");

  await enforceProviderRateLimit(supabase, providerRateLimitConfig("daily", "room_lookup"));
  const res = await fetchWithTimeout(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers,
  }, {
    provider: "daily",
    operation: "room_lookup",
    timeoutMs: providerFetchTimeoutMs("daily", "room_lookup"),
    signal,
  });
  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, parseRetryAfterSeconds(res.headers, 3 - retries) * 1000));
    return getDailyRoomState(supabase, roomName, retries - 1, signal);
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

async function createDailyRoom(
  supabase: SupabaseServiceClient,
  roomName: string,
  retries = 2,
  signal?: AbortSignal,
): Promise<{
  roomName: string;
  roomUrl: string;
  expiresAt: string | null;
  alreadyExisted: boolean;
}> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");
  const properties = dailyRoomProperties();
  await enforceProviderRateLimit(supabase, providerRateLimitConfig("daily", "room_create"));
  const res = await fetchWithTimeout(`${DAILY_API_URL}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: roomName, privacy: "private", properties }),
  }, {
    provider: "daily",
    operation: "room_create",
    timeoutMs: providerFetchTimeoutMs("daily", "room_create"),
    signal,
  });

  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, parseRetryAfterSeconds(res.headers, 3 - retries) * 1000));
    return createDailyRoom(supabase, roomName, retries - 1, signal);
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

  const body = (await res.json().catch(() => null)) as {
    name?: unknown;
    url?: unknown;
    config?: { exp?: unknown; max_participants?: unknown };
  } | null;
  const exp = body?.config?.exp;
  if (
    typeof body?.name !== "string" ||
    body.name !== roomName ||
    typeof body?.url !== "string" ||
    !isDailyRoomUrlForName(body.url, roomName, DAILY_DOMAIN) ||
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp <= Math.floor(Date.now() / 1000) ||
    body.config?.max_participants !== 2
  ) {
    throw new Error("daily_create_failed:invalid_room_response");
  }
  return {
    roomName: body.name,
    roomUrl: body.url,
    expiresAt: new Date(exp * 1000).toISOString(),
    alreadyExisted: false,
  };
}

async function deleteDailyRoom(
  supabase: SupabaseServiceClient,
  roomName: string,
  retries = 2,
  signal?: AbortSignal,
): Promise<"deleted" | "not_found_idempotent"> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");
  await enforceProviderRateLimit(supabase, providerRateLimitConfig("daily", "room_delete"));
  const res = await fetchWithTimeout(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "DELETE",
    headers,
  }, {
    provider: "daily",
    operation: "room_delete",
    timeoutMs: providerFetchTimeoutMs("daily", "room_delete"),
    signal,
  });
  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, parseRetryAfterSeconds(res.headers, 3 - retries) * 1000));
    return deleteDailyRoom(supabase, roomName, retries - 1, signal);
  }
  if (res.ok) return "deleted";
  if (res.status === 404) return "not_found_idempotent";
  const { providerCode } = await readProviderCode(res);
  throw new Error(`daily_delete_failed:${res.status}:${providerCode ?? "unknown"}`);
}

async function ensureVideoDateRoom(
  supabase: SupabaseServiceClient,
  row: OutboxRow,
  signal?: AbortSignal,
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
        await deleteDailyRoom(supabase, terminalRoomName, 2, signal);
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
    const providerState = await getDailyRoomState(supabase, roomName, 2, signal);
    let roomUrl =
      session.daily_room_url && isDailyRoomUrlForName(session.daily_room_url, roomName, DAILY_DOMAIN)
        ? session.daily_room_url
        : canonicalUrl;
    let expiresAt = providerState.expiresAt;
    let reason = providerState.exists ? "provider_room_exists" : "provider_room_created";

    if (providerState.expired) {
      await deleteDailyRoom(supabase, roomName, 2, signal);
    }

    if (!providerState.exists || providerState.expired) {
      const created = await createDailyRoom(supabase, roomName, 2, signal);
      roomUrl = created.roomUrl;
      expiresAt = created.expiresAt;
      reason = created.alreadyExisted ? "provider_room_already_existed" : "provider_room_created";
      if (created.alreadyExisted) {
        const verifiedExisting = await getDailyRoomState(supabase, roomName, 2, signal);
        if (!verifiedExisting.exists || verifiedExisting.expired) {
          if (verifiedExisting.expired) {
            await deleteDailyRoom(supabase, roomName, 2, signal);
          }
          const recreated = await createDailyRoom(supabase, roomName, 2, signal);
          roomUrl = recreated.roomUrl;
          expiresAt = recreated.expiresAt;
          reason = "provider_room_recreated_after_stale_already_exists";
          if (recreated.alreadyExisted) {
            const finalState = await getDailyRoomState(supabase, roomName, 2, signal);
            if (!finalState.exists || finalState.expired) {
              return {
                success: false,
                reason: "provider_room_already_exists_recovery_failed",
                retryAfterSeconds: 30,
              };
            }
            roomUrl = videoDateRoomUrlForName(roomName, DAILY_DOMAIN);
            expiresAt = finalState.expiresAt;
          }
        } else {
          roomUrl = videoDateRoomUrlForName(roomName, DAILY_DOMAIN);
          expiresAt = verifiedExisting.expiresAt;
        }
      }
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
      await deleteDailyRoom(supabase, roomName, 2, signal);
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
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const sessionId = row.session_id ?? stringField(row.payload, "sessionId", "session_id");
  let roomName = stringField(row.payload, "roomName", "room_name");
  let session: VideoSessionRoomRow | null = null;

  if (sessionId) {
    const { data, error } = await supabase
      .from("video_sessions")
      .select("id,daily_room_name,daily_room_url,daily_room_provider_deleted_at,daily_room_provider_delete_reason,ended_at,state,phase")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return { success: false, reason: "session_lookup_failed", retryAfterSeconds: 30 };
    session = (data as VideoSessionRoomRow | null) ?? null;
    roomName = roomName ?? session?.daily_room_name ?? null;
    if (session && !session.ended_at && session.state !== "ended" && session.phase !== "ended") {
      return { success: false, reason: "delete_deferred_active_session", retryAfterSeconds: 60 };
    }
    const terminalSession = Boolean(
      session && (session.ended_at || session.state === "ended" || session.phase === "ended"),
    );
    if (terminalSession && session?.daily_room_provider_deleted_at) {
      return { success: true, reason: "provider_room_already_marked_deleted" };
    }
  }

  if (!roomName) return { success: true, reason: "missing_room_name_noop" };

  try {
    const outcome = await deleteDailyRoom(supabase, roomName, 2, signal);
    if (sessionId && session && (session.ended_at || session.state === "ended" || session.phase === "ended")) {
      await supabase
        .from("video_sessions")
        .update({
          daily_room_provider_deleted_at: new Date().toISOString(),
          daily_room_provider_delete_reason: `outbox_drainer:${outcome}`.slice(0, 160),
        })
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
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const userId = stringField(row.payload, "user_id", "userId");
  const category = stringField(row.payload, "category", "type");
  const title = stringField(row.payload, "title");
  const body = stringField(row.payload, "body");
  const data = isObjectPayload(row.payload.data) ? row.payload.data : {};
  if (!userId || !category) return { success: false, reason: "invalid_notification_payload", permanent: true };
  const dedupeKey = stringField(row.payload, "dedupe_key", "dedupeKey") ?? row.dedupe_key ?? null;
  const providerIdempotencyKey =
    stringField(row.payload, "provider_idempotency_key", "providerIdempotencyKey") ??
    (typeof row.provider_idempotency_key === "string" && row.provider_idempotency_key.trim()
      ? row.provider_idempotency_key.trim()
      : null);
  if (isVideoDateNotificationCategory(category) && !dedupeKey) {
    return { success: false, reason: "missing_stable_notification_dedupe_key", permanent: true };
  }
  const requestBody: Record<string, unknown> = {
    user_id: userId,
    category,
    data,
    dedupe_key: dedupeKey ?? undefined,
  };
  if (providerIdempotencyKey) requestBody.provider_idempotency_key = providerIdempotencyKey;
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

  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/send-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(requestBody),
  }, {
    provider: "supabase",
    operation: "send_notification_function",
    timeoutMs: providerFetchTimeoutMs("supabase", "send_notification_function"),
    signal,
  });

  if (!res.ok) {
    const responseText = await res.text().catch(() => "");
    const authFailure = res.status === 401 || res.status === 403;
    if (authFailure) {
      console.error(JSON.stringify({
        event: "video_date_notification_auth_failure",
        outbox_id: row.id,
        session_id: row.session_id,
        status: res.status,
        reason: `notification_auth_failed_${res.status}`,
        body_snippet: safeProviderBodySnippet(responseText),
      }));
    }
    return {
      success: false,
      reason: authFailure ? `notification_auth_failed_${res.status}` : `notification_http_${res.status}`,
      retryAfterSeconds: authFailure ? 300 : res.status >= 500 ? 30 : 120,
      permanent: authFailure || (res.status >= 400 && res.status < 500 && res.status !== 429),
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
  signal?: AbortSignal,
): Promise<ProcessResult> {
  // Canonical command kinds only. All live producers enqueue these exact
  // names; legacy alias names (daily.ensure_room, ensure_video_date_room,
  // daily.delete_room, delete_video_date_room, push.send) were retired and
  // fall through to the permanent unsupported_outbox_kind failure.
  const kind = row.kind.toLowerCase();
  if (kind === "noop" || kind === "telemetry.noop") return { success: true, reason: "noop" };
  if (kind === "daily.ensure_video_date_room") {
    if (!DAILY_RUNTIME_CONFIG.ok) {
      return { success: false, reason: "daily_config_blocked", retryAfterSeconds: 300, permanent: false };
    }
    return ensureVideoDateRoom(supabase, row, signal);
  }
  if (kind === "daily.delete_video_date_room") {
    if (!DAILY_RUNTIME_CONFIG.ok) {
      return { success: false, reason: "daily_config_blocked", retryAfterSeconds: 300, permanent: false };
    }
    return deleteVideoDateRoom(supabase, row, signal);
  }
  if (kind === "notification.send") {
    return sendNotification(supabaseUrl, serviceKey, row, signal);
  }
  return { success: false, reason: `unsupported_outbox_kind:${kind}`, permanent: true };
}

async function completeOutboxRow(
  supabase: SupabaseServiceClient,
  workerId: string,
  row: OutboxRow,
  result: ProcessResult,
): Promise<CompletionResult> {
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
    return { ok: false, state: null, permanent: false, retryAfterSeconds: null, error: error.message };
  }
  const payload = data as {
    ok?: boolean;
    state?: string;
    permanent?: boolean;
    retryAfterSeconds?: number;
    error?: string;
  } | null;
  return {
    ok: payload?.ok === true,
    state: typeof payload?.state === "string" ? payload.state : null,
    permanent: payload?.permanent === true,
    retryAfterSeconds: typeof payload?.retryAfterSeconds === "number" ? payload.retryAfterSeconds : null,
    error: payload?.error ?? null,
  };
}

function providerForOutboxKind(kind: string): string {
  const normalized = kind.toLowerCase();
  if (normalized.startsWith("daily.")) return "daily";
  if (normalized.startsWith("notification.") || normalized.startsWith("push.")) return "onesignal";
  return "provider";
}

async function logOutboxFailure(
  supabase: SupabaseServiceClient,
  row: OutboxRow,
  result: ProcessResult,
  leaseLost = false,
): Promise<void> {
  if (result.success && !leaseLost) return;
  await logVideoDateProviderFailure(supabase, {
    targetKind: "outbox",
    outboxId: row.id,
    sessionId: row.session_id,
    provider: providerForOutboxKind(row.kind),
    operation: row.kind,
    errorCode: leaseLost ? "lease_lost" : result.reason.split(":")[0]?.slice(0, 120) ?? "outbox_failed",
    errorMessage: leaseLost ? "outbox row lease was lost before completion" : result.reason,
    retryAfterSeconds: result.success || result.permanent === true ? null : result.retryAfterSeconds ?? null,
    permanent: result.success ? false : result.permanent === true,
    leaseLost,
    metadata: {
      attempts: row.attempts,
      dedupe_key_present: Boolean(row.dedupe_key),
    },
  });
  if (!result.success && result.permanent === true) {
    await deadLetterVideoDateProviderFailure(supabase, {
      targetKind: "outbox",
      outboxId: row.id,
      sessionId: row.session_id,
      provider: providerForOutboxKind(row.kind),
      operation: row.kind,
      reason: result.reason,
      payload: {
        kind: row.kind,
        attempts: row.attempts,
        dedupe_key_present: Boolean(row.dedupe_key),
      },
    });
  }
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

  if (body.health_check) {
    const notificationAuth = await sendNotificationAuthHealthCheck(supabaseUrl, serviceKey);
    return json({
      ok: notificationAuth.ok === true,
      health_check: true,
      worker_id: workerId,
      notification_auth: notificationAuth,
      latency_ms: Date.now() - startedAt,
    }, notificationAuth.ok === true ? 200 : 503);
  }

  if (body.dry_run) {
    const previewColumns = "id,session_id,kind,attempts,next_attempt_at,state,claim_expires_at,dedupe_key";
    let { data, error } = await supabase
      .from("video_date_provider_outbox")
      .select(`${previewColumns},provider_idempotency_key`)
      .in("state", ["pending", "claimed"])
      .order("next_attempt_at", { ascending: true })
      .limit(batchSize);
    if (error && isMissingProviderIdempotencyColumnError(error)) {
      const fallback = await supabase
        .from("video_date_provider_outbox")
        .select(previewColumns)
        .in("state", ["pending", "claimed"])
        .order("next_attempt_at", { ascending: true })
        .limit(batchSize);
      data = fallback.data;
      error = fallback.error;
    }
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
    const rowLease = createClaimLeaseRefresher(supabase, {
      rowKind: "outbox",
      rowId: row.id,
      workerId,
      leaseSeconds,
      onLeaseLost: (reason) => {
        console.warn(JSON.stringify({
          event: "video_date_outbox_row_lease_lost",
          worker_id: workerId,
          outbox_id: row.id,
          kind: row.kind,
          reason,
        }));
      },
    });
    let result: ProcessResult;
    try {
      result = await processOutboxRow(supabase, supabaseUrl, serviceKey, row, rowLease.signal);
    } catch (error) {
      await captureVideoDateProviderException(error, {
        provider: providerForOutboxKind(row.kind),
        operation: row.kind,
        outbox_id: row.id,
        session_id: row.session_id,
      });
      result = {
        success: false,
        reason: providerFailureMessage(error),
        retryAfterSeconds: providerFailureRetryAfter(error, 30),
        permanent: providerFailureCode(error) === "daily_api_key_missing",
      };
    } finally {
      rowLease.stop();
    }

    if (rowLease.isLost()) {
      await logOutboxFailure(supabase, row, result, true);
      failures.push({ id: row.id, kind: row.kind, reason: "lease_lost_before_completion" });
      continue;
    }

    const completion = await completeOutboxRow(supabase, workerId, row, result);
    if (!completion.ok) {
      await logOutboxFailure(supabase, row, result, true);
      failures.push({ id: row.id, kind: row.kind, reason: "completion_rpc_failed" });
      continue;
    }

    const settledResult: ProcessResult = result.success
      ? result
      : {
        ...result,
        permanent: result.permanent === true || (completion.state === "failed" && completion.permanent),
        retryAfterSeconds: completion.state === "pending"
          ? completion.retryAfterSeconds ?? result.retryAfterSeconds
          : result.retryAfterSeconds,
      };
    await logOutboxFailure(supabase, row, settledResult, false);
    if (settledResult.success) completed += 1;
    else if (settledResult.permanent) {
      permanentlyFailed += 1;
      failures.push({ id: row.id, kind: row.kind, reason: settledResult.reason });
    } else {
      retried += 1;
      failures.push({ id: row.id, kind: row.kind, reason: settledResult.reason });
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
