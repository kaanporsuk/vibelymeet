import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMeetingTokenProperties } from "../daily-room/dailyRoomContracts.ts";
import {
  enforceProviderRateLimit,
  fetchWithTimeout,
  numericEnv,
  parseRetryAfterSeconds,
  providerFailureCode,
  providerFailureMessage,
  providerFailureRetryAfter,
  providerFetchTimeoutMs,
  ProviderRateLimitError,
  providerRateLimitConfig,
} from "../_shared/video-date-provider-reliability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")?.trim() ?? "";
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400;
const DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS;
const DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_PHASE_EXTENSION_BUFFER_MS = 2 * 60 * 1000;
const DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_MIN_TTL_SECONDS = 180;
const DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS = numericEnv(
  "DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS",
  5,
  0,
  30,
);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let providerReliabilityClient: any = null;

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
    token?: string;
    tokenExpiresAt?: number;
    tokenTtlSeconds?: number;
    tokenExpiryReason?: string;
  } | null;
};

function retryAfterHeaderValue(retryAfterSeconds: number | null | undefined): string | null {
  if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds)) return null;
  return String(Math.min(300, Math.max(1, Math.ceil(retryAfterSeconds))));
}

function jsonResponse(payload: unknown, status = 200, retryAfterSeconds?: number | null): Response {
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

function retryAfterJsonFields(retryAfterSeconds: number | null | undefined): Record<string, number> {
  const retryAfter = retryAfterHeaderValue(retryAfterSeconds);
  return retryAfter
    ? {
      retry_after_seconds: Number(retryAfter),
      retryAfterSeconds: Number(retryAfter),
    }
    : {};
}

function getProviderReliabilityClient(): any {
  if (providerReliabilityClient) return providerReliabilityClient;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  providerReliabilityClient = createClient(supabaseUrl, serviceRoleKey);
  return providerReliabilityClient;
}

function errorStatus(error: string | undefined): number {
  switch (error) {
    case "not_authenticated":
      return 401;
    case "not_participant":
      return 403;
    case "session_not_found":
      return 404;
    default:
      return 409;
  }
}

function withoutToken(snapshot: SnapshotPayload): SnapshotPayload {
  if (!snapshot.room) return snapshot;
  const {
    token: _token,
    tokenExpiresAt: _tokenExpiresAt,
    tokenTtlSeconds: _tokenTtlSeconds,
    tokenExpiryReason: _tokenExpiryReason,
    ...room
  } = snapshot.room;
  return {
    ...snapshot,
    room,
  };
}

async function isClientFeatureFlagEnabled(supabase: any, flag: string, userId: string): Promise<boolean> {
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

class SnapshotDailyTokenError extends Error {
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | null;
  readonly providerStatus: number | null;
  readonly clientError: string;

  constructor(input: {
    message: string;
    httpStatus: number;
    retryAfterSeconds?: number | null;
    providerStatus?: number | null;
    clientError?: string;
  }) {
    super(input.message);
    this.name = "SnapshotDailyTokenError";
    this.httpStatus = input.httpStatus;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.providerStatus = input.providerStatus ?? null;
    this.clientError = input.clientError ?? input.message;
  }
}

function resolveSnapshotTokenWindow(snapshot: SnapshotPayload, issuedAtMs: number, phaseBoundedTokens: boolean): {
  ttlSeconds: number;
  tokenExpiresAt: number;
  reason: "phase_deadline" | "max_ttl";
} {
  const maxTtlMs = DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_TTL_SECONDS * 1000;
  const minTtlMs = DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_MIN_TTL_SECONDS * 1000;
  const serverNowMs = typeof snapshot.serverNow === "number" && Number.isFinite(snapshot.serverNow)
    ? snapshot.serverNow
    : issuedAtMs;
  const clockSkewMs = serverNowMs - issuedAtMs;
  const phaseDeadlineAtMs = phaseBoundedTokens && typeof snapshot.phaseDeadlineAt === "number" && Number.isFinite(snapshot.phaseDeadlineAt)
    ? snapshot.phaseDeadlineAt
    : null;
  let targetExpiresAtMs = issuedAtMs + maxTtlMs;
  let reason: "phase_deadline" | "max_ttl" = "max_ttl";

  if (phaseDeadlineAtMs !== null && phaseDeadlineAtMs > serverNowMs) {
    targetExpiresAtMs = phaseDeadlineAtMs - clockSkewMs + DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_PHASE_EXTENSION_BUFFER_MS;
    reason = "phase_deadline";
  } else if (phaseDeadlineAtMs !== null) {
    targetExpiresAtMs = issuedAtMs + minTtlMs;
    reason = "phase_deadline";
  }

  targetExpiresAtMs = Math.min(targetExpiresAtMs, issuedAtMs + maxTtlMs);
  if (targetExpiresAtMs <= issuedAtMs + minTtlMs) {
    targetExpiresAtMs = Math.min(issuedAtMs + minTtlMs, issuedAtMs + maxTtlMs);
  }

  const ttlSeconds = Math.max(1, Math.ceil((targetExpiresAtMs - issuedAtMs) / 1000));
  return {
    ttlSeconds,
    tokenExpiresAt: issuedAtMs + ttlSeconds * 1000,
    reason,
  };
}

async function createMeetingToken(
  roomName: string,
  userId: string,
  ttlSeconds: number,
  retries = 1,
): Promise<{
  token: string;
  tokenExpiresAt: number;
}> {
  if (!DAILY_API_KEY) {
    throw new SnapshotDailyTokenError({
      message: "daily_api_key_missing",
      httpStatus: 503,
      clientError: "daily_token_failed",
    });
  }
  const reliabilityClient = getProviderReliabilityClient();
  if (!reliabilityClient) {
    throw new SnapshotDailyTokenError({
      message: "provider_reliability_client_missing",
      httpStatus: 503,
      clientError: "daily_token_failed",
    });
  }
  const issuedAtMs = Date.now();
  const tokenExpiresAt = issuedAtMs + ttlSeconds * 1000;
  await enforceProviderRateLimit(reliabilityClient, providerRateLimitConfig("daily", "meeting_token"));
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
    operation: "snapshot_token",
    timeoutMs: providerFetchTimeoutMs("daily", "snapshot_token"),
  });

  if (response.status === 429 && retries > 0) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers, 30);
    if (retryAfterSeconds <= DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      return createMeetingToken(roomName, userId, ttlSeconds, retries - 1);
    }
  }

  if (response.status === 429) {
    throw new SnapshotDailyTokenError({
      message: "daily_token_provider_rate_limited",
      httpStatus: 429,
      retryAfterSeconds: parseRetryAfterSeconds(response.headers, 30),
      providerStatus: response.status,
      clientError: "provider_rate_limited",
    });
  }

  if (!response.ok) {
    const providerStatus = response.status;
    console.error(JSON.stringify({
      event: "video_date_snapshot_daily_token_failed",
      provider_status: providerStatus,
      room_name: roomName,
    }));
    throw new SnapshotDailyTokenError({
      message: "daily_token_failed",
      httpStatus: 503,
      providerStatus,
      clientError: "daily_token_failed",
    });
  }

  const payload = await response.json().catch(() => null) as { token?: unknown } | null;
  if (typeof payload?.token !== "string" || !payload.token) {
    throw new SnapshotDailyTokenError({
      message: "daily_token_invalid_response",
      httpStatus: 503,
      clientError: "daily_token_failed",
    });
  }
  return { token: payload.token, tokenExpiresAt };
}

function snapshotTokenFailureStatus(error: unknown): number {
  if (error instanceof SnapshotDailyTokenError) return error.httpStatus;
  if (error instanceof ProviderRateLimitError) return 429;
  return 503;
}

function snapshotTokenFailureRetryAfter(error: unknown): number | null {
  if (error instanceof SnapshotDailyTokenError) return error.retryAfterSeconds;
  if (error instanceof ProviderRateLimitError) return error.retryAfterSeconds;
  if (snapshotTokenFailureStatus(error) === 429) return providerFailureRetryAfter(error, 30);
  return null;
}

function snapshotTokenFailureClientError(error: unknown): string {
  if (error instanceof SnapshotDailyTokenError) return error.clientError;
  if (error instanceof ProviderRateLimitError) return error.clientError;
  return "daily_token_failed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ ok: false, error: "not_authenticated" }, 401);
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
    return jsonResponse({ ok: false, error: "not_authenticated" }, 401);
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const sessionId = typeof body?.session_id === "string"
    ? body.session_id
    : typeof body?.sessionId === "string"
      ? body.sessionId
      : null;
  const includeToken = body?.include_token !== false && body?.includeToken !== false;
  if (!sessionId) {
    return jsonResponse({ ok: false, error: "missing_session_id" }, 400);
  }
  if (!UUID_PATTERN.test(sessionId)) {
    return jsonResponse({ ok: false, error: "invalid_session_id" }, 400);
  }

  const { data, error } = await supabase.rpc("get_video_date_snapshot_core", {
    p_session_id: sessionId,
  });
  if (error) {
    console.error(JSON.stringify({
      event: "video_date_snapshot_core_failed",
      session_id: sessionId,
      user_id: user.id,
      code: error.code,
    }));
    return jsonResponse({ ok: false, error: "snapshot_core_failed", retryable: true }, 503);
  }

  const snapshot = data as SnapshotPayload | null;
  if (!snapshot?.ok) {
    return jsonResponse(snapshot ?? { ok: false, error: "snapshot_not_found" }, errorStatus(snapshot?.error));
  }

  const phase = typeof snapshot.phase === "string" ? snapshot.phase : null;
  const roomName = snapshot.room?.name ?? null;
  if (phase !== "handshake" && phase !== "date") {
    return jsonResponse(withoutToken(snapshot));
  }
  if (!includeToken) {
    return jsonResponse(withoutToken(snapshot));
  }
  if (!roomName) {
    return jsonResponse(withoutToken(snapshot));
  }

  try {
    const phaseBoundedTokens = await isClientFeatureFlagEnabled(
      supabase,
      "video_date.daily_token_refresh_v2",
      user.id,
    );
    const tokenWindow = resolveSnapshotTokenWindow(snapshot, Date.now(), phaseBoundedTokens);
    const tokenResult = await createMeetingToken(roomName, user.id, tokenWindow.ttlSeconds);
    return jsonResponse({
      ...snapshot,
      room: {
        ...snapshot.room,
        token: tokenResult.token,
        tokenExpiresAt: tokenResult.tokenExpiresAt,
        tokenTtlSeconds: tokenWindow.ttlSeconds,
        tokenExpiryReason: tokenWindow.reason,
      },
    });
  } catch (tokenError) {
    const status = snapshotTokenFailureStatus(tokenError);
    const retryAfterSeconds = snapshotTokenFailureRetryAfter(tokenError);
    const clientError = snapshotTokenFailureClientError(tokenError);
    console.error(JSON.stringify({
      event: "video_date_snapshot_token_issue_failed",
      session_id: sessionId,
      user_id: user.id,
      room_name: roomName,
      provider_status: tokenError instanceof SnapshotDailyTokenError ? tokenError.providerStatus : null,
      provider_code: providerFailureCode(tokenError),
      retry_after_seconds: retryAfterSeconds,
      error: providerFailureMessage(tokenError),
    }));
    return jsonResponse({
      ok: false,
      error: clientError,
      retryable: true,
      ...retryAfterJsonFields(retryAfterSeconds),
    }, status, retryAfterSeconds);
  }
});
