import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_API_URL = "https://api.daily.co/v1";
const DELETE_GRACE_MS = 120_000;

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
  | { ok: false; status: number | null; providerCode: string | null; reason: string };

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

async function getDailyRoomPresence(roomName: string, retries = 2): Promise<DailyPresenceCheck> {
  try {
    const res = await fetch(
      `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}/presence`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
      },
    );

    if (res.status === 404) {
      return { ok: true, exists: false, activeCount: 0 };
    }
    if (res.status === 429 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (3 - retries)));
      return getDailyRoomPresence(roomName, retries - 1);
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        providerCode: await readProviderCode(res),
        reason: providerFailureReason(res.status),
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
      };
    }
    return { ok: true, exists: true, activeCount: Math.max(0, activeCount) };
  } catch {
    return { ok: false, status: null, providerCode: null, reason: "network_error" };
  }
}

async function deleteDailyRoom(roomName: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
      },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function markRoomCleaned(
  supabase: ReturnType<typeof createClient>,
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

    const presence = await getDailyRoomPresence(name);
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
      console.log(
        JSON.stringify({
          event: "cleanup_deferred_provider_check_failed",
          session_id: row.id,
          room_name: name,
          provider_status: presence.status,
          providerCode: presence.providerCode,
          reason: presence.reason,
          ended_at: endedAt,
          ended_reason: row.ended_reason,
          ended_age_ms: ageMs,
        }),
      );
      continue;
    }

    const ok = await deleteDailyRoom(name);
    if (ok) {
      // Clear the room reference so this row is not re-processed.
      const marked = await markRoomCleaned(supabase, row.id, name, endedAt);
      if (marked) deleted++;
    } else {
      deleteFailed++;
      console.log(
        JSON.stringify({
          event: "cleanup_delete_failed",
          session_id: row.id,
          room_name: name,
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
    }),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      candidates: rows?.length ?? 0,
      daily_delete_attempts: deleted,
      already_cleaned: alreadyCleaned,
      deferred_active_participants: deferredActiveParticipants,
      deferred_provider_check_failed: deferredProviderCheckFailed,
      deferred_unsafe_state: deferredUnsafeState,
      delete_failed: deleteFailed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
