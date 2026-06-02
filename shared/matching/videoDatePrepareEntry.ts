export const PREPARE_VIDEO_DATE_ENTRY_ACTION = "prepare_date_entry" as const;
export const PREPARE_VIDEO_DATE_SOLO_ENTRY_ACTION =
  "prepare_solo_entry" as const;
export const PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS = 3 * 60 * 1000;
export const PREPARED_VIDEO_DATE_ENTRY_HANDOFF_VERSION = 1 as const;
export const PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_FALLBACK_MS = 1_000;
export const PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_MAX_MS = 30_000;

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
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_room_recovered?: boolean;
  provider_verify_skipped?: boolean;
  provider_verify_reason?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  timings?: PrepareVideoDateEntryTimings;
};

export type PreparedVideoDateSoloEntry = {
  success: true;
  solo_prejoin: true;
  room_name: string;
  room_url: string;
  token: string;
  token_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  session_state?: string | null;
  session_phase?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_room_recovered?: boolean;
  provider_verify_skipped?: boolean;
  provider_verify_reason?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  timings?: PrepareVideoDateEntryTimings;
};

export type PrepareVideoDateEntryFailure = {
  success?: false;
  code?: string;
  error?: string;
  message?: string;
  httpStatus?: number;
  retryable?: boolean;
  retry_after_seconds?: number;
  retryAfterSeconds?: number;
  retry_after_ms?: number;
  retryAfterMs?: number;
  details?: {
    operation?: unknown;
    retry_after_seconds?: unknown;
    retryAfterSeconds?: unknown;
    retry_after_ms?: unknown;
    retryAfterMs?: unknown;
    [key: string]: unknown;
  };
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

export type PreparedVideoDateEntryHandoffEnvelope = {
  handoffVersion: typeof PREPARED_VIDEO_DATE_ENTRY_HANDOFF_VERSION;
  sessionId: string;
  userId: string;
  roomName: string;
  roomUrl: string;
  token: string;
  tokenExpiresAt: string | null;
  preparedAt: string;
  expiresAt: string;
  readyGateStatus: string | null;
  readyGateExpiresAt: string | null;
  phase: string | null;
  state: string | null;
  participants: [string | null, string | null];
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
  cachedAtMs: number;
  expiresAtMs: number;
};

export type PreparedVideoDateEntryHandoffValidation =
  | {
      ok: true;
      envelope: PreparedVideoDateEntryHandoffEnvelope;
      cacheEntry: PreparedVideoDateEntryCacheEntry;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "session_mismatch"
        | "user_mismatch"
        | "expired"
        | "token_expired"
        | "missing_room"
        | "room_mismatch"
        | "missing_token"
        | "invalid_state"
        | "invalid_phase"
        | "invalid_ready_gate";
    };

export type PrepareVideoDateEntryResult =
  | {
      ok: true;
      data: PreparedVideoDateEntry;
      cached: boolean;
      cacheKey: string;
      cacheEntry: PreparedVideoDateEntryCacheEntry;
      coalesced?: boolean;
      ownerEntryAttemptId?: string | null;
    }
  | {
      ok: false;
      code: string;
      message?: string;
      httpStatus?: number;
      retryable: boolean;
      entryAttemptId?: string | null;
      providerOperation?: string | null;
      retryAfterSeconds?: number;
      retryAfterMs?: number;
      coalesced?: boolean;
      ownerEntryAttemptId?: string | null;
    };

type PrepareVideoDateEntryFailureResult = Extract<
  PrepareVideoDateEntryResult,
  { ok: false }
>;

export type PrepareVideoDateSoloEntryResult =
  | {
      ok: true;
      data: PreparedVideoDateSoloEntry;
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
  }) => Promise<{
    kind: string;
    httpStatus?: number;
    serverCode?: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    retryAfterMs?: number;
  }>;
  force?: boolean;
  entryAttemptId?: string;
  nowMs?: number;
  bothReadyObservedAtMs?: number;
  onOwnerStart?: (input: {
    entryAttemptId: string;
    startedAtMs: number;
  }) => void;
};

const preparedEntryCache = new Map<string, PreparedVideoDateEntryCacheEntry>();
const preparedEntryHandoffs = new Map<
  string,
  PreparedVideoDateEntryHandoffEnvelope
>();
const prepareEntryInflight = new Map<
  string,
  Promise<PrepareVideoDateEntryResult>
>();

type PrepareEntryFailureCooldown = {
  retryUntilMs: number;
  code: string;
  message?: string;
  httpStatus?: number;
  retryable: boolean;
  entryAttemptId?: string | null;
  ownerEntryAttemptId?: string | null;
  providerOperation?: string | null;
};

const prepareEntryFailureCooldowns = new Map<
  string,
  PrepareEntryFailureCooldown
>();

export function createVideoDateEntryAttemptId(
  nowMs: number = Date.now(),
): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return `vde_${nowMs.toString(36)}_${random}`;
}

export function preparedVideoDateEntryCacheKey(
  sessionId: string,
  userId: string,
): string {
  return `${sessionId}:${userId}`;
}

function isoFromMs(value: number): string {
  return new Date(value).toISOString();
}

function readTokenExpiresAtMs(value: PreparedVideoDateEntry): number {
  return value.token_expires_at
    ? new Date(value.token_expires_at).getTime()
    : NaN;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readRetryAfterMsFromRecord(
  record: Record<string, unknown> | undefined,
): number | undefined {
  if (!record) return undefined;
  const retryAfterMs =
    readPositiveFiniteNumber(record.retryAfterMs) ??
    readPositiveFiniteNumber(record.retry_after_ms);
  if (retryAfterMs !== undefined) return Math.ceil(retryAfterMs);
  const retryAfterSeconds =
    readPositiveFiniteNumber(record.retryAfterSeconds) ??
    readPositiveFiniteNumber(record.retry_after_seconds);
  return retryAfterSeconds === undefined
    ? undefined
    : Math.ceil(retryAfterSeconds * 1000);
}

function readRetryAfterMsFromFailureData(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const body = data as Record<string, unknown>;
  return (
    readRetryAfterMsFromRecord(body) ??
    readRetryAfterMsFromRecord(
      body.details as Record<string, unknown> | undefined,
    )
  );
}

function clampPrepareEntryRetryAfterMs(
  value: number | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0)
    return undefined;
  return Math.min(
    Math.ceil(value),
    PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_MAX_MS,
  );
}

function retryAfterSecondsFromMs(
  value: number | undefined,
): number | undefined {
  return value === undefined ? undefined : Math.ceil(value / 1000);
}

function withPrepareResultCoalesced(
  result: PrepareVideoDateEntryResult,
  requestedEntryAttemptId?: string,
): PrepareVideoDateEntryResult {
  if (result.ok === true) {
    const ownerEntryAttemptId =
      result.ownerEntryAttemptId ??
      result.data.entry_attempt_id ??
      result.cacheEntry.entryAttemptId ??
      null;
    return {
      ...result,
      coalesced: true,
      ownerEntryAttemptId,
    };
  }
  const ownerEntryAttemptId =
    result.ownerEntryAttemptId ?? result.entryAttemptId ?? null;
  return {
    ...result,
    entryAttemptId: requestedEntryAttemptId ?? result.entryAttemptId,
    coalesced: true,
    ownerEntryAttemptId,
  };
}

function readPrepareEntryCooldown(
  key: string,
  nowMs: number,
  requestedEntryAttemptId?: string,
): PrepareVideoDateEntryResult | null {
  const cooldown = prepareEntryFailureCooldowns.get(key);
  if (!cooldown) return null;
  if (cooldown.retryUntilMs <= nowMs) {
    prepareEntryFailureCooldowns.delete(key);
    return null;
  }
  const retryAfterMs = Math.max(1, Math.ceil(cooldown.retryUntilMs - nowMs));
  return {
    ok: false,
    code: cooldown.code,
    message: cooldown.message,
    httpStatus: cooldown.httpStatus,
    retryable: true,
    entryAttemptId: requestedEntryAttemptId ?? cooldown.entryAttemptId ?? null,
    providerOperation: cooldown.providerOperation ?? null,
    retryAfterMs,
    retryAfterSeconds: retryAfterSecondsFromMs(retryAfterMs),
    coalesced: true,
    ownerEntryAttemptId:
      cooldown.ownerEntryAttemptId ?? cooldown.entryAttemptId ?? null,
  };
}

function rememberPrepareEntryFailureCooldown(
  key: string,
  result: PrepareVideoDateEntryFailureResult,
  nowMs: number = Date.now(),
): PrepareVideoDateEntryResult {
  if (!result.retryable) {
    prepareEntryFailureCooldowns.delete(key);
    return result;
  }
  const retryAfterMs =
    clampPrepareEntryRetryAfterMs(result.retryAfterMs) ??
    PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_FALLBACK_MS;
  prepareEntryFailureCooldowns.set(key, {
    retryUntilMs: nowMs + retryAfterMs,
    code: result.code,
    message: result.message,
    httpStatus: result.httpStatus,
    retryable: result.retryable,
    entryAttemptId: result.entryAttemptId ?? null,
    ownerEntryAttemptId:
      result.ownerEntryAttemptId ?? result.entryAttemptId ?? null,
    providerOperation: result.providerOperation ?? null,
  });
  return {
    ...result,
    retryAfterMs,
    retryAfterSeconds: retryAfterSecondsFromMs(retryAfterMs),
  };
}

function preparedEntryRoomUrlMatchesRoomName(
  roomUrl: string,
  roomName: string,
): boolean {
  try {
    const url = new URL(roomUrl);
    return (
      url.protocol === "https:" &&
      url.pathname.replace(/\/+$/, "") === `/${roomName}`
    );
  } catch {
    return false;
  }
}

function isPreparedEntryStartableState(value: unknown): boolean {
  return value === "handshake" || value === "date";
}

function preparedEntryInvalidStartabilityCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return "PREPARE_ENTRY_INVALID_PAYLOAD";
  const row = data as Partial<PreparedVideoDateEntry>;
  if (row.success !== true) return "PREPARE_ENTRY_INVALID_PAYLOAD";
  if (!nonEmptyString(row.room_name) || !nonEmptyString(row.room_url))
    return "PREPARE_ENTRY_MISSING_ROOM";
  if (!preparedEntryRoomUrlMatchesRoomName(row.room_url, row.room_name))
    return "PREPARE_ENTRY_ROOM_MISMATCH";
  if (!nonEmptyString(row.token)) return "PREPARE_ENTRY_MISSING_TOKEN";
  if (!isPreparedEntryStartableState(row.session_state))
    return "PREPARE_ENTRY_INVALID_STATE";
  if (!isPreparedEntryStartableState(row.session_phase))
    return "PREPARE_ENTRY_INVALID_PHASE";
  if (row.ready_gate_status && row.ready_gate_status !== "both_ready")
    return "PREPARE_ENTRY_INVALID_READY_GATE";
  return null;
}

function buildPreparedVideoDateEntryHandoffEnvelope(
  entry: PreparedVideoDateEntryCacheEntry,
): PreparedVideoDateEntryHandoffEnvelope {
  const value = entry.value;
  return {
    handoffVersion: PREPARED_VIDEO_DATE_ENTRY_HANDOFF_VERSION,
    sessionId: entry.sessionId,
    userId: entry.userId,
    roomName: value.room_name,
    roomUrl: value.room_url,
    token: value.token,
    tokenExpiresAt: value.token_expires_at ?? null,
    preparedAt: isoFromMs(entry.prepareFinishedAtMs),
    expiresAt: isoFromMs(entry.expiresAtMs),
    readyGateStatus: value.ready_gate_status ?? null,
    readyGateExpiresAt: value.ready_gate_expires_at ?? null,
    phase: value.session_phase ?? null,
    state: value.session_state ?? null,
    participants: [
      value.participant_1_id ?? null,
      value.participant_2_id ?? null,
    ],
    entryAttemptId: entry.entryAttemptId ?? value.entry_attempt_id ?? null,
    videoDateTraceId: value.video_date_trace_id ?? entry.entryAttemptId ?? null,
    cachedAtMs: entry.cachedAtMs,
    expiresAtMs: entry.expiresAtMs,
  };
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
    preparedEntryHandoffs.delete(key);
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
    ? Math.min(
        nowMs + PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS,
        Math.max(nowMs, tokenExpiresAtMs - 30_000),
      )
    : nowMs + PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS;
  const key = preparedVideoDateEntryCacheKey(params.sessionId, params.userId);
  const entry: PreparedVideoDateEntryCacheEntry = {
    sessionId: params.sessionId,
    userId: params.userId,
    value: params.value,
    entryAttemptId:
      params.entryAttemptId ?? params.value.entry_attempt_id ?? null,
    cachedAtMs: nowMs,
    expiresAtMs: cacheExpiresAtMs,
    bothReadyObservedAtMs: params.bothReadyObservedAtMs,
    prepareStartedAtMs: params.prepareStartedAtMs,
    prepareFinishedAtMs: params.prepareFinishedAtMs,
  };
  preparedEntryCache.set(key, entry);
  preparedEntryHandoffs.set(
    key,
    buildPreparedVideoDateEntryHandoffEnvelope(entry),
  );
  return entry;
}

export function rejectCachedPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
): boolean {
  const key = preparedVideoDateEntryCacheKey(sessionId, userId);
  preparedEntryHandoffs.delete(key);
  return preparedEntryCache.delete(key);
}

export function clearPreparedVideoDateEntryCache(): void {
  preparedEntryCache.clear();
  preparedEntryHandoffs.clear();
  prepareEntryInflight.clear();
  prepareEntryFailureCooldowns.clear();
}

export function peekPreparedVideoDateEntryHandoff(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): PreparedVideoDateEntryHandoffValidation {
  const key = preparedVideoDateEntryCacheKey(sessionId, userId);
  const envelope = preparedEntryHandoffs.get(key);
  const cacheEntry = getCachedPreparedVideoDateEntry(sessionId, userId, nowMs);
  if (!envelope || !cacheEntry) return { ok: false, reason: "missing" };
  if (envelope.sessionId !== sessionId)
    return { ok: false, reason: "session_mismatch" };
  if (envelope.userId !== userId) return { ok: false, reason: "user_mismatch" };
  if (envelope.expiresAtMs <= nowMs) {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "expired" };
  }
  if (!envelope.roomName || !envelope.roomUrl)
    return { ok: false, reason: "missing_room" };
  if (
    envelope.roomName !== cacheEntry.value.room_name ||
    envelope.roomUrl !== cacheEntry.value.room_url ||
    !preparedEntryRoomUrlMatchesRoomName(envelope.roomUrl, envelope.roomName)
  ) {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "room_mismatch" };
  }
  if (!envelope.token) return { ok: false, reason: "missing_token" };
  if (envelope.token !== cacheEntry.value.token) {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "missing_token" };
  }
  const tokenExpiresAtMs = readTokenExpiresAtMs(cacheEntry.value);
  if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= nowMs + 5_000) {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "token_expired" };
  }
  if (envelope.state !== "handshake" && envelope.state !== "date") {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "invalid_state" };
  }
  if (envelope.phase !== "handshake" && envelope.phase !== "date") {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "invalid_phase" };
  }
  if (envelope.readyGateStatus && envelope.readyGateStatus !== "both_ready") {
    rejectCachedPreparedVideoDateEntry(sessionId, userId);
    return { ok: false, reason: "invalid_ready_gate" };
  }
  return { ok: true, envelope, cacheEntry };
}

export function consumePreparedVideoDateEntryHandoff(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): PreparedVideoDateEntryHandoffValidation {
  const result = peekPreparedVideoDateEntryHandoff(sessionId, userId, nowMs);
  if (result.ok === true) {
    preparedEntryHandoffs.delete(
      preparedVideoDateEntryCacheKey(sessionId, userId),
    );
  }
  return result;
}

function hasPreparedEntryPayload(
  data: unknown,
): data is PreparedVideoDateEntry {
  return preparedEntryInvalidStartabilityCode(data) === null;
}

export function hasPreparedVideoDateSoloEntryPayload(
  data: unknown,
): data is PreparedVideoDateSoloEntry {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<PreparedVideoDateSoloEntry>;
  return (
    row.success === true &&
    row.solo_prejoin === true &&
    typeof row.room_name === "string" &&
    typeof row.room_url === "string" &&
    typeof row.token === "string"
  );
}

function readFailureMessage(
  data: unknown,
  fallback?: string,
): string | undefined {
  if (!data || typeof data !== "object") return fallback;
  const row = data as { error?: unknown; message?: unknown };
  return typeof row.message === "string"
    ? row.message
    : typeof row.error === "string"
      ? row.error
      : fallback;
}

function readFailureProviderOperationFromBody(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const details = (data as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const operation = (details as { operation?: unknown }).operation;
  return typeof operation === "string" && operation.trim().length > 0
    ? operation.trim()
    : null;
}

async function readFailureProviderOperation(
  data: unknown,
  response?: unknown,
): Promise<string | null> {
  const fromData = readFailureProviderOperationFromBody(data);
  if (fromData) return fromData;

  if (!response || typeof response !== "object") return null;
  const maybeResponse = response as Response;
  if (
    typeof maybeResponse.clone !== "function" ||
    typeof maybeResponse.text !== "function"
  )
    return null;

  try {
    const text = await maybeResponse.clone().text();
    if (!text) return null;
    return readFailureProviderOperationFromBody(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function prepareVideoDateEntryWithClient(
  options: PrepareWithClientOptions,
): Promise<PrepareVideoDateEntryResult> {
  const nowMs = options.nowMs ?? Date.now();
  const key = preparedVideoDateEntryCacheKey(options.sessionId, options.userId);

  if (!options.force) {
    const cached = getCachedPreparedVideoDateEntry(
      options.sessionId,
      options.userId,
      nowMs,
    );
    if (cached) {
      return {
        ok: true,
        data: cached.value,
        cached: true,
        cacheKey: key,
        cacheEntry: cached,
        coalesced: false,
        ownerEntryAttemptId:
          cached.entryAttemptId ?? cached.value.entry_attempt_id ?? null,
      };
    }
  }

  const existing = prepareEntryInflight.get(key);
  if (existing)
    return existing.then((result) =>
      withPrepareResultCoalesced(result, options.entryAttemptId),
    );

  const cooldown = readPrepareEntryCooldown(key, nowMs, options.entryAttemptId);
  if (cooldown) return cooldown;

  const prepareStartedAtMs = nowMs;
  const entryAttemptId =
    options.entryAttemptId ?? createVideoDateEntryAttemptId(prepareStartedAtMs);
  try {
    options.onOwnerStart?.({ entryAttemptId, startedAtMs: prepareStartedAtMs });
  } catch {
    // Observability should not be able to block a date handoff.
  }
  const task = (async (): Promise<PrepareVideoDateEntryResult> => {
    try {
      const { data, error, response } = await options.invoke({
        entryAttemptId,
      });
      const prepareFinishedAtMs = Date.now();
      if (!error && hasPreparedEntryPayload(data)) {
        const bothReadyToPrepareStartMs =
          options.bothReadyObservedAtMs == null
            ? null
            : Math.max(0, prepareStartedAtMs - options.bothReadyObservedAtMs);
        const traceId =
          data.video_date_trace_id ?? data.entry_attempt_id ?? entryAttemptId;
        const value: PreparedVideoDateEntry = {
          ...data,
          entry_attempt_id: data.entry_attempt_id ?? traceId,
          video_date_trace_id: traceId,
          timings: {
            ...(data.timings ?? {}),
            bothReadyToPrepareStartMs,
            prepareDurationMs: Math.max(
              0,
              prepareFinishedAtMs - prepareStartedAtMs,
            ),
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
          coalesced: false,
          ownerEntryAttemptId: value.entry_attempt_id ?? entryAttemptId,
        };
      }

      if (
        !error &&
        data &&
        typeof data === "object" &&
        (data as { success?: unknown }).success === true
      ) {
        return rememberPrepareEntryFailureCooldown(
          key,
          {
            ok: false,
            code:
              preparedEntryInvalidStartabilityCode(data) ??
              "PREPARE_ENTRY_INVALID_PAYLOAD",
            message: "Prepared video date entry was not startable.",
            retryable: true,
            entryAttemptId,
            providerOperation: null,
            retryAfterMs: PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_FALLBACK_MS,
            retryAfterSeconds: retryAfterSecondsFromMs(
              PREPARE_VIDEO_DATE_ENTRY_FAILURE_COOLDOWN_FALLBACK_MS,
            ),
            coalesced: false,
            ownerEntryAttemptId: entryAttemptId,
          },
          prepareFinishedAtMs,
        );
      }

      const failure = await options.classifyFailure({ data, error, response });
      const retryAfterMs =
        clampPrepareEntryRetryAfterMs(failure.retryAfterMs) ??
        clampPrepareEntryRetryAfterMs(readRetryAfterMsFromFailureData(data)) ??
        (failure.retryAfterSeconds === undefined
          ? undefined
          : clampPrepareEntryRetryAfterMs(failure.retryAfterSeconds * 1000));
      return rememberPrepareEntryFailureCooldown(
        key,
        {
          ok: false,
          code: failure.serverCode ?? failure.kind,
          message: readFailureMessage(
            data,
            error instanceof Error ? error.message : undefined,
          ),
          httpStatus: failure.httpStatus,
          retryable: failure.retryable,
          entryAttemptId,
          providerOperation: await readFailureProviderOperation(data, response),
          retryAfterMs,
          retryAfterSeconds: retryAfterSecondsFromMs(retryAfterMs),
          coalesced: false,
          ownerEntryAttemptId: entryAttemptId,
        },
        prepareFinishedAtMs,
      );
    } catch (error) {
      const failure = await options.classifyFailure({ error, timedOut: false });
      const retryAfterMs =
        clampPrepareEntryRetryAfterMs(failure.retryAfterMs) ??
        (failure.retryAfterSeconds === undefined
          ? undefined
          : clampPrepareEntryRetryAfterMs(failure.retryAfterSeconds * 1000));
      return rememberPrepareEntryFailureCooldown(key, {
        ok: false,
        code: failure.serverCode ?? failure.kind,
        message: error instanceof Error ? error.message : String(error),
        httpStatus: failure.httpStatus,
        retryable: failure.retryable,
        entryAttemptId,
        providerOperation: await readFailureProviderOperation(
          undefined,
          (error as { context?: unknown })?.context,
        ),
        retryAfterMs,
        retryAfterSeconds: retryAfterSecondsFromMs(retryAfterMs),
        coalesced: false,
        ownerEntryAttemptId: entryAttemptId,
      });
    } finally {
      prepareEntryInflight.delete(key);
    }
  })();

  prepareEntryInflight.set(key, task);
  return task;
}

export function getPrepareToJoinStartMs(
  entry: PreparedVideoDateEntryCacheEntry,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, nowMs - entry.prepareFinishedAtMs);
}

export function getBothReadyToFirstRemoteFrameMs(
  entry: PreparedVideoDateEntryCacheEntry | null,
  nowMs: number = Date.now(),
): number | null {
  if (entry?.bothReadyObservedAtMs == null) return null;
  return Math.max(0, nowMs - entry.bothReadyObservedAtMs);
}
