import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  captureVideoDateProviderException,
  enforceProviderRateLimit,
  fetchWithTimeout,
  logVideoDateProviderFailure,
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_API_URL = "https://api.daily.co/v1";
const DELETE_GRACE_MS = 45_000;
const CLEANUP_PROVIDER_RETRIES = numericEnv("VIDEO_DATE_ROOM_CLEANUP_PROVIDER_RETRIES", 2, 0, 5);
const CLEANUP_MAX_RETRY_SLEEP_SECONDS = numericEnv("VIDEO_DATE_ROOM_CLEANUP_MAX_RETRY_SLEEP_SECONDS", 5, 0, 30);

type VideoDateCleanupRow = {
  id: string;
  daily_room_name: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  date_started_at: string | null;
  participant_1_joined_at: string | null;
  participant_2_joined_at: string | null;
  state: string | null;
  phase: string | null;
};

type DailyPresenceCheck =
  | { ok: true; exists: true; activeCount: number }
  | { ok: true; exists: false; activeCount: 0 }
  | { ok: false; status: number | null; providerCode: string | null; reason: string; retryAfterSeconds: number | null };

type DailyProviderFetchFailure = {
  ok: false;
  status: number | null;
  providerCode: string | null;
  reason: string;
  retryAfterSeconds: number | null;
};

type DailyProviderFetchSuccess = {
  ok: true;
  response: Response;
};

type DailyProviderFetchResult = DailyProviderFetchSuccess | DailyProviderFetchFailure;

type DailyRoomDeleteResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; providerCode: string | null; reason: string; retryAfterSeconds: number | null };

type CleanupSingleSelectBuilder = {
  maybeSingle(): PromiseLike<{ data: { id?: string } | null; error: unknown }>;
};

type CleanupUpdateBuilder = {
  eq(column: string, value: string | null): CleanupUpdateBuilder;
  select(columns: string): CleanupSingleSelectBuilder;
};

type CleanupSupabaseClient = {
  rpc(functionName: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from(table: "video_sessions"): {
    update(values: { daily_room_name: null; daily_room_url: null }): CleanupUpdateBuilder;
  };
};

function toSafeProviderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

async function readProviderCode(res: Response): Promise<string | null> {
  const text = await res.clone().text().catch(() => "");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      code?: unknown;
      error_code?: unknown;
      error?: unknown;
      info?: unknown;
      message?: unknown;
    };
    return (
      toSafeProviderCode(parsed.code) ??
      toSafeProviderCode(parsed.error_code) ??
      toSafeProviderCode(parsed.error) ??
      toSafeProviderCode(parsed.info) ??
      toSafeProviderCode(parsed.message)
    );
  } catch {
    return null;
  }
}

function providerFailureReason(status: number | null): string {
  if (status == null) return "network_error";
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_check_rejected";
}

function jsonHeaders(retryAfterSeconds?: number | null): Record<string, string> {
  const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)) {
    headers["Retry-After"] = String(Math.min(300, Math.max(1, Math.ceil(retryAfterSeconds))));
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedRetryDelaySeconds(headers: Headers | null | undefined, fallback: number): number {
  return Math.min(300, Math.max(1, parseRetryAfterSeconds(headers, fallback)));
}

function shouldRetryProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchDailyProvider(
  supabase: CleanupSupabaseClient,
  params: {
    operation: "room_presence" | "room_delete";
    bucket: "room_lookup" | "room_delete";
    url: string;
    init: RequestInit;
    roomName: string;
  },
  retries = CLEANUP_PROVIDER_RETRIES,
): Promise<DailyProviderFetchResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await enforceProviderRateLimit(supabase, providerRateLimitConfig("daily", params.bucket));
      const response = await fetchWithTimeout(params.url, params.init, {
        provider: "daily",
        operation: params.operation,
        timeoutMs: providerFetchTimeoutMs("daily", params.operation),
        retryAfterSeconds: 30,
      });
      if (shouldRetryProviderStatus(response.status) && attempt < retries) {
        const retryAfterSeconds = boundedRetryDelaySeconds(response.headers, attempt + 1);
        if (retryAfterSeconds <= CLEANUP_MAX_RETRY_SLEEP_SECONDS) {
          await sleep(retryAfterSeconds * 1000);
          continue;
        }
      }
      return { ok: true, response };
    } catch (error) {
      const code = providerFailureCode(error);
      const rateLimited = error instanceof ProviderRateLimitError || code === "provider_rate_limited";
      const retryAfterSeconds = rateLimited
        ? providerFailureRetryAfter(error, 30)
        : Math.min(CLEANUP_MAX_RETRY_SLEEP_SECONDS || 1, Math.max(1, attempt + 1));
      if (attempt < retries && retryAfterSeconds <= CLEANUP_MAX_RETRY_SLEEP_SECONDS) {
        await sleep(retryAfterSeconds * 1000);
        continue;
      }
      await captureVideoDateProviderException(error, {
        provider: "daily",
        operation: params.operation,
        room_name: params.roomName,
        provider_code: code,
        retry_after_seconds: rateLimited ? retryAfterSeconds : null,
      });
      return {
        ok: false,
        status: rateLimited ? 429 : null,
        providerCode: code,
        reason: rateLimited ? "provider_rate_limited" : providerFailureMessage(error),
        retryAfterSeconds: rateLimited ? retryAfterSeconds : null,
      };
    }
  }
  return { ok: false, status: null, providerCode: null, reason: "network_error", retryAfterSeconds: null };
}

async function getDailyRoomPresence(
  supabase: CleanupSupabaseClient,
  roomName: string,
): Promise<DailyPresenceCheck> {
  const result = await fetchDailyProvider(supabase, {
    operation: "room_presence",
    bucket: "room_lookup",
    url: `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}/presence?limit=100`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    },
    roomName,
  });

  if (!result.ok) return result;

  const res = result.response;
  if (res.status === 404) {
    return { ok: true, exists: false, activeCount: 0 };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      providerCode: await readProviderCode(res),
      reason: providerFailureReason(res.status),
      retryAfterSeconds: res.status === 429 ? parseRetryAfterSeconds(res.headers, 30) : null,
    };
  }

  const body = (await res.json().catch(() => null)) as {
    total_count?: unknown;
    data?: unknown;
  } | null;
  const activeCount = typeof body?.total_count === "number" && Number.isFinite(body.total_count)
    ? body.total_count
    : Array.isArray(body?.data)
      ? body.data.length
      : null;
  if (activeCount == null) {
    return {
      ok: false,
      status: res.status,
      providerCode: null,
      reason: "provider_presence_response_malformed",
      retryAfterSeconds: null,
    };
  }
  return { ok: true, exists: true, activeCount: Math.max(0, activeCount) };
}

async function deleteDailyRoom(
  supabase: CleanupSupabaseClient,
  roomName: string,
): Promise<DailyRoomDeleteResult> {
  const result = await fetchDailyProvider(supabase, {
    operation: "room_delete",
    bucket: "room_delete",
    url: `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`,
    init: {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    },
    roomName,
  });

  if (!result.ok) return result;

  const res = result.response;
  if (res.ok || res.status === 404) return { ok: true, status: res.status };
  return {
    ok: false,
    status: res.status,
    providerCode: await readProviderCode(res),
    reason: providerFailureReason(res.status),
    retryAfterSeconds: res.status === 429 ? parseRetryAfterSeconds(res.headers, 30) : null,
  };
}

function mergeRetryAfter(current: number | null, next: number | null | undefined): number | null {
  if (typeof next !== "number" || !Number.isFinite(next)) return current;
  const sanitized = Math.min(300, Math.max(1, Math.ceil(next)));
  return current == null ? sanitized : Math.max(current, sanitized);
}

function providerFailureIsRateLimited(input: { status: number | null; reason: string }): boolean {
  return input.status === 429 || input.reason === "provider_rate_limited";
}

async function logCleanupProviderFailure(
  supabase: CleanupSupabaseClient,
  params: {
    sessionId: string;
    operation: "room_presence" | "room_delete";
    status: number | null;
    providerCode: string | null;
    reason: string;
    retryAfterSeconds: number | null;
  },
): Promise<void> {
  await logVideoDateProviderFailure(supabase, {
    targetKind: "provider",
    sessionId: params.sessionId,
    provider: "daily",
    operation: params.operation,
    errorCode: params.providerCode ?? params.reason,
    errorMessage: params.reason,
    retryAfterSeconds: params.retryAfterSeconds,
    permanent: params.reason === "provider_auth_failed",
    metadata: {
      provider_status: params.status,
    },
  });
}

async function markRoomCleaned(
  supabase: CleanupSupabaseClient,
  sessionId: string,
  roomName: string,
  endedAt: string | null,
): Promise<boolean> {
  if (!endedAt) return false;
  const { data, error } = await supabase
    .from("video_sessions")
    .update({ daily_room_name: null, daily_room_url: null })
    .eq("id", sessionId)
    .eq("daily_room_name", roomName)
    .eq("ended_at", endedAt)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("video-date-room-cleanup update:", error);
    return false;
  }
  return Boolean(data?.id);
}

function hasTerminalCleanupState(row: VideoDateCleanupRow): boolean {
  return Boolean(row.ended_at) && (row.state === "ended" || row.phase === "ended");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Short buffer after ended_at avoids racing with clients still tearing down.
  // Destructive cleanup still checks Daily presence before deleting.
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - DELETE_GRACE_MS).toISOString();

  const { data: rows, error } = await supabase
    .from("video_sessions")
    .select(
      "id, daily_room_name, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, state, phase",
    )
    .not("ended_at", "is", null)
    .not("daily_room_name", "is", null)
    .lte("ended_at", cutoffIso)
    .order("ended_at", { ascending: true })
    .limit(40);

  if (error) {
    console.error("video-date-room-cleanup query:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let deleted = 0;
  let alreadyCleaned = 0;
  let deferredActiveParticipants = 0;
  let deferredProviderCheckFailed = 0;
  let deferredUnsafeState = 0;
  let deleteFailed = 0;
  let providerRateLimited = 0;
  let retryAfterSeconds: number | null = null;
  for (const row of (rows ?? []) as VideoDateCleanupRow[]) {
    const name = row.daily_room_name;
    const endedAt = row.ended_at;
    if (!name) continue;
    const endedAtMs = endedAt ? new Date(endedAt).getTime() : Number.NaN;
    const ageMs = Number.isFinite(endedAtMs) ? nowMs - endedAtMs : 0;

    if (!hasTerminalCleanupState(row)) {
      deferredUnsafeState++;
      console.log(
        JSON.stringify({
          event: "cleanup_deferred_non_terminal_state",
          session_id: row.id,
          room_name: name,
          state: row.state,
          phase: row.phase,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          date_started_at: row.date_started_at,
          participant_1_joined_at: row.participant_1_joined_at,
          participant_2_joined_at: row.participant_2_joined_at,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    const presence = await getDailyRoomPresence(supabase, name);
    if (presence.ok && !presence.exists) {
      const marked = await markRoomCleaned(supabase, row.id, name, endedAt);
      if (marked) alreadyCleaned++;
      console.log(
        JSON.stringify({
          event: "cleanup_room_not_found",
          session_id: row.id,
          room_name: name,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    if (presence.ok && presence.activeCount > 0) {
      deferredActiveParticipants++;
      console.log(
        JSON.stringify({
          event: "cleanup_deferred_active_participants",
          session_id: row.id,
          room_name: name,
          active_count: presence.activeCount,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          date_started_at: row.date_started_at,
          participant_1_joined_at: row.participant_1_joined_at,
          participant_2_joined_at: row.participant_2_joined_at,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    if (!presence.ok) {
      deferredProviderCheckFailed++;
      if (providerFailureIsRateLimited(presence)) {
        providerRateLimited++;
        retryAfterSeconds = mergeRetryAfter(retryAfterSeconds, presence.retryAfterSeconds);
      }
      await logCleanupProviderFailure(supabase, {
        sessionId: row.id,
        operation: "room_presence",
        status: presence.status,
        providerCode: presence.providerCode,
        reason: presence.reason,
        retryAfterSeconds: presence.retryAfterSeconds,
      });
      console.log(
        JSON.stringify({
          event: "cleanup_deferred_provider_check_failed",
          session_id: row.id,
          room_name: name,
          provider_status: presence.status,
          providerCode: presence.providerCode,
          reason: presence.reason,
          retry_after_seconds: presence.retryAfterSeconds,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    const finalPresence = await getDailyRoomPresence(supabase, name);
    if (finalPresence.ok && !finalPresence.exists) {
      const marked = await markRoomCleaned(supabase, row.id, name, endedAt);
      if (marked) alreadyCleaned++;
      console.log(
        JSON.stringify({
          event: "cleanup_room_not_found_second_check",
          session_id: row.id,
          room_name: name,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    if (finalPresence.ok && finalPresence.activeCount > 0) {
      deferredActiveParticipants++;
      console.log(
        JSON.stringify({
          event: "cleanup_delete_aborted_active_participants_second_check",
          session_id: row.id,
          room_name: name,
          active_count: finalPresence.activeCount,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    if (!finalPresence.ok) {
      deferredProviderCheckFailed++;
      if (providerFailureIsRateLimited(finalPresence)) {
        providerRateLimited++;
        retryAfterSeconds = mergeRetryAfter(retryAfterSeconds, finalPresence.retryAfterSeconds);
      }
      await logCleanupProviderFailure(supabase, {
        sessionId: row.id,
        operation: "room_presence",
        status: finalPresence.status,
        providerCode: finalPresence.providerCode,
        reason: finalPresence.reason,
        retryAfterSeconds: finalPresence.retryAfterSeconds,
      });
      console.log(
        JSON.stringify({
          event: "cleanup_deferred_provider_second_check_failed",
          session_id: row.id,
          room_name: name,
          provider_status: finalPresence.status,
          providerCode: finalPresence.providerCode,
          reason: finalPresence.reason,
          retry_after_seconds: finalPresence.retryAfterSeconds,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    const deleteResult = await deleteDailyRoom(supabase, name);
    if (deleteResult.ok) {
      // Clear the room reference so this row is not re-processed.
      const marked = await markRoomCleaned(supabase, row.id, name, endedAt);
      if (marked) deleted++;
    } else {
      deleteFailed++;
      if (providerFailureIsRateLimited(deleteResult)) {
        providerRateLimited++;
        retryAfterSeconds = mergeRetryAfter(retryAfterSeconds, deleteResult.retryAfterSeconds);
      }
      await logCleanupProviderFailure(supabase, {
        sessionId: row.id,
        operation: "room_delete",
        status: deleteResult.status,
        providerCode: deleteResult.providerCode,
        reason: deleteResult.reason,
        retryAfterSeconds: deleteResult.retryAfterSeconds,
      });
      console.log(
        JSON.stringify({
          event: "cleanup_delete_failed",
          session_id: row.id,
          room_name: name,
          provider_status: deleteResult.status,
          providerCode: deleteResult.providerCode,
          reason: deleteResult.reason,
          retry_after_seconds: deleteResult.retryAfterSeconds,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      event: "video-date-room-cleanup",
      candidates: rows?.length ?? 0,
      deleted,
      already_cleaned: alreadyCleaned,
      deferred_active_participants: deferredActiveParticipants,
      deferred_provider_check_failed: deferredProviderCheckFailed,
      deferred_unsafe_state: deferredUnsafeState,
      delete_failed: deleteFailed,
      provider_rate_limited: providerRateLimited,
      retry_after_seconds: retryAfterSeconds,
    }),
  );

  const responseStatus = providerRateLimited > 0 ? 429 : 200;
  return new Response(
    JSON.stringify({
      ok: providerRateLimited === 0,
      candidates: rows?.length ?? 0,
      daily_delete_attempts: deleted,
      already_cleaned: alreadyCleaned,
      deferred_active_participants: deferredActiveParticipants,
      deferred_provider_check_failed: deferredProviderCheckFailed,
      deferred_unsafe_state: deferredUnsafeState,
      delete_failed: deleteFailed,
      provider_rate_limited: providerRateLimited,
      ...(retryAfterSeconds != null
        ? {
          retry_after_seconds: retryAfterSeconds,
          retryAfterSeconds,
        }
        : {}),
    }),
    { status: responseStatus, headers: jsonHeaders(retryAfterSeconds) },
  );
});
