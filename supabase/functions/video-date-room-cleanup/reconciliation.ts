// Provider-reconciliation pass for video-date-room-cleanup (cron-merge stage 1, 2026-06-13).
//
// This is the orphan-lane logic from video-date-orphan-room-cleanup transplanted verbatim per
// docs/investigations/video-date-room-cleanup-consolidation-plan.md: same room regex, same grace
// windows, same safety interlock, same double presence check, same audit actions. Deliberate
// deviations (attribution only, no behavior change):
//   * audit metadata.source is prefixed `room_cleanup:` so observation can tell this pass apart
//     from the still-running orphan cron during the 24h overlap window;
//   * terminal session stamps use `room_cleanup_reconciliation:` instead of `orphan_cleanup:`.
//
// Cadence: the pass runs at most once per RECONCILIATION_INTERVAL via a `reconciliation_run`
// marker row in video_date_orphan_room_cleanup_audit (the plan's audit-table-max option). A pass
// that fails before completing does NOT advance the marker, so the next minute-tick retries —
// bounded to one room-list call per minute worst case, and the failure stays visible in logs.

import { numericEnv } from "../_shared/video-date-provider-reliability.ts";

const DAILY_API_URL = "https://api.daily.co/v1";
const VIDEO_DATE_ROOM_RE = /^date-[0-9a-f]{32}$/;
const RECENT_ORPHAN_GRACE_MS = 15 * 60 * 1000;
const TERMINAL_DB_GRACE_MS = 2 * 60 * 1000;
const ROOM_LIST_MAX_PAGES = 10;
const DAILY_ROOM_LIST_PAGE_LIMIT = 100;
const SESSION_ROOM_LOOKUP_CHUNK_SIZE = 200;
const RECONCILIATION_BATCH_SIZE = 100;
const RECONCILIATION_INTERVAL_MS =
  numericEnv("VIDEO_DATE_ROOM_CLEANUP_RECONCILIATION_INTERVAL_SECONDS", 600, 60, 3600) * 1000;
const MARKER_ACTION = "reconciliation_run";
const MARKER_ROOM_NAME = "reconciliation-cycle";

type SupabaseRpcError = { code?: string; message: string };

type SessionRoomRow = {
  id: string;
  daily_room_name: string | null;
  daily_room_provider_deleted_at?: string | null;
  daily_room_provider_delete_reason?: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
};

type MarkerRow = { created_at: string | null };

type ReconciliationClient = {
  from(table: "video_sessions"): {
    select(columns: string): {
      in(
        column: string,
        values: string[],
      ): Promise<{ data: SessionRoomRow[] | null; error: SupabaseRpcError | null }>;
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): Promise<{ error: SupabaseRpcError | null }>;
      };
    };
  };
  from(table: "video_date_orphan_room_cleanup_audit"): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): {
            maybeSingle(): Promise<{ data: MarkerRow | null; error: SupabaseRpcError | null }>;
          };
        };
      };
    };
  };
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: SupabaseRpcError | null }>;
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
  | { ok: false; status: number | null; providerCode: string | null; reason: string };

type SafetyInterlockCheck = {
  ok: boolean;
  blocked: boolean;
  reason: string;
  delayUntil: string | null;
  pendingReportCount: number;
  safetyReviewEventCount: number;
  latestSafetyEvidenceAt: string | null;
};

export type ReconciliationCounters = {
  scanned: number;
  deleted: number;
  dryRunDelete: number;
  deleteAttempts: number;
  skippedActive: number;
  skippedRecent: number;
  skippedUnknown: number;
  skippedSafetyReview: number;
  deleteFailed: number;
};

export type ReconciliationOutcome =
  | { ran: false; reason: "not_due"; lastRunAt: string | null; nextDueAt: string | null }
  | { ran: false; reason: "marker_check_failed"; error: string }
  | {
    ran: true;
    ok: true;
    dryRun: boolean;
    forced: boolean;
    markerRecorded: boolean;
    counters: ReconciliationCounters;
  }
  | { ran: true; ok: false; forced: boolean; error: string };

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

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPositiveInteger(value: unknown): number {
  const numberValue = asNumber(value);
  return numberValue == null ? 0 : Math.max(0, Math.trunc(numberValue));
}

function parseProviderTime(value: unknown): { iso: string | null; ms: number | null } {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 10_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
    return { iso: new Date(ms).toISOString(), ms };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      const ms = numeric > 10_000_000_000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
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

async function listDailyVideoDateRooms(maxPages: number): Promise<DailyRoom[]> {
  const headers = dailyHeaders();
  if (!headers) throw new Error("daily_api_key_missing");

  const rooms: DailyRoom[] = [];
  let endingBefore: string | null = null;
  let pagesScanned = 0;

  while (pagesScanned < maxPages) {
    const url = new URL(`${DAILY_API_URL}/rooms`);
    url.searchParams.set("limit", String(DAILY_ROOM_LIST_PAGE_LIMIT));
    if (endingBefore) url.searchParams.set("ending_before", endingBefore);

    const res = await fetch(url.toString(), { method: "GET", headers });
    pagesScanned += 1;
    if (!res.ok) {
      const code = await readProviderCode(res);
      throw new Error(`daily_room_list_failed:${res.status}:${code ?? "unknown"}`);
    }

    const body = await res.json().catch(() => null) as { data?: unknown } | null;
    const data = Array.isArray(body?.data) ? body.data : [];
    if (data.length === 0) break;

    for (const raw of data) {
      const parsed = parseDailyRoom(raw);
      if (parsed) rooms.push(parsed);
    }

    const last = asObject(data[data.length - 1]);
    const lastId = asString(last?.id);
    if (!lastId || data.length < DAILY_ROOM_LIST_PAGE_LIMIT) break;
    endingBefore = lastId;
  }

  return rooms;
}

function oldestKnownRoomTime(room: DailyRoom): number {
  return room.createdAtMs ?? room.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
}

function compareDailyRoomsOldestFirst(left: DailyRoom, right: DailyRoom): number {
  const leftTime = oldestKnownRoomTime(left);
  const rightTime = oldestKnownRoomTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.name.localeCompare(right.name);
}

async function getDailyRoomPresence(roomName: string, retries = 2): Promise<DailyPresenceCheck> {
  const headers = dailyHeaders();
  if (!headers) {
    return { ok: false, status: null, providerCode: null, reason: "daily_api_key_missing" };
  }

  try {
    const res = await fetch(
      `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}/presence?limit=100`,
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
    return { ok: false, status: null, providerCode: null, reason: "network_error" };
  }
}

async function deleteDailyRoom(roomName: string): Promise<boolean> {
  const headers = dailyHeaders();
  if (!headers) return false;

  const res = await fetch(
    `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`,
    { method: "DELETE", headers },
  ).catch(() => null);

  return Boolean(res && (res.ok || res.status === 404));
}

function isTerminalSession(row: SessionRoomRow | null): boolean {
  return Boolean(row && (row.ended_at || row.state === "ended" || row.phase === "ended"));
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
  return room.createdAtMs != null && nowMs - room.createdAtMs >= RECENT_ORPHAN_GRACE_MS;
}

async function fetchSessionsByRoom(
  client: ReconciliationClient,
  roomNames: string[],
): Promise<Map<string, SessionRoomRow>> {
  if (roomNames.length === 0) return new Map();
  const map = new Map<string, SessionRoomRow>();

  for (let index = 0; index < roomNames.length; index += SESSION_ROOM_LOOKUP_CHUNK_SIZE) {
    const chunk = roomNames.slice(index, index + SESSION_ROOM_LOOKUP_CHUNK_SIZE);
    const { data, error } = await client
      .from("video_sessions")
      .select(
        "id,daily_room_name,daily_room_provider_deleted_at,daily_room_provider_delete_reason,ended_at,state,phase",
      )
      .in("daily_room_name", chunk);

    if (error) throw new Error(`video_session_lookup_failed:${error.message}`);

    for (const row of (data ?? []) as SessionRoomRow[]) {
      if (!row.daily_room_name) continue;
      const existing = map.get(row.daily_room_name);
      if (!existing || (!isTerminalSession(row) && isTerminalSession(existing))) {
        map.set(row.daily_room_name, row);
      }
    }
  }

  return map;
}

async function recordAudit(
  client: ReconciliationClient,
  params: {
    room: DailyRoom;
    session: SessionRoomRow | null;
    action: string;
    reason: string;
    activeCount: number;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await client.rpc(
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
      "video-date-room-cleanup reconciliation_audit_error",
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

function parseSafetyInterlock(value: unknown): SafetyInterlockCheck {
  const object = asObject(value);
  return {
    ok: asBoolean(object?.ok) !== false,
    blocked: asBoolean(object?.blocked) === true,
    reason: asString(object?.reason) ?? "safety_interlock_unknown",
    delayUntil: asString(object?.delayUntil),
    pendingReportCount: asPositiveInteger(object?.pendingReportCount),
    safetyReviewEventCount: asPositiveInteger(object?.safetyReviewEventCount),
    latestSafetyEvidenceAt: asString(object?.latestSafetyEvidenceAt),
  };
}

async function checkSafetyInterlock(
  client: ReconciliationClient,
  session: SessionRoomRow | null,
  roomName: string,
): Promise<SafetyInterlockCheck> {
  if (!session?.id) {
    return {
      ok: true,
      blocked: false,
      reason: "session_id_missing",
      delayUntil: null,
      pendingReportCount: 0,
      safetyReviewEventCount: 0,
      latestSafetyEvidenceAt: null,
    };
  }

  const { data, error } = await client.rpc(
    "video_date_orphan_safety_interlock_v1",
    { p_session_id: session.id, p_room_name: roomName },
  );

  if (error) {
    console.error(
      "video-date-room-cleanup reconciliation_safety_interlock_error",
      JSON.stringify({
        sessionId: session.id,
        roomName,
        code: error.code,
        message: error.message,
      }),
    );
    return {
      ok: false,
      blocked: true,
      reason: "safety_interlock_unavailable",
      delayUntil: null,
      pendingReportCount: 0,
      safetyReviewEventCount: 0,
      latestSafetyEvidenceAt: null,
    };
  }

  const parsed = parseSafetyInterlock(data);
  return parsed.ok ? parsed : { ...parsed, blocked: true };
}

async function markTerminalRoomProviderDeleted(
  client: ReconciliationClient,
  session: SessionRoomRow | null,
  roomName: string,
  reason: string,
): Promise<void> {
  if (!session?.id || !isTerminalSession(session)) return;
  const { error } = await client
    .from("video_sessions")
    .update({
      daily_room_provider_deleted_at: new Date().toISOString(),
      daily_room_provider_delete_reason: `room_cleanup_reconciliation:${reason}`.slice(0, 160),
    })
    .eq("id", session.id)
    .eq("daily_room_name", roomName);

  if (error) {
    console.error(
      "video-date-room-cleanup reconciliation_mark_provider_deleted_error",
      JSON.stringify({
        sessionId: session.id,
        roomName,
        code: error.code,
        message: error.message,
      }),
    );
  }
}

async function readLastReconciliationMs(
  client: ReconciliationClient,
): Promise<{ ok: true; lastMs: number | null } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("video_date_orphan_room_cleanup_audit")
    .select("created_at")
    .eq("action", MARKER_ACTION)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  const createdAt = data?.created_at;
  if (typeof createdAt !== "string") return { ok: true, lastMs: null };
  const ms = Date.parse(createdAt);
  return { ok: true, lastMs: Number.isFinite(ms) ? ms : null };
}

async function recordReconciliationMarker(
  client: ReconciliationClient,
  source: string,
  counters: ReconciliationCounters,
): Promise<boolean> {
  return await recordAudit(client, {
    room: {
      id: null,
      name: MARKER_ROOM_NAME,
      createdAt: null,
      createdAtMs: null,
      expiresAt: null,
      expiresAtMs: null,
    },
    session: null,
    action: MARKER_ACTION,
    reason: "scan_complete",
    activeCount: 0,
    metadata: { source: `room_cleanup:${source}`, ...counters },
  });
}

async function runReconciliationScan(
  client: ReconciliationClient,
  params: { nowMs: number; dryRun: boolean; source: string },
): Promise<ReconciliationCounters> {
  const rooms = (await listDailyVideoDateRooms(ROOM_LIST_MAX_PAGES)).sort(
    compareDailyRoomsOldestFirst,
  );
  const sessions = await fetchSessionsByRoom(client, rooms.map((room) => room.name));

  const counters: ReconciliationCounters = {
    scanned: rooms.length,
    deleted: 0,
    dryRunDelete: 0,
    deleteAttempts: 0,
    skippedActive: 0,
    skippedRecent: 0,
    skippedUnknown: 0,
    skippedSafetyReview: 0,
    deleteFailed: 0,
  };
  const metadataBase = { source: `room_cleanup:${params.source}`, dryRun: params.dryRun };

  for (const room of rooms) {
    if (counters.deleteAttempts >= RECONCILIATION_BATCH_SIZE) break;

    const session = sessions.get(room.name) ?? null;
    const knownActive = Boolean(session && !isTerminalSession(session));
    const terminalKnown = isTerminalSession(session);
    const missingFromDb = session == null;

    if (knownActive) {
      counters.skippedActive += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_active",
        reason: "active_db_session",
        activeCount: 0,
        metadata: metadataBase,
      });
      continue;
    }

    if (terminalKnown && !terminalAgeOk(session, params.nowMs)) {
      counters.skippedRecent += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_recent",
        reason: "terminal_grace_window",
        activeCount: 0,
        metadata: metadataBase,
      });
      continue;
    }

    if (missingFromDb && !isOldEnoughOrphan(room, params.nowMs)) {
      counters.skippedRecent += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_recent",
        reason: "orphan_grace_window",
        activeCount: 0,
        metadata: metadataBase,
      });
      continue;
    }

    if (missingFromDb && room.createdAtMs == null && room.expiresAtMs == null) {
      counters.skippedUnknown += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_unknown",
        reason: "provider_room_age_unknown",
        activeCount: 0,
        metadata: metadataBase,
      });
      continue;
    }

    const safetyInterlock = await checkSafetyInterlock(client, session, room.name);
    if (safetyInterlock.blocked) {
      counters.skippedSafetyReview += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_safety_review",
        reason: safetyInterlock.reason,
        activeCount: 0,
        metadata: {
          ...metadataBase,
          interlockOk: safetyInterlock.ok,
          delayUntil: safetyInterlock.delayUntil,
          pendingReportCount: safetyInterlock.pendingReportCount,
          safetyReviewEventCount: safetyInterlock.safetyReviewEventCount,
          latestSafetyEvidenceAt: safetyInterlock.latestSafetyEvidenceAt,
        },
      });
      continue;
    }

    const presence = await getDailyRoomPresence(room.name);
    if (!presence.ok) {
      counters.skippedUnknown += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_unknown",
        reason: presence.reason,
        activeCount: 0,
        metadata: {
          ...metadataBase,
          providerStatus: presence.status,
          providerCode: presence.providerCode,
        },
      });
      continue;
    }

    if (presence.exists && presence.activeCount > 0) {
      counters.skippedActive += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_active",
        reason: "provider_presence_active",
        activeCount: presence.activeCount,
        metadata: metadataBase,
      });
      continue;
    }

    const reason = terminalKnown ? "terminal_db_session" : "missing_db_session";
    if (params.dryRun) {
      counters.dryRunDelete += 1;
      counters.deleteAttempts += 1;
      await recordAudit(client, {
        room,
        session,
        action: "dry_run_delete",
        reason,
        activeCount: 0,
        metadata: { ...metadataBase, dryRun: true },
      });
      continue;
    }

    const candidateAudited = await recordAudit(client, {
      room,
      session,
      action: "delete_candidate",
      reason,
      activeCount: 0,
      metadata: metadataBase,
    });
    if (!candidateAudited) {
      counters.skippedUnknown += 1;
      continue;
    }

    const finalPresence = await getDailyRoomPresence(room.name);
    if (!finalPresence.ok) {
      counters.skippedUnknown += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_unknown",
        reason: "provider_presence_second_check_failed",
        activeCount: 0,
        metadata: {
          ...metadataBase,
          providerStatus: finalPresence.status,
          providerCode: finalPresence.providerCode,
          providerReason: finalPresence.reason,
        },
      });
      continue;
    }

    if (finalPresence.exists && finalPresence.activeCount > 0) {
      counters.skippedActive += 1;
      await recordAudit(client, {
        room,
        session,
        action: "skipped_active",
        reason: "provider_presence_active_second_check",
        activeCount: finalPresence.activeCount,
        metadata: metadataBase,
      });
      continue;
    }

    const removed = await deleteDailyRoom(room.name);
    counters.deleteAttempts += 1;
    if (!removed) {
      counters.deleteFailed += 1;
      await recordAudit(client, {
        room,
        session,
        action: "delete_failed",
        reason,
        activeCount: 0,
        metadata: metadataBase,
      });
      continue;
    }

    counters.deleted += 1;
    await markTerminalRoomProviderDeleted(client, session, room.name, reason);
    await recordAudit(client, {
      room,
      session,
      action: "deleted",
      reason,
      activeCount: 0,
      metadata: metadataBase,
    });
  }

  return counters;
}

export async function maybeRunReconciliationPass(
  supabase: unknown,
  params: { force: boolean; dryRun: boolean; source: string },
): Promise<ReconciliationOutcome> {
  const client = supabase as ReconciliationClient;
  const nowMs = Date.now();

  if (!params.force) {
    const marker = await readLastReconciliationMs(client);
    if (!marker.ok) {
      return { ran: false, reason: "marker_check_failed", error: marker.error };
    }
    if (marker.lastMs != null && nowMs - marker.lastMs < RECONCILIATION_INTERVAL_MS) {
      return {
        ran: false,
        reason: "not_due",
        lastRunAt: new Date(marker.lastMs).toISOString(),
        nextDueAt: new Date(marker.lastMs + RECONCILIATION_INTERVAL_MS).toISOString(),
      };
    }
  }

  try {
    const counters = await runReconciliationScan(client, {
      nowMs,
      dryRun: params.dryRun,
      source: params.source,
    });
    // Dry runs never advance the marker, so a dry-run probe cannot postpone the real pass.
    const markerRecorded = params.dryRun
      ? false
      : await recordReconciliationMarker(client, params.source, counters);
    return {
      ran: true,
      ok: true,
      dryRun: params.dryRun,
      forced: params.force,
      markerRecorded,
      counters,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "reconciliation_failed";
    console.error(
      "video-date-room-cleanup reconciliation_error",
      JSON.stringify({ message: message.slice(0, 200) }),
    );
    return { ran: true, ok: false, forced: params.force, error: message.slice(0, 200) };
  }
}
