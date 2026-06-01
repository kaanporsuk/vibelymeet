import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  buildMeetingTokenProperties,
  DAILY_VIDEO_DATE_ROOM_MAX_PARTICIPANTS,
  DAILY_VIDEO_DATE_ROOM_TTL_SECONDS as DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT,
  isDailyRoomUrlForName,
  resolveDailyRuntimeConfig,
  videoDateRoomNameForSession,
  videoDateRoomUrlForName,
} from "../daily-room/dailyRoomContracts.ts";
import {
  fetchWithTimeout,
  numericEnv,
  parseRetryAfterSeconds,
  ProviderRateLimitError,
  providerFetchTimeoutMs,
  providerRateLimitConfig,
} from "../_shared/video-date-provider-reliability.ts";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

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
    event: "video_date_token_refresh_daily_config_blocked",
    code: "DAILY_CONFIG_BLOCKED",
    blockers: DAILY_RUNTIME_CONFIG.blockers,
    fallback_used: DAILY_RUNTIME_CONFIG.fallbackUsed,
  }));
} else if (DAILY_RUNTIME_CONFIG.fallbackUsed) {
  console.error(JSON.stringify({
    event: "video_date_token_refresh_daily_domain_local_fallback_used",
    code: "DAILY_DOMAIN_FALLBACK_USED",
    daily_domain: DAILY_DOMAIN,
  }));
}
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT;
const DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS;
const DAILY_TOKEN_REFRESH_PROVIDER_MAX_RETRY_SLEEP_SECONDS = numericEnv(
  "DAILY_TOKEN_REFRESH_PROVIDER_MAX_RETRY_SLEEP_SECONDS",
  5,
  0,
  30,
);
const DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS = 2 * 60 * 1000;
const DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS = 180;
const DAILY_VIDEO_DATE_PROVIDER_ROOM_MIN_REMAINING_SECONDS = DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SnapshotPayload = {
  ok?: boolean;
  error?: string;
  eventId?: string | null;
  phase?: string | null;
  phaseDeadlineAt?: number | null;
  serverNow?: number | null;
  room?: {
    name?: string | null;
    url?: string | null;
    tokenRequired?: boolean | null;
  } | null;
};

type SupabaseEdgeClient = ReturnType<typeof createClient<any>>;

type DailyRoomProviderState = {
  exists: boolean;
  expired: boolean;
  expiresAt: string | null;
};

type DailyRoomProviderProof = {
  ok: boolean;
  reason: "exists" | "missing" | "expired";
  expiresAt: string | null;
};

function retryAfterHeaderValue(retryAfterSeconds: number | null | undefined): string | null {
  if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds)) return null;
  return String(Math.min(300, Math.max(1, Math.ceil(retryAfterSeconds))));
}

function isTokenRefreshProviderRateLimitUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (
      /take_video_date_token_refresh_provider_rate_limit_v1/i.test(message) &&
      /(not found|could not find|does not exist)/i.test(message)
    )
  );
}

async function waitForBoundedDailyTokenRetry(headers: Headers, fallbackSeconds: number): Promise<boolean> {
  const retryAfterSeconds = parseRetryAfterSeconds(headers, fallbackSeconds);
  if (retryAfterSeconds > DAILY_TOKEN_REFRESH_PROVIDER_MAX_RETRY_SLEEP_SECONDS) return false;
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
  return true;
}

async function readProviderResponseText(response: Response): Promise<string> {
  return response.clone().text().catch(() => "");
}

async function throwProviderResponseError(
  operation: "room_lookup" | "token_refresh",
  response: Response,
  roomName: string,
): Promise<never> {
  if (response.status === 429) {
    throw new ProviderRateLimitError(
      "daily",
      operation,
      parseRetryAfterSeconds(response.headers, 30),
      "provider_rate_limited",
    );
  }
  const text = await readProviderResponseText(response);
  console.error(JSON.stringify({
    event: "video_date_token_refresh_daily_provider_failed",
    operation,
    provider_status: response.status,
    room_name: roomName,
    provider_error: text.slice(0, 300),
  }));
  throw new Error(`daily_${operation}_failed`);
}

function parseDailyRoomProviderStatePayload(roomName: string, payload: unknown): DailyRoomProviderState {
  const room = payload && typeof payload === "object"
    ? payload as { name?: unknown; url?: unknown; config?: { exp?: unknown; max_participants?: unknown } }
    : null;
  const exp = typeof room?.config?.exp === "number" && Number.isFinite(room.config.exp)
    ? room.config.exp
    : null;
  const maxParticipants = typeof room?.config?.max_participants === "number"
    ? room.config.max_participants
    : null;
  if (
    typeof room?.name !== "string" ||
    room.name !== roomName ||
    typeof room?.url !== "string" ||
    !isDailyRoomUrlForName(room.url, roomName, DAILY_DOMAIN)
  ) {
    throw new Error("daily_room_lookup_invalid_response");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresTooSoon = exp == null || exp <= nowSeconds + DAILY_VIDEO_DATE_PROVIDER_ROOM_MIN_REMAINING_SECONDS;
  const roomConfigDrifted =
    maxParticipants != null && maxParticipants !== DAILY_VIDEO_DATE_ROOM_MAX_PARTICIPANTS;
  return {
    exists: true,
    expired: expiresTooSoon || roomConfigDrifted,
    expiresAt: exp == null ? null : new Date(exp * 1000).toISOString(),
  };
}

async function enforceTokenRefreshProviderRateLimit(
  supabase: SupabaseEdgeClient,
  sessionId: string,
  bucket: "room_lookup" | "meeting_token",
): Promise<void> {
  const config = providerRateLimitConfig("daily", bucket);
  const { data, error } = await supabase.rpc("take_video_date_token_refresh_provider_rate_limit_v1", {
    p_session_id: sessionId,
    p_bucket: config.bucket,
  });
  if (error) {
    if (isTokenRefreshProviderRateLimitUnavailable(error)) {
      console.error(JSON.stringify({
        event: "video_date_token_refresh_provider_rate_limit_unavailable",
        bucket: config.bucket,
        code: error.code ?? null,
      }));
      return;
    }
    throw new Error("daily_provider_rate_limit_check_failed");
  }
  const payload = (data ?? {}) as { ok?: boolean; error?: string; retryAfterSeconds?: number };
  if (payload.ok !== true) {
    const clientError =
      typeof payload.error === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(payload.error)
        ? payload.error
        : "provider_rate_limited";
    throw new ProviderRateLimitError(
      "daily",
      config.bucket,
      typeof payload.retryAfterSeconds === "number" ? payload.retryAfterSeconds : 30,
      clientError,
    );
  }
}

async function getDailyRoomProviderState(
  supabase: SupabaseEdgeClient,
  sessionId: string,
  roomName: string,
  retries = 1,
): Promise<DailyRoomProviderState> {
  await enforceTokenRefreshProviderRateLimit(supabase, sessionId, "room_lookup");
  const response = await fetchWithTimeout(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  }, {
    provider: "daily",
    operation: "room_lookup",
    timeoutMs: providerFetchTimeoutMs("daily", "room_lookup"),
    retryAfterSeconds: 30,
  });

  if (response.status === 429 && retries > 0) {
    if (await waitForBoundedDailyTokenRetry(response.headers, 2)) {
      return getDailyRoomProviderState(supabase, sessionId, roomName, retries - 1);
    }
  }

  if (response.status === 404) return { exists: false, expired: false, expiresAt: null };
  if (!response.ok) return throwProviderResponseError("room_lookup", response, roomName);
  const payload = await response.json().catch(() => null);
  return parseDailyRoomProviderStatePayload(roomName, payload);
}

async function ensureDailyRoomProviderReadyForTokenRefresh(params: {
  supabase: SupabaseEdgeClient;
  sessionId: string;
  userId: string;
  roomName: string;
}): Promise<DailyRoomProviderProof> {
  const state = await getDailyRoomProviderState(params.supabase, params.sessionId, params.roomName);
  if (state.exists && !state.expired) {
    return { ok: true, reason: "exists", expiresAt: state.expiresAt };
  }

  console.log(JSON.stringify({
    event: "video_date_token_refresh_provider_room_not_ready",
    session_id: params.sessionId,
    user_id: params.userId,
    room_name: params.roomName,
    reason: state.exists ? "expired" : "missing",
    provider_exists: state.exists,
    provider_expired: state.expired,
    provider_expires_at: state.expiresAt,
  }));

  return { ok: false, reason: state.exists ? "expired" : "missing", expiresAt: state.expiresAt };
}

function jsonResponse(
  corsHeaders: Record<string, string>,
  payload: unknown,
  status = 200,
  retryAfterSeconds?: number | null,
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const retryAfter = retryAfterHeaderValue(retryAfterSeconds);
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

async function enforceTokenRefreshRateLimit(supabase: SupabaseEdgeClient): Promise<void> {
  const { data, error } = await supabase.rpc("take_video_date_token_refresh_rate_limit_v1");
  if (error) throw new Error("daily_token_rate_limit_check_failed");
  const payload = (data ?? {}) as { ok?: boolean; error?: string; retryAfterSeconds?: number; scope?: string };
  if (payload.ok !== true) {
    const clientError =
      typeof payload.error === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(payload.error)
        ? payload.error
        : "provider_rate_limited";
    const bucket = payload.scope === "user" ? "meeting_token_refresh_user" : "meeting_token_refresh";
    throw new ProviderRateLimitError(
      "daily",
      bucket,
      typeof payload.retryAfterSeconds === "number" ? payload.retryAfterSeconds : 30,
      clientError,
    );
  }
}

async function isClientFeatureFlagEnabled(supabase: SupabaseEdgeClient, flag: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("evaluate_client_feature_flag", {
      p_flag: flag,
      p_user: userId,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

function resolveTokenWindow(
  snapshot: SnapshotPayload,
  issuedAtMs: number,
  phaseBoundedTokens: boolean,
  roomExpiresAtIso?: string | null,
): {
  ttlSeconds: number;
  tokenExpiresAtMs: number;
  tokenExpiresAtIso: string;
  reason: "phase_deadline" | "daily_room_expiry" | "max_ttl";
} {
  const maxTtlMs = DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS * 1000;
  const minTtlMs = DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS * 1000;
  const serverNowMs = typeof snapshot.serverNow === "number" && Number.isFinite(snapshot.serverNow)
    ? snapshot.serverNow
    : issuedAtMs;
  const clockSkewMs = serverNowMs - issuedAtMs;
  const phaseDeadlineAtMs = phaseBoundedTokens && typeof snapshot.phaseDeadlineAt === "number" && Number.isFinite(snapshot.phaseDeadlineAt)
    ? snapshot.phaseDeadlineAt
    : null;
  const roomExpiresAtMs = roomExpiresAtIso ? Date.parse(roomExpiresAtIso) : NaN;
  let targetExpiresAtMs = issuedAtMs + maxTtlMs;
  let reason: "phase_deadline" | "daily_room_expiry" | "max_ttl" = "max_ttl";

  if (phaseDeadlineAtMs !== null && phaseDeadlineAtMs > serverNowMs) {
    targetExpiresAtMs = phaseDeadlineAtMs - clockSkewMs + DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS;
    reason = "phase_deadline";
  } else if (phaseDeadlineAtMs !== null) {
    targetExpiresAtMs = issuedAtMs + minTtlMs;
    reason = "phase_deadline";
  } else if (Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > serverNowMs) {
    targetExpiresAtMs = roomExpiresAtMs - clockSkewMs;
    reason = "daily_room_expiry";
  }

  targetExpiresAtMs = Math.min(targetExpiresAtMs, issuedAtMs + maxTtlMs);
  if (Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > issuedAtMs) {
    targetExpiresAtMs = Math.min(targetExpiresAtMs, roomExpiresAtMs);
  }
  if (targetExpiresAtMs <= issuedAtMs + minTtlMs) {
    targetExpiresAtMs = Math.min(
      issuedAtMs + minTtlMs,
      Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > issuedAtMs
        ? roomExpiresAtMs
        : issuedAtMs + maxTtlMs,
    );
  }
  const ttlSeconds = Math.max(1, Math.ceil((targetExpiresAtMs - issuedAtMs) / 1000));
  const tokenExpiresAtMs = issuedAtMs + ttlSeconds * 1000;

  return {
    ttlSeconds,
    tokenExpiresAtMs,
    tokenExpiresAtIso: new Date(tokenExpiresAtMs).toISOString(),
    reason,
  };
}

async function createMeetingToken(
  supabase: SupabaseEdgeClient,
  sessionId: string,
  roomName: string,
  userId: string,
  ttlSeconds: number,
  retries = 1,
): Promise<{
  token: string;
  tokenExpiresAtMs: number;
  tokenExpiresAtIso: string;
}> {
  if (!DAILY_API_KEY) throw new Error("daily_api_key_missing");

  const issuedAtMs = Date.now();
  const tokenExpiresAtMs = issuedAtMs + ttlSeconds * 1000;
  await enforceTokenRefreshProviderRateLimit(supabase, sessionId, "meeting_token");
  const response = await fetchWithTimeout(`${DAILY_API_URL}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      properties: buildMeetingTokenProperties({
        roomName,
        userId,
        ttlSeconds,
        nowSeconds: Math.floor(issuedAtMs / 1000),
        ejectAtTokenExp: true,
      }),
    }),
  }, {
    provider: "daily",
    operation: "token_refresh",
    timeoutMs: providerFetchTimeoutMs("daily", "token_refresh"),
  });

  if (response.status === 429 && retries > 0) {
    if (await waitForBoundedDailyTokenRetry(response.headers, 2)) {
      return createMeetingToken(supabase, sessionId, roomName, userId, ttlSeconds, retries - 1);
    }
  }

  if (response.status === 429) {
    throw new ProviderRateLimitError(
      "daily",
      "meeting_token",
      parseRetryAfterSeconds(response.headers, 30),
      "provider_rate_limited",
    );
  }

  if (!response.ok) {
    console.error(JSON.stringify({
      event: "video_date_token_refresh_daily_failed",
      provider_status: response.status,
      room_name: roomName,
    }));
    throw new Error("daily_token_failed");
  }

  const payload = await response.json().catch(() => null) as { token?: unknown } | null;
  if (typeof payload?.token !== "string" || !payload.token) {
    throw new Error("daily_token_invalid_response");
  }

  return {
    token: payload.token,
    tokenExpiresAtMs,
    tokenExpiresAtIso: new Date(tokenExpiresAtMs).toISOString(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  const corsHeaders = corsHeadersForRequest(req);
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(corsHeaders, { ok: false, error: "origin_not_allowed" }, 403);
  }
  if (req.method !== "POST") {
    return jsonResponse(corsHeaders, { ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(corsHeaders, { ok: false, error: "not_authenticated" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) {
    return jsonResponse(corsHeaders, { ok: false, error: "not_authenticated" }, 401);
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const sessionId = typeof body?.session_id === "string"
    ? body.session_id
    : typeof body?.sessionId === "string"
      ? body.sessionId
      : null;

  if (!sessionId) return jsonResponse(corsHeaders, { ok: false, error: "missing_session_id" }, 400);
  if (!UUID_PATTERN.test(sessionId)) return jsonResponse(corsHeaders, { ok: false, error: "invalid_session_id" }, 400);

  if (!DAILY_RUNTIME_CONFIG.ok) {
    console.error(JSON.stringify({
      event: "video_date_token_refresh_config_blocked_request",
      code: "DAILY_CONFIG_BLOCKED",
      session_id: sessionId,
      user_id: user.id,
      blockers: DAILY_RUNTIME_CONFIG.blockers,
      fallback_used: DAILY_RUNTIME_CONFIG.fallbackUsed,
    }));
    return jsonResponse(corsHeaders, {
      ok: false,
      code: "DAILY_CONFIG_BLOCKED",
      error: "daily_config_blocked",
      retryable: true,
      blockers: DAILY_RUNTIME_CONFIG.blockers,
    }, 503);
  }

  const { data, error } = await supabase.rpc("get_video_date_snapshot_core", {
    p_session_id: sessionId,
  });
  if (error) {
    console.error(JSON.stringify({
      event: "video_date_token_refresh_snapshot_failed",
      session_id: sessionId,
      user_id: user.id,
      code: error.code,
    }));
    return jsonResponse(corsHeaders, { ok: false, error: "snapshot_core_failed", retryable: true }, 503);
  }

  const snapshot = data as SnapshotPayload | null;
  if (!snapshot?.ok) {
    const status = snapshot?.error === "not_participant" ? 403 : snapshot?.error === "session_not_found" ? 404 : 409;
    return jsonResponse(corsHeaders, snapshot ?? { ok: false, error: "snapshot_not_found" }, status);
  }

  const phase = typeof snapshot.phase === "string" ? snapshot.phase : null;
  if (phase !== "handshake" && phase !== "date") {
    return jsonResponse(corsHeaders, { ok: false, error: "session_not_active", phase, retryable: false }, 409);
  }

  const roomName = snapshot.room?.name ?? null;
  const roomUrl = snapshot.room?.url ?? null;
  if (!roomName || !roomUrl) {
    return jsonResponse(corsHeaders, { ok: false, error: "room_not_ready", phase, retryable: true }, 409);
  }
  const expectedRoomName = videoDateRoomNameForSession(sessionId);
  const expectedRoomUrl = videoDateRoomUrlForName(expectedRoomName, DAILY_DOMAIN);
  const roomUrlMatchesExpectedRoom = isDailyRoomUrlForName(roomUrl, expectedRoomName, DAILY_DOMAIN);
  if (
    roomName !== expectedRoomName ||
    !roomUrlMatchesExpectedRoom
  ) {
    console.error(JSON.stringify({
      event: "video_date_token_refresh_room_mismatch",
      session_id: sessionId,
      user_id: user.id,
      room_name: roomName,
      expected_room_name: expectedRoomName,
      room_url_matches_canonical: roomUrl === expectedRoomUrl,
      room_url_matches_expected_room: roomUrlMatchesExpectedRoom,
    }));
    return jsonResponse(corsHeaders, { ok: false, error: "room_mismatch", phase, retryable: true }, 409);
  }
  if (!DAILY_API_KEY) {
    return jsonResponse(corsHeaders, { ok: false, error: "daily_provider_unavailable", phase, retryable: true }, 503);
  }

  try {
    await enforceTokenRefreshRateLimit(supabase);
    const providerProof = await ensureDailyRoomProviderReadyForTokenRefresh({
      supabase,
      sessionId,
      userId: user.id,
      roomName,
    });
    if (!providerProof.ok) {
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "room_not_ready",
        phase,
        retryable: true,
        provider_reason: providerProof.reason,
        daily_room_expires_at: providerProof.expiresAt,
      }, 409);
    }
    const phaseBoundedTokens = await isClientFeatureFlagEnabled(
      supabase,
      "video_date.daily_token_refresh_v2",
      user.id,
    );
    const tokenWindow = resolveTokenWindow(snapshot, Date.now(), phaseBoundedTokens, providerProof.expiresAt);
    const tokenResult = await createMeetingToken(supabase, sessionId, roomName, user.id, tokenWindow.ttlSeconds);
    return jsonResponse(corsHeaders, {
      ok: true,
      session_id: sessionId,
      event_id: snapshot.eventId ?? null,
      phase,
      room_name: roomName,
      room_url: roomUrl,
      token: tokenResult.token,
      token_expires_at: tokenResult.tokenExpiresAtIso,
      tokenExpiresAt: tokenResult.tokenExpiresAtMs,
      token_ttl_seconds: tokenWindow.ttlSeconds,
      token_expiry_reason: tokenWindow.reason,
      provider_room_recovered: false,
      provider_verify_reason: providerProof.reason,
      daily_room_expires_at: providerProof.expiresAt,
    });
  } catch (tokenError) {
    if (tokenError instanceof ProviderRateLimitError) {
      return jsonResponse(corsHeaders, {
        ok: false,
        error: tokenError.clientError,
        retryable: true,
        retry_after_seconds: tokenError.retryAfterSeconds,
        retryAfterSeconds: tokenError.retryAfterSeconds,
      }, 429, tokenError.retryAfterSeconds);
    }
    console.error(JSON.stringify({
      event: "video_date_token_refresh_failed",
      session_id: sessionId,
      user_id: user.id,
      room_name: roomName,
      error: tokenError instanceof Error ? tokenError.message : "unknown",
    }));
    return jsonResponse(corsHeaders, { ok: false, error: "daily_token_failed", retryable: true }, 503);
  }
});
