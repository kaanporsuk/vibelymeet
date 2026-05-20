export const ALL_CLIENT_FEATURE_FLAGS = [
  "media_v2_video",
  "media_v2_photo",
  "media_v2_voice",
] as const;

export type ClientFeatureFlagKey = (typeof ALL_CLIENT_FEATURE_FLAGS)[number];

export const CLIENT_FEATURE_FLAG_TTL_MS = 60_000;
export const CLIENT_FEATURE_FLAG_QUERY_KEY = "client-feature-flag";
export const CLIENT_FEATURE_FLAG_STORAGE_KEY = "vibely.client-feature-flags.v1";

export type ClientFeatureFlagSource =
  | "cache"
  | "disabled"
  | "error"
  | "forbidden"
  | "invalid"
  | "kill_switched"
  | "missing"
  | "override"
  | "rollout";

export type ClientFeatureFlagEvaluation = {
  flag: ClientFeatureFlagKey;
  enabled: boolean;
  source: ClientFeatureFlagSource;
  bucket: number | null;
  rolloutBps: number | null;
  userIdBucket: string | null;
  fetchedAtMs: number;
  expiresAtMs: number;
};

export type ClientFeatureFlagEvaluationInput = {
  flag: ClientFeatureFlagKey;
  userId: string;
  force?: boolean;
  fetchDetail: (flag: ClientFeatureFlagKey, userId: string) => Promise<unknown>;
  storage?: ClientFeatureFlagStorage | null;
  emitEvaluation?: (event: ClientFeatureFlagTelemetryEvent) => void;
};

export type ClientFeatureFlagPrefetchInput = {
  flags?: readonly ClientFeatureFlagKey[];
  userId: string;
  fetchBatch: (flags: readonly ClientFeatureFlagKey[], userId: string) => Promise<unknown>;
  fetchDetail: (flag: ClientFeatureFlagKey, userId: string) => Promise<unknown>;
  storage?: ClientFeatureFlagStorage | null;
  emitEvaluation?: (event: ClientFeatureFlagTelemetryEvent) => void;
};

export type ClientFeatureFlagTelemetryEvent = {
  flag: ClientFeatureFlagKey;
  enabled: boolean;
  source: ClientFeatureFlagSource;
  latencyMs: number;
  userIdBucket: string | null;
  bucket: number | null;
  rolloutBps: number | null;
};

export type ClientFeatureFlagStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

type StoredClientFeatureFlagCache = {
  version: 1;
  entries: Array<ClientFeatureFlagEvaluation & { userId: string }>;
};

const flagCache = new Map<string, ClientFeatureFlagEvaluation>();
const inFlight = new Map<string, Promise<ClientFeatureFlagEvaluation>>();
const latestRequestSequenceByKey = new Map<string, number>();
let requestSequence = 0;
let cacheGeneration = 0;

export function isClientFeatureFlagKey(value: unknown): value is ClientFeatureFlagKey {
  return typeof value === "string" && (ALL_CLIENT_FEATURE_FLAGS as readonly string[]).includes(value);
}

export function clientFeatureFlagQueryKey(flag: ClientFeatureFlagKey, userId: string | null) {
  return [CLIENT_FEATURE_FLAG_QUERY_KEY, flag, userId] as const;
}

export function clientFeatureFlagCacheKey(flag: ClientFeatureFlagKey, userId: string): string {
  return `${userId}:${flag}`;
}

export function getCachedClientFeatureFlag(
  flag: ClientFeatureFlagKey,
  userId: string,
  nowMs = Date.now(),
): ClientFeatureFlagEvaluation | null {
  const cached = flagCache.get(clientFeatureFlagCacheKey(flag, userId));
  if (!cached || cached.expiresAtMs <= nowMs) return null;
  return cached;
}

export function getClientFeatureFlagCacheAgeMs(
  flag: ClientFeatureFlagKey,
  userId: string,
  nowMs = Date.now(),
): number | null {
  const cached = flagCache.get(clientFeatureFlagCacheKey(flag, userId));
  if (!cached) return null;
  return Math.max(0, nowMs - cached.fetchedAtMs);
}

export function shouldRefreshClientFeatureFlag(
  flag: ClientFeatureFlagKey,
  userId: string,
  maxAgeMs = CLIENT_FEATURE_FLAG_TTL_MS / 2,
  nowMs = Date.now(),
): boolean {
  const age = getClientFeatureFlagCacheAgeMs(flag, userId, nowMs);
  return age === null || age >= maxAgeMs;
}

export function clearClientFeatureFlagCache(): void {
  flagCache.clear();
  inFlight.clear();
  latestRequestSequenceByKey.clear();
  requestSequence = 0;
  cacheGeneration += 1;
}

export async function clearPersistedClientFeatureFlagCache(
  storage?: ClientFeatureFlagStorage | null,
): Promise<void> {
  clearClientFeatureFlagCache();
  if (!storage) return;
  try {
    await storage.removeItem(CLIENT_FEATURE_FLAG_STORAGE_KEY);
  } catch {
    /* feature flag cache clearing must not block logout */
  }
}

export function hydrateClientFeatureFlagCacheFromString(raw: string | null | undefined, nowMs = Date.now()): void {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClientFeatureFlagCache>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
    for (const entry of parsed.entries) {
      if (!isClientFeatureFlagKey(entry.flag) || typeof entry.userId !== "string") continue;
      if (typeof entry.enabled !== "boolean") continue;
      if (typeof entry.expiresAtMs !== "number" || entry.expiresAtMs <= nowMs) continue;
      const evaluation = normalizeEvaluation(entry, nowMs, entry.flag);
      if (evaluation) flagCache.set(clientFeatureFlagCacheKey(entry.flag, entry.userId), evaluation);
    }
  } catch {
    /* ignore malformed persisted feature flag cache */
  }
}

export async function hydrateClientFeatureFlagCache(
  storage?: ClientFeatureFlagStorage | null,
  nowMs = Date.now(),
): Promise<void> {
  if (!storage) return;
  try {
    hydrateClientFeatureFlagCacheFromString(await storage.getItem(CLIENT_FEATURE_FLAG_STORAGE_KEY), nowMs);
  } catch {
    /* ignore unavailable platform storage */
  }
}

export function serializeClientFeatureFlagCache(nowMs = Date.now()): string {
  const entries: StoredClientFeatureFlagCache["entries"] = [];
  for (const [key, entry] of flagCache) {
    if (entry.expiresAtMs <= nowMs) continue;
    const separator = key.indexOf(":");
    const userId = separator > 0 ? key.slice(0, separator) : "";
    if (!userId) continue;
    entries.push({ ...entry, userId });
  }
  return JSON.stringify({ version: 1, entries } satisfies StoredClientFeatureFlagCache);
}

export async function persistClientFeatureFlagCache(
  storage?: ClientFeatureFlagStorage | null,
): Promise<void> {
  if (!storage) return;
  try {
    await storage.setItem(CLIENT_FEATURE_FLAG_STORAGE_KEY, serializeClientFeatureFlagCache());
  } catch {
    /* ignore persistence failures; runtime cache remains authoritative */
  }
}

export async function evaluateClientFeatureFlag(
  input: ClientFeatureFlagEvaluationInput,
): Promise<ClientFeatureFlagEvaluation> {
  const key = clientFeatureFlagCacheKey(input.flag, input.userId);
  const inFlightKey = input.force ? `${key}:force` : key;
  const now = Date.now();
  const cached = flagCache.get(key);
  if (!input.force && cached && cached.expiresAtMs > now) {
    return { ...cached, source: cached.source || "cache" };
  }

  const existing = inFlight.get(inFlightKey);
  if (existing) return existing;

  const request = (async () => {
    const startedAt = Date.now();
    const generation = cacheGeneration;
    const sequence = nextRequestSequence();
    markRequestStarted(key, sequence);
    let evaluation: ClientFeatureFlagEvaluation;
    try {
      evaluation =
        normalizeEvaluation(await input.fetchDetail(input.flag, input.userId), Date.now(), input.flag) ??
        failClosedEvaluation(input.flag, Date.now());
    } catch {
      evaluation = failClosedEvaluation(input.flag, Date.now());
    }
    if (writeCacheIfFresh(key, evaluation, sequence, generation)) {
      await persistClientFeatureFlagCache(input.storage);
    }
    emitEvaluationSafely(input.emitEvaluation, evaluation, Date.now() - startedAt);
    return evaluation;
  })();

  inFlight.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(inFlightKey) === request) inFlight.delete(inFlightKey);
  }
}

export async function prefetchClientFeatureFlags(
  input: ClientFeatureFlagPrefetchInput,
): Promise<ClientFeatureFlagEvaluation[]> {
  const flags = input.flags?.length ? input.flags : ALL_CLIENT_FEATURE_FLAGS;
  const startedAt = Date.now();
  const generation = cacheGeneration;
  const sequence = nextRequestSequence();
  for (const flag of flags) {
    markRequestStarted(clientFeatureFlagCacheKey(flag, input.userId), sequence);
  }
  try {
    const raw = await input.fetchBatch(flags, input.userId);
    const rows = extractEvaluationRows(raw);
    const evaluations = rows
      .map((row) => normalizeEvaluation(row, Date.now()))
      .filter((row): row is ClientFeatureFlagEvaluation => row !== null);

    let wroteCache = false;
    for (const evaluation of evaluations) {
      wroteCache =
        writeCacheIfFresh(clientFeatureFlagCacheKey(evaluation.flag, input.userId), evaluation, sequence, generation) ||
        wroteCache;
      emitEvaluationSafely(input.emitEvaluation, evaluation, Date.now() - startedAt);
    }
    if (wroteCache) await persistClientFeatureFlagCache(input.storage);
    return evaluations;
  } catch {
    return Promise.all(
      flags.map((flag) =>
        evaluateClientFeatureFlag({
          flag,
          userId: input.userId,
          force: true,
          fetchDetail: input.fetchDetail,
          storage: input.storage,
          emitEvaluation: input.emitEvaluation,
        }),
      ),
    );
  }
}

function nextRequestSequence(): number {
  requestSequence += 1;
  return requestSequence;
}

function markRequestStarted(key: string, sequence: number): void {
  const previousSequence = latestRequestSequenceByKey.get(key) ?? 0;
  if (sequence >= previousSequence) latestRequestSequenceByKey.set(key, sequence);
}

function writeCacheIfFresh(
  key: string,
  evaluation: ClientFeatureFlagEvaluation,
  sequence: number,
  generation: number,
): boolean {
  if (generation !== cacheGeneration) return false;
  const latestSequence = latestRequestSequenceByKey.get(key) ?? sequence;
  if (sequence < latestSequence) return false;
  flagCache.set(key, evaluation);
  return true;
}

function emitEvaluationSafely(
  emitEvaluation: ((event: ClientFeatureFlagTelemetryEvent) => void) | undefined,
  evaluation: ClientFeatureFlagEvaluation,
  latencyMs: number,
): void {
  if (!emitEvaluation) return;
  try {
    emitEvaluation({
      flag: evaluation.flag,
      enabled: evaluation.enabled,
      source: evaluation.source,
      latencyMs,
      userIdBucket: evaluation.userIdBucket,
      bucket: evaluation.bucket,
      rolloutBps: evaluation.rolloutBps,
    });
  } catch {
    /* analytics failures must never affect flag decisions */
  }
}

function failClosedEvaluation(flag: ClientFeatureFlagKey, nowMs: number): ClientFeatureFlagEvaluation {
  return {
    flag,
    enabled: false,
    source: "error",
    bucket: null,
    rolloutBps: null,
    userIdBucket: null,
    fetchedAtMs: nowMs,
    expiresAtMs: nowMs + CLIENT_FEATURE_FLAG_TTL_MS,
  };
}

function normalizeSource(value: unknown): ClientFeatureFlagSource {
  if (
    value === "cache" ||
    value === "disabled" ||
    value === "error" ||
    value === "forbidden" ||
    value === "invalid" ||
    value === "kill_switched" ||
    value === "missing" ||
    value === "override" ||
    value === "rollout"
  ) {
    return value;
  }
  return "error";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEvaluation(
  value: unknown,
  nowMs: number,
  fallbackFlag?: ClientFeatureFlagKey,
): ClientFeatureFlagEvaluation | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawFlag = row.flag;
  const flag = isClientFeatureFlagKey(rawFlag) ? rawFlag : fallbackFlag;
  if (!flag) return null;
  const expiresAtMs = numberOrNull(row.expiresAtMs) ?? nowMs + CLIENT_FEATURE_FLAG_TTL_MS;
  const fetchedAtMs = numberOrNull(row.fetchedAtMs) ?? Math.min(nowMs, expiresAtMs);
  return {
    flag,
    enabled: row.enabled === true,
    source: normalizeSource(row.source),
    bucket: numberOrNull(row.bucket),
    rolloutBps: numberOrNull(row.rollout_bps ?? row.rolloutBps),
    userIdBucket: stringOrNull(row.user_id_bucket ?? row.userIdBucket),
    fetchedAtMs,
    expiresAtMs,
  };
}

function extractEvaluationRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.flags) ? record.flags : [];
}
