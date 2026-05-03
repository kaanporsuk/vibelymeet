export const PREPARE_VIDEO_DATE_ENTRY_ACTION = "prepare_date_entry" as const;
export const PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS = 3 * 60 * 1000;

export type PrepareVideoDateEntryTimings = {
  bothReadyToPrepareStartMs?: number | null;
  prepareDurationMs?: number | null;
  prepareToJoinStartMs?: number | null;
  joinDurationMs?: number | null;
  bothReadyToFirstRemoteFrameMs?: number | null;
  [key: string]: number | null | undefined;
};

export type PreparedVideoDateEntry = {
  success: true;
  room_name: string;
  room_url: string;
  token: string;
  token_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  session_state?: string | null;
  session_phase?: string | null;
  handshake_started_at?: string | null;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_verify_skipped?: boolean;
  timings?: PrepareVideoDateEntryTimings;
};

export type PrepareVideoDateEntryFailure = {
  success?: false;
  code?: string;
  error?: string;
  message?: string;
  httpStatus?: number;
  retryable?: boolean;
};

export type PreparedVideoDateEntryCacheEntry = {
  sessionId: string;
  userId: string;
  value: PreparedVideoDateEntry;
  entryAttemptId: string | null;
  cachedAtMs: number;
  expiresAtMs: number;
  bothReadyObservedAtMs?: number;
  prepareStartedAtMs: number;
  prepareFinishedAtMs: number;
};

export type PrepareVideoDateEntryResult =
  | {
      ok: true;
      data: PreparedVideoDateEntry;
      cached: boolean;
      cacheKey: string;
      cacheEntry: PreparedVideoDateEntryCacheEntry;
    }
  | {
      ok: false;
      code: string;
      message?: string;
      httpStatus?: number;
      retryable: boolean;
      entryAttemptId?: string | null;
    };

type InvokePrepareDateEntry = (input: { entryAttemptId: string }) => Promise<{
  data?: PreparedVideoDateEntry | PrepareVideoDateEntryFailure | null;
  error?: unknown;
  response?: unknown;
}>;

type PrepareWithClientOptions = {
  sessionId: string;
  userId: string;
  invoke: InvokePrepareDateEntry;
  classifyFailure: (input: {
    data?: unknown;
    error?: unknown;
    response?: unknown;
    timedOut?: boolean;
  }) => Promise<{ kind: string; httpStatus?: number; serverCode?: string; retryable: boolean }>;
  force?: boolean;
  entryAttemptId?: string;
  nowMs?: number;
  bothReadyObservedAtMs?: number;
};

const preparedEntryCache = new Map<string, PreparedVideoDateEntryCacheEntry>();
const prepareEntryInflight = new Map<string, Promise<PrepareVideoDateEntryResult>>();

export function createVideoDateEntryAttemptId(nowMs: number = Date.now()): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return `vde_${nowMs.toString(36)}_${random}`;
}

export function preparedVideoDateEntryCacheKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

export function getCachedPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): PreparedVideoDateEntryCacheEntry | null {
  const key = preparedVideoDateEntryCacheKey(sessionId, userId);
  const entry = preparedEntryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    preparedEntryCache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedPreparedVideoDateEntry(params: {
  sessionId: string;
  userId: string;
  value: PreparedVideoDateEntry;
  entryAttemptId?: string | null;
  prepareStartedAtMs: number;
  prepareFinishedAtMs: number;
  bothReadyObservedAtMs?: number;
  nowMs?: number;
}): PreparedVideoDateEntryCacheEntry {
  const nowMs = params.nowMs ?? Date.now();
  const tokenExpiresAtMs = params.value.token_expires_at
    ? new Date(params.value.token_expires_at).getTime()
    : NaN;
  const cacheExpiresAtMs = Number.isFinite(tokenExpiresAtMs)
    ? Math.min(nowMs + PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS, Math.max(nowMs, tokenExpiresAtMs - 30_000))
    : nowMs + PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS;
  const key = preparedVideoDateEntryCacheKey(params.sessionId, params.userId);
  const entry: PreparedVideoDateEntryCacheEntry = {
    sessionId: params.sessionId,
    userId: params.userId,
    value: params.value,
    entryAttemptId: params.entryAttemptId ?? params.value.entry_attempt_id ?? null,
    cachedAtMs: nowMs,
    expiresAtMs: cacheExpiresAtMs,
    bothReadyObservedAtMs: params.bothReadyObservedAtMs,
    prepareStartedAtMs: params.prepareStartedAtMs,
    prepareFinishedAtMs: params.prepareFinishedAtMs,
  };
  preparedEntryCache.set(key, entry);
  return entry;
}

export function rejectCachedPreparedVideoDateEntry(sessionId: string, userId: string): boolean {
  return preparedEntryCache.delete(preparedVideoDateEntryCacheKey(sessionId, userId));
}

export function clearPreparedVideoDateEntryCache(): void {
  preparedEntryCache.clear();
  prepareEntryInflight.clear();
}

function hasPreparedEntryPayload(data: unknown): data is PreparedVideoDateEntry {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<PreparedVideoDateEntry>;
  return row.success === true && typeof row.room_name === "string" && typeof row.room_url === "string" && typeof row.token === "string";
}

function readFailureMessage(data: unknown, fallback?: string): string | undefined {
  if (!data || typeof data !== "object") return fallback;
  const row = data as { error?: unknown; message?: unknown };
  return typeof row.message === "string"
    ? row.message
    : typeof row.error === "string"
      ? row.error
      : fallback;
}

export async function prepareVideoDateEntryWithClient(
  options: PrepareWithClientOptions,
): Promise<PrepareVideoDateEntryResult> {
  const nowMs = options.nowMs ?? Date.now();
  const key = preparedVideoDateEntryCacheKey(options.sessionId, options.userId);

  if (!options.force) {
    const cached = getCachedPreparedVideoDateEntry(options.sessionId, options.userId, nowMs);
    if (cached) {
      return {
        ok: true,
        data: cached.value,
        cached: true,
        cacheKey: key,
        cacheEntry: cached,
      };
    }
  }

  const existing = prepareEntryInflight.get(key);
  if (existing) return existing;

  const prepareStartedAtMs = nowMs;
  const entryAttemptId = options.entryAttemptId ?? createVideoDateEntryAttemptId(prepareStartedAtMs);
  const task = (async (): Promise<PrepareVideoDateEntryResult> => {
    try {
      const { data, error, response } = await options.invoke({ entryAttemptId });
      const prepareFinishedAtMs = Date.now();
      if (!error && hasPreparedEntryPayload(data)) {
        const bothReadyToPrepareStartMs =
          options.bothReadyObservedAtMs == null
            ? null
            : Math.max(0, prepareStartedAtMs - options.bothReadyObservedAtMs);
        const traceId = data.video_date_trace_id ?? data.entry_attempt_id ?? entryAttemptId;
        const value: PreparedVideoDateEntry = {
          ...data,
          entry_attempt_id: data.entry_attempt_id ?? traceId,
          video_date_trace_id: traceId,
          timings: {
            ...(data.timings ?? {}),
            bothReadyToPrepareStartMs,
            prepareDurationMs: Math.max(0, prepareFinishedAtMs - prepareStartedAtMs),
          },
        };
        const cacheEntry = setCachedPreparedVideoDateEntry({
          sessionId: options.sessionId,
          userId: options.userId,
          value,
          entryAttemptId: value.entry_attempt_id ?? entryAttemptId,
          prepareStartedAtMs,
          prepareFinishedAtMs,
          bothReadyObservedAtMs: options.bothReadyObservedAtMs,
          nowMs: prepareFinishedAtMs,
        });
        return {
          ok: true,
          data: value,
          cached: false,
          cacheKey: key,
          cacheEntry,
        };
      }

      const failure = await options.classifyFailure({ data, error, response });
      return {
        ok: false,
        code: failure.serverCode ?? failure.kind,
        message: readFailureMessage(data, error instanceof Error ? error.message : undefined),
        httpStatus: failure.httpStatus,
        retryable: failure.retryable,
        entryAttemptId,
      };
    } catch (error) {
      const failure = await options.classifyFailure({ error, timedOut: false });
      return {
        ok: false,
        code: failure.serverCode ?? failure.kind,
        message: error instanceof Error ? error.message : String(error),
        httpStatus: failure.httpStatus,
        retryable: failure.retryable,
        entryAttemptId,
      };
    } finally {
      prepareEntryInflight.delete(key);
    }
  })();

  prepareEntryInflight.set(key, task);
  return task;
}

export function getPrepareToJoinStartMs(entry: PreparedVideoDateEntryCacheEntry, nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - entry.prepareFinishedAtMs);
}

export function getBothReadyToFirstRemoteFrameMs(
  entry: PreparedVideoDateEntryCacheEntry | null,
  nowMs: number = Date.now(),
): number | null {
  if (entry?.bothReadyObservedAtMs == null) return null;
  return Math.max(0, nowMs - entry.bothReadyObservedAtMs);
}
