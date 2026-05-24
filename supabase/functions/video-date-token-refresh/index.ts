import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMeetingTokenProperties } from "../daily-room/dailyRoomContracts.ts";
import {
  fetchWithTimeout,
  parseRetryAfterSeconds,
  ProviderRateLimitError,
  providerFetchTimeoutMs,
} from "../_shared/video-date-provider-reliability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")?.trim() ?? "";
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400;
const DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SnapshotPayload = {
  ok?: boolean;
  error?: string;
  eventId?: string | null;
  phase?: string | null;
  room?: {
    name?: string | null;
    url?: string | null;
    tokenRequired?: boolean | null;
  } | null;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function enforceTokenRefreshRateLimit(supabase: any): Promise<void> {
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

async function createMeetingToken(
  supabase: any,
  roomName: string,
  userId: string,
  retries = 1,
): Promise<{
  token: string;
  tokenExpiresAtMs: number;
  tokenExpiresAtIso: string;
}> {
  if (!DAILY_API_KEY) throw new Error("daily_api_key_missing");

  const issuedAtMs = Date.now();
  const tokenExpiresAtMs = issuedAtMs + DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS * 1000;
  await enforceTokenRefreshRateLimit(supabase);
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
        ttlSeconds: DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS,
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
    await new Promise((resolve) => setTimeout(resolve, parseRetryAfterSeconds(response.headers, 2) * 1000));
    return createMeetingToken(supabase, roomName, userId, retries - 1);
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

  if (!sessionId) return jsonResponse({ ok: false, error: "missing_session_id" }, 400);
  if (!UUID_PATTERN.test(sessionId)) return jsonResponse({ ok: false, error: "invalid_session_id" }, 400);

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
    return jsonResponse({ ok: false, error: "snapshot_core_failed", retryable: true }, 503);
  }

  const snapshot = data as SnapshotPayload | null;
  if (!snapshot?.ok) {
    const status = snapshot?.error === "not_participant" ? 403 : snapshot?.error === "session_not_found" ? 404 : 409;
    return jsonResponse(snapshot ?? { ok: false, error: "snapshot_not_found" }, status);
  }

  const phase = typeof snapshot.phase === "string" ? snapshot.phase : null;
  if (phase !== "handshake" && phase !== "date") {
    return jsonResponse({ ok: false, error: "session_not_active", phase, retryable: false }, 409);
  }

  const roomName = snapshot.room?.name ?? null;
  const roomUrl = snapshot.room?.url ?? null;
  if (!roomName || !roomUrl) {
    return jsonResponse({ ok: false, error: "room_not_ready", phase, retryable: true }, 409);
  }

  try {
    const tokenResult = await createMeetingToken(supabase, roomName, user.id);
    return jsonResponse({
      ok: true,
      session_id: sessionId,
      event_id: snapshot.eventId ?? null,
      phase,
      room_name: roomName,
      room_url: roomUrl,
      token: tokenResult.token,
      token_expires_at: tokenResult.tokenExpiresAtIso,
      tokenExpiresAt: tokenResult.tokenExpiresAtMs,
    });
  } catch (tokenError) {
    if (tokenError instanceof ProviderRateLimitError) {
      return jsonResponse({
        ok: false,
        error: tokenError.clientError,
        retryable: true,
        retry_after_seconds: tokenError.retryAfterSeconds,
        retryAfterSeconds: tokenError.retryAfterSeconds,
      }, 429);
    }
    console.error(JSON.stringify({
      event: "video_date_token_refresh_failed",
      session_id: sessionId,
      user_id: user.id,
      room_name: roomName,
      error: tokenError instanceof Error ? tokenError.message : "unknown",
    }));
    return jsonResponse({ ok: false, error: "daily_token_failed", retryable: true }, 503);
  }
});
