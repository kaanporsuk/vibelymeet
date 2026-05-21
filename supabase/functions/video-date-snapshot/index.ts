import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMeetingTokenProperties } from "../daily-room/dailyRoomContracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")?.trim() ?? "";
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_TTL_SECONDS = 15 * 60;
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
    token?: never;
  } | null;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

async function createMeetingToken(roomName: string, userId: string): Promise<{
  token: string;
  tokenExpiresAt: number;
}> {
  if (!DAILY_API_KEY) {
    throw new Error("daily_api_key_missing");
  }
  const issuedAtMs = Date.now();
  const tokenExpiresAt = issuedAtMs + DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_TTL_SECONDS * 1000;
  const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      properties: buildMeetingTokenProperties({
        roomName,
        userId,
        ttlSeconds: DAILY_VIDEO_DATE_SNAPSHOT_TOKEN_TTL_SECONDS,
        nowSeconds: Math.floor(issuedAtMs / 1000),
        ejectAtTokenExp: true,
      }),
    }),
  });

  if (!response.ok) {
    const providerStatus = response.status;
    console.error(JSON.stringify({
      event: "video_date_snapshot_daily_token_failed",
      provider_status: providerStatus,
      room_name: roomName,
    }));
    throw new Error("daily_token_failed");
  }

  const payload = await response.json().catch(() => null) as { token?: unknown } | null;
  if (typeof payload?.token !== "string" || !payload.token) {
    throw new Error("daily_token_invalid_response");
  }
  return { token: payload.token, tokenExpiresAt };
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
    return jsonResponse(snapshot);
  }
  if (!includeToken) {
    return jsonResponse(snapshot);
  }
  if (!roomName) {
    return jsonResponse(snapshot);
  }

  try {
    const tokenResult = await createMeetingToken(roomName, user.id);
    return jsonResponse({
      ...snapshot,
      room: {
        ...snapshot.room,
        token: tokenResult.token,
        tokenExpiresAt: tokenResult.tokenExpiresAt,
      },
    });
  } catch (tokenError) {
    console.error(JSON.stringify({
      event: "video_date_snapshot_token_issue_failed",
      session_id: sessionId,
      user_id: user.id,
      room_name: roomName,
      error: tokenError instanceof Error ? tokenError.message : "unknown",
    }));
    return jsonResponse({ ok: false, error: "daily_token_failed", retryable: true }, 503);
  }
});
