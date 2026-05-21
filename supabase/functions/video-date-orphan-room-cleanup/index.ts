// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DAILY_API_URL = "https://api.daily.co/v1";
const VIDEO_DATE_ROOM_RE = /^date-[0-9a-f]{32}$/;
const RECENT_ORPHAN_GRACE_MS = 15 * 60 * 1000;
const TERMINAL_DB_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_ROOM_LIST_MAX_PAGES = 10;

type SupabaseRpcError = { code?: string; message: string };
type SupabaseQueryResult<T> = {
  data: T[] | null;
  error: SupabaseRpcError | null;
};
type SupabaseUpdateResult = { error: SupabaseRpcError | null };
type SupabaseVideoSessionsTable = {
  select: (columns: string) => {
    in: (
      column: string,
      values: string[],
    ) => Promise<SupabaseQueryResult<SessionRoomRow>>;
  };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: unknown) => {
      eq: (
        column: string,
        value: unknown,
      ) => Promise<SupabaseUpdateResult>;
    };
  };
};
type SupabaseServiceClient = {
  from: (tableName: "video_sessions") => SupabaseVideoSessionsTable;
  rpc: (
    functionName: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseRpcError | null }>;
};

type WorkerRequest = {
  batch_size?: number;
  max_pages?: number;
  dry_run?: boolean;
  source?: string;
};

type DailyRoom = {
  id: string | null;
  name: string;
  createdAt: string | null;
  createdAtMs: number | null;
  expiresAt: string | null;
  expiresAtMs: number | null;
};

type DailyPresenceCheck =
  | { ok: true; exists: true; activeCount: number }
  | { ok: true; exists: false; activeCount: 0 }
  | {
    ok: false;
    status: number | null;
    providerCode: string | null;
    reason: string;
  };

type SessionRoomRow = {
  id: string;
  daily_room_name: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
};

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
  return safeEqual(authHeader, `Bearer ${cronSecret}`) ||
    safeEqual(cronHeader, cronSecret);
}

async function parseBody(req: Request): Promise<WorkerRequest> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      batch_size: typeof parsed.batch_size === "number"
        ? parsed.batch_size
        : undefined,
      max_pages: typeof parsed.max_pages === "number"
        ? parsed.max_pages
        : undefined,
      dry_run: parsed.dry_run === true,
      source: typeof parsed.source === "string"
        ? parsed.source.slice(0, 80)
        : undefined,
    };
  } catch {
    return {};
  }
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseProviderTime(value: unknown): {
  iso: string | null;
  ms: number | null;
} {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 10_000_000_000
      ? Math.trunc(value)
      : Math.trunc(value * 1000);
    return { iso: new Date(ms).toISOString(), ms };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      const ms = numeric > 10_000_000_000
        ? Math.trunc(numeric)
        : Math.trunc(numeric * 1000);
      return { iso: new Date(ms).toISOString(), ms };
    }
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return { iso: new Date(ms).toISOString(), ms };
  }

  return { iso: null, ms: null };
}

function parseDailyRoom(raw: unknown): DailyRoom | null {
  const room = asObject(raw);
  const name = asString(room?.name);
  if (!room || !name || !VIDEO_DATE_ROOM_RE.test(name)) return null;

  const config = asObject(room.config);
  const created = parseProviderTime(
    room.created_at_time ?? room.created_at ?? room.createdAt ?? room.created,
  );
  const exp = parseProviderTime(config?.exp ?? room.exp);

  return {
    id: asString(room.id),
    name,
    createdAt: created.iso,
    createdAtMs: created.ms,
    expiresAt: exp.iso,
    expiresAtMs: exp.ms,
  };
}

function dailyHeaders(): HeadersInit | null {
  const dailyApiKey = Deno.env.get("DAILY_API_KEY")?.trim();
  if (!dailyApiKey) return null;
  return { Authorization: `Bearer ${dailyApiKey}` };
}

function providerCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

async function readProviderCode(res: Response): Promise<string | null> {
  const text = await res.clone().text().catch(() => "");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return (
      providerCode(parsed.code) ??
        providerCode(parsed.error_code) ??
        providerCode(parsed.error) ??
        providerCode(parsed.info) ??
        providerCode(parsed.message)
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

async function listDailyVideoDateRooms(
  limit: number,
  maxPages: number,
): Promise<DailyRoom[]> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");

  const rooms: DailyRoom[] = [];
  let endingBefore: string | null = null;
  let pagesScanned = 0;

  while (rooms.length < limit && pagesScanned < maxPages) {
    const pageLimit = 100;
    const url = new URL(`${DAILY_API_URL}/rooms`);
    url.searchParams.set("limit", String(pageLimit));
    if (endingBefore) url.searchParams.set("ending_before", endingBefore);

    const res = await fetch(url.toString(), { method: "GET", headers });
    pagesScanned += 1;
    if (!res.ok) {
      const code = await readProviderCode(res);
      throw new Error(
        `daily_room_list_failed:${res.status}:${code ?? "unknown"}`,
      );
    }

    const body = await res.json().catch(() => null) as
      | { data?: unknown }
      | null;
    const data = Array.isArray(body?.data) ? body.data : [];
    if (data.length === 0) break;

    for (const raw of data) {
      const parsed = parseDailyRoom(raw);
      if (parsed) rooms.push(parsed);
      if (rooms.length >= limit) break;
    }

    const last = asObject(data[data.length - 1]);
    const lastId = asString(last?.id);
    if (!lastId || data.length < pageLimit) break;
    endingBefore = lastId;
  }

  return rooms;
}

async function getDailyRoomPresence(
  roomName: string,
  retries = 2,
): Promise<DailyPresenceCheck> {
  const headers = dailyHeaders();
  if (!headers) {
    return {
      ok: false,
      status: null,
      providerCode: null,
      reason: "daily_api_key_missing",
    };
  }

  try {
    const res = await fetch(
      `${DAILY_API_URL}/rooms/${
        encodeURIComponent(roomName)
      }/presence?limit=100`,
      { method: "GET", headers },
    );

    if (res.status === 404) return { ok: true, exists: false, activeCount: 0 };
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

    const body = await res.json().catch(() => null) as {
      total_count?: unknown;
      data?: unknown;
    } | null;
    const activeCount =
      typeof body?.total_count === "number" && Number.isFinite(body.total_count)
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
    return {
      ok: false,
      status: null,
      providerCode: null,
      reason: "network_error",
    };
  }
}

async function deleteDailyRoom(roomName: string): Promise<boolean> {
  const headers = dailyHeaders();
  if (!headers) return false;

  const res = await fetch(
    `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`,
    {
      method: "DELETE",
      headers,
    },
  ).catch(() => null);

  return Boolean(res && (res.ok || res.status === 404));
}

function isTerminalSession(row: SessionRoomRow | null): boolean {
  return Boolean(
    row && (row.ended_at || row.state === "ended" || row.phase === "ended"),
  );
}

function terminalAgeOk(row: SessionRoomRow | null, nowMs: number): boolean {
  if (!row?.ended_at) return row?.state === "ended" || row?.phase === "ended";
  const endedMs = Date.parse(row.ended_at);
  return Number.isFinite(endedMs) && nowMs - endedMs >= TERMINAL_DB_GRACE_MS;
}

function isExpired(room: DailyRoom, nowMs: number): boolean {
  return room.expiresAtMs != null && room.expiresAtMs <= nowMs;
}

function isOldEnoughOrphan(room: DailyRoom, nowMs: number): boolean {
  if (isExpired(room, nowMs)) return true;
  return room.createdAtMs != null &&
    nowMs - room.createdAtMs >= RECENT_ORPHAN_GRACE_MS;
}

async function fetchSessionsByRoom(
  supabase: SupabaseServiceClient,
  roomNames: string[],
): Promise<Map<string, SessionRoomRow>> {
  if (roomNames.length === 0) return new Map();
  const { data, error } = await supabase
    .from("video_sessions")
    .select("id,daily_room_name,ended_at,state,phase")
    .in("daily_room_name", roomNames);

  if (error) throw new Error(`video_session_lookup_failed:${error.message}`);

  const map = new Map<string, SessionRoomRow>();
  for (const row of (data ?? []) as SessionRoomRow[]) {
    if (!row.daily_room_name) continue;
    const existing = map.get(row.daily_room_name);
    if (!existing || (!isTerminalSession(row) && isTerminalSession(existing))) {
      map.set(row.daily_room_name, row);
    }
  }
  return map;
}

async function recordAudit(
  supabase: SupabaseServiceClient,
  params: {
    room: DailyRoom;
    session: SessionRoomRow | null;
    action: string;
    reason: string;
    activeCount: number;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await supabase.rpc(
    "record_video_date_orphan_room_cleanup_audit_v2",
    {
      p_room_name: params.room.name,
      p_action: params.action,
      p_reason: params.reason,
      p_session_id: params.session?.id ?? null,
      p_provider_room_id: params.room.id,
      p_provider_created_at: params.room.createdAt,
      p_provider_expires_at: params.room.expiresAt,
      p_active_participant_count: params.activeCount,
      p_metadata: params.metadata ?? {},
    },
  );

  if (error) {
    console.error(
      "video-date-orphan-room-cleanup audit_error",
      JSON.stringify({
        roomName: params.room.name,
        action: params.action,
        reason: params.reason,
        code: error.code,
        message: error.message,
      }),
    );
    return false;
  }
  return true;
}

async function clearTerminalRoomMetadata(
  supabase: SupabaseServiceClient,
  session: SessionRoomRow | null,
  roomName: string,
): Promise<void> {
  if (!session?.id || !isTerminalSession(session)) return;
  const { error } = await supabase
    .from("video_sessions")
    .update({ daily_room_name: null, daily_room_url: null })
    .eq("id", session.id)
    .eq("daily_room_name", roomName);

  if (error) {
    console.error(
      "video-date-orphan-room-cleanup clear_metadata_error",
      JSON.stringify({
        sessionId: session.id,
        roomName,
        code: error.code,
        message: error.message,
      }),
    );
  }
}

function createServiceClient(): SupabaseServiceClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("supabase_service_env_missing");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseServiceClient;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!authOk(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  const body = await parseBody(req);
  const batchSize = boundedInt(body.batch_size, 100, 1, 300);
  const maxPages = boundedInt(
    body.max_pages,
    DEFAULT_ROOM_LIST_MAX_PAGES,
    1,
    50,
  );
  const dryRun = body.dry_run === true;
  const nowMs = Date.now();
  try {
    const supabase = createServiceClient();
    const rooms = await listDailyVideoDateRooms(batchSize, maxPages);
    const sessions = await fetchSessionsByRoom(
      supabase,
      rooms.map((room) => room.name),
    );

    let deleted = 0;
    let dryRunDelete = 0;
    let skippedActive = 0;
    let skippedRecent = 0;
    let skippedUnknown = 0;
    let deleteFailed = 0;

    for (const room of rooms) {
      const session = sessions.get(room.name) ?? null;
      const knownActive = Boolean(session && !isTerminalSession(session));
      const terminalKnown = isTerminalSession(session);
      const missingFromDb = session == null;

      if (knownActive) {
        skippedActive += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_active",
          reason: "active_db_session",
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun },
        });
        continue;
      }

      if (terminalKnown && !terminalAgeOk(session, nowMs)) {
        skippedRecent += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_recent",
          reason: "terminal_grace_window",
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun },
        });
        continue;
      }

      if (missingFromDb && !isOldEnoughOrphan(room, nowMs)) {
        skippedRecent += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_recent",
          reason: "orphan_grace_window",
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun },
        });
        continue;
      }

      if (
        missingFromDb && room.createdAtMs == null && room.expiresAtMs == null
      ) {
        skippedUnknown += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_unknown",
          reason: "provider_room_age_unknown",
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun },
        });
        continue;
      }

      const presence = await getDailyRoomPresence(room.name);
      if (!presence.ok) {
        skippedUnknown += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_unknown",
          reason: presence.reason,
          activeCount: 0,
          metadata: {
            source: body.source ?? "manual",
            dryRun,
            providerStatus: presence.status,
            providerCode: presence.providerCode,
          },
        });
        continue;
      }

      if (presence.exists && presence.activeCount > 0) {
        skippedActive += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "skipped_active",
          reason: "provider_presence_active",
          activeCount: presence.activeCount,
          metadata: { source: body.source ?? "manual", dryRun },
        });
        continue;
      }

      const reason = terminalKnown
        ? "terminal_db_session"
        : "missing_db_session";
      if (dryRun) {
        dryRunDelete += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "dry_run_delete",
          reason,
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun: true },
        });
        continue;
      }

      const candidateAudited = await recordAudit(supabase, {
        room,
        session,
        action: "delete_candidate",
        reason,
        activeCount: 0,
        metadata: { source: body.source ?? "manual", dryRun: false },
      });
      if (!candidateAudited) {
        skippedUnknown += 1;
        continue;
      }

      const removed = await deleteDailyRoom(room.name);
      if (!removed) {
        deleteFailed += 1;
        await recordAudit(supabase, {
          room,
          session,
          action: "delete_failed",
          reason,
          activeCount: 0,
          metadata: { source: body.source ?? "manual", dryRun: false },
        });
        continue;
      }

      deleted += 1;
      await clearTerminalRoomMetadata(supabase, session, room.name);
      await recordAudit(supabase, {
        room,
        session,
        action: "deleted",
        reason,
        activeCount: 0,
        metadata: { source: body.source ?? "manual", dryRun: false },
      });
    }

    return json({
      ok: true,
      scanned: rooms.length,
      deleted,
      dryRunDelete,
      skippedActive,
      skippedRecent,
      skippedUnknown,
      deleteFailed,
      dryRun,
      maxPages,
    });
  } catch (error) {
    console.error(
      "video-date-orphan-room-cleanup worker_error",
      JSON.stringify({
        message: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    return json({ ok: false, error: "cleanup_failed" }, 500);
  }
});
