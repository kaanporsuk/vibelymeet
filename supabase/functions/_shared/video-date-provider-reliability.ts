import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";

type JsonRecord = Record<string, unknown>;
type SupabaseServiceClient = any;

export type ProviderName = "daily" | "onesignal" | "supabase" | "worker";
export type ProviderTargetKind = "outbox" | "deadline" | "worker" | "provider";

export type ProviderRateLimitConfig = {
  provider: ProviderName | string;
  bucket: string;
  capacity: number;
  refillPerSecond: number;
  cost?: number;
};

export type ProviderFailureLogInput = {
  targetKind: ProviderTargetKind;
  outboxId?: number | null;
  deadlineId?: number | null;
  sessionId?: string | null;
  provider?: string | null;
  operation?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAfterSeconds?: number | null;
  permanent?: boolean;
  leaseLost?: boolean;
  metadata?: JsonRecord;
};

export class ProviderTimeoutError extends Error {
  readonly code = "provider_timeout";
  readonly retryAfterSeconds: number;
  readonly provider: string;
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(provider: string, operation: string, timeoutMs: number, retryAfterSeconds = 30) {
    super(`${provider}_${operation}_timeout`);
    this.name = "ProviderTimeoutError";
    this.provider = provider;
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderRateLimitError extends Error {
  readonly code = "provider_rate_limited";
  readonly retryAfterSeconds: number;
  readonly provider: string;
  readonly bucket: string;
  readonly clientError: string;

  constructor(provider: string, bucket: string, retryAfterSeconds = 30, clientError = "provider_rate_limited") {
    super(`${provider}_${bucket}_rate_limited`);
    this.name = "ProviderRateLimitError";
    this.provider = provider;
    this.bucket = bucket;
    this.retryAfterSeconds = retryAfterSeconds;
    this.clientError = clientError;
  }
}

const SECRET_KEY_PATTERN = /(authorization|api[_-]?key|secret|token|password|signature|cookie|payload)/i;
const SENTRY_FLUSH_TIMEOUT_MS = numericEnv("SENTRY_FLUSH_TIMEOUT_MS", 500, 0, 5_000);
let sentryInitialized = false;

export function numericEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseRetryAfterSeconds(headers: Headers | null | undefined, fallback: number): number {
  const raw = headers?.get("Retry-After")?.trim();
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.min(300, Math.max(1, Math.ceil(numeric)));
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return fallback;
  return Math.min(300, Math.max(1, Math.ceil((dateMs - Date.now()) / 1000)));
}

export function providerFailureCode(error: unknown): string {
  if (error instanceof ProviderTimeoutError) return error.code;
  if (error instanceof ProviderRateLimitError) return error.code;
  const code = (error as unknown as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    return code.slice(0, 120);
  }
  if (error instanceof Error) {
    const messageCode = error.message.match(/^([A-Za-z0-9_.-]{3,120})(?::|$)/)?.[1];
    if (messageCode) return messageCode.slice(0, 120);
    return error.name || "provider_error";
  }
  return "provider_error";
}

export function providerFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error ?? "provider_error").slice(0, 1000);
}

export function providerFailureRetryAfter(error: unknown, fallback = 30): number {
  if (error instanceof ProviderTimeoutError) return error.retryAfterSeconds;
  if (error instanceof ProviderRateLimitError) return error.retryAfterSeconds;
  const retryAfter = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof retryAfter === "number" && Number.isFinite(retryAfter)
    ? Math.min(300, Math.max(1, Math.ceil(retryAfter)))
    : fallback;
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: {
    provider: string;
    operation: string;
    timeoutMs?: number;
    retryAfterSeconds?: number;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const timeoutMs = Math.max(250, Math.trunc(options.timeoutMs ?? 8_000));
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ProviderTimeoutError(
        options.provider,
        options.operation,
        timeoutMs,
        options.retryAfterSeconds ?? 30,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function takeProviderRateLimitToken(
  supabase: SupabaseServiceClient,
  config: ProviderRateLimitConfig,
): Promise<{ ok: true } | { ok: false; error: string; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("take_provider_rate_limit_token_v1", {
    p_provider: config.provider,
    p_bucket: config.bucket,
    p_cost: Math.max(1, Math.trunc(config.cost ?? 1)),
    p_capacity: Math.max(1, Math.trunc(config.capacity)),
    p_refill_per_second: Math.max(0.001, config.refillPerSecond),
  });
  if (error) {
    return { ok: false, error: error.message, retryAfterSeconds: 30 };
  }
  const payload = (data ?? {}) as { ok?: boolean; error?: string; retryAfterSeconds?: number };
  if (payload.ok === true) return { ok: true };
  return {
    ok: false,
    error: payload.error ?? "provider_rate_limited",
    retryAfterSeconds: typeof payload.retryAfterSeconds === "number" ? payload.retryAfterSeconds : 30,
  };
}

export async function enforceProviderRateLimit(
  supabase: SupabaseServiceClient,
  config: ProviderRateLimitConfig,
): Promise<void> {
  const result = await takeProviderRateLimitToken(supabase, config);
  if (!result.ok) {
    throw new ProviderRateLimitError(String(config.provider), config.bucket, result.retryAfterSeconds);
  }
}

export async function beginWorkerRun(
  supabase: SupabaseServiceClient,
  input: { workerKind: string; workerId: string; leaseSeconds: number; metadata?: JsonRecord },
): Promise<{ ok: boolean; error?: string; claimExpiresAt?: string | null }> {
  const { data, error } = await supabase.rpc("begin_video_date_worker_run_v1", {
    p_worker_kind: input.workerKind,
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds,
    p_metadata: input.metadata ?? {},
  });
  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as { ok?: boolean; error?: string; claimExpiresAt?: string | null };
  return { ok: payload.ok === true, error: payload.error, claimExpiresAt: payload.claimExpiresAt ?? null };
}

export async function refreshWorkerRun(
  supabase: SupabaseServiceClient,
  input: { workerKind: string; workerId: string; leaseSeconds: number; metadata?: JsonRecord },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("refresh_video_date_worker_run_v1", {
    p_worker_kind: input.workerKind,
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds,
    p_metadata: input.metadata ?? null,
  });
  if (error) return false;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}

export async function finishWorkerRun(
  supabase: SupabaseServiceClient,
  input: { workerKind: string; workerId: string; metadata?: JsonRecord },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("finish_video_date_worker_run_v1", {
    p_worker_kind: input.workerKind,
    p_worker_id: input.workerId,
    p_metadata: input.metadata ?? null,
  });
  if (error) return false;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}

export function createWorkerRunRefresher(
  supabase: SupabaseServiceClient,
  input: { workerKind: string; workerId: string; leaseSeconds: number; intervalMs?: number; metadata?: () => JsonRecord },
): { stop: () => void; isLost: () => boolean } {
  let lost = false;
  let stopped = false;
  const interval = setInterval(() => {
    void refreshWorkerRun(supabase, {
      workerKind: input.workerKind,
      workerId: input.workerId,
      leaseSeconds: input.leaseSeconds,
      metadata: input.metadata?.(),
    }).then((ok) => {
      if (!ok && !stopped) lost = true;
    }).catch(() => {
      if (!stopped) lost = true;
    });
  }, input.intervalMs ?? Math.max(5_000, Math.min(30_000, Math.floor(input.leaseSeconds * 500))));

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
    isLost: () => lost,
  };
}

export function createClaimLeaseRefresher(
  supabase: SupabaseServiceClient,
  input: {
    rowKind: "outbox" | "deadline";
    rowId: number;
    workerId: string;
    leaseSeconds: number;
    intervalMs?: number;
    onLeaseLost?: (reason: string) => void;
  },
): { signal: AbortSignal; stop: () => void; isLost: () => boolean } {
  const controller = new AbortController();
  let lost = false;
  let stopped = false;
  const rpcName = input.rowKind === "outbox"
    ? "refresh_video_date_provider_outbox_claim_v1"
    : "refresh_video_session_deadline_claim_v1";
  const idKey = input.rowKind === "outbox" ? "p_outbox_id" : "p_deadline_id";

  const markLost = (reason: string) => {
    if (lost || stopped) return;
    lost = true;
    input.onLeaseLost?.(reason);
    controller.abort(reason);
  };

  const interval = setInterval(() => {
    void supabase.rpc(rpcName, {
      [idKey]: input.rowId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    }).then(({ data, error }: { data: unknown; error: { message?: string } | null }) => {
      if (error) {
        markLost(error.message ?? "lease_refresh_failed");
        return;
      }
      const payload = (data ?? {}) as { ok?: boolean; error?: string };
      if (payload.ok !== true) markLost(payload.error ?? "lease_lost");
    }).catch((error: unknown) => {
      markLost(providerFailureMessage(error));
    });
  }, input.intervalMs ?? Math.max(2_500, Math.min(25_000, Math.floor(input.leaseSeconds * 500))));

  return {
    signal: controller.signal,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
    isLost: () => lost,
  };
}

export async function logVideoDateProviderFailure(
  supabase: SupabaseServiceClient,
  input: ProviderFailureLogInput,
): Promise<void> {
  const row = {
    target_kind: input.targetKind,
    outbox_id: input.outboxId ?? null,
    deadline_id: input.deadlineId ?? null,
    session_id: input.sessionId ?? null,
    provider: input.provider ?? null,
    operation: input.operation ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    retry_after_seconds: input.retryAfterSeconds ?? null,
    permanent: input.permanent === true,
    lease_lost: input.leaseLost === true,
    metadata: sanitizeFields(input.metadata ?? {}),
  };
  const { error } = await supabase.from("video_date_provider_outbox_failure_log").insert(row);
  if (error) {
    console.warn(JSON.stringify({
      event: "video_date_provider_failure_log_insert_failed",
      error: error.message,
      target_kind: input.targetKind,
      operation: input.operation ?? null,
    }));
  }
}

export async function deadLetterVideoDateProviderFailure(
  supabase: SupabaseServiceClient,
  input: {
    targetKind: "outbox" | "deadline" | "webhook" | "provider";
    outboxId?: number | null;
    deadlineId?: number | null;
    sessionId?: string | null;
    provider?: string | null;
    operation?: string | null;
    reason: string;
    payload?: JsonRecord;
  },
): Promise<void> {
  const row = {
    target_kind: input.targetKind,
    outbox_id: input.outboxId ?? null,
    deadline_id: input.deadlineId ?? null,
    session_id: input.sessionId ?? null,
    provider: input.provider ?? null,
    operation: input.operation ?? null,
    reason: input.reason.slice(0, 1000),
    payload: sanitizeFields(input.payload ?? {}),
  };
  const { error } = await supabase.from("video_date_provider_dead_letters").insert(row);
  if (error) {
    console.warn(JSON.stringify({
      event: "video_date_provider_dead_letter_insert_failed",
      error: error.message,
      target_kind: input.targetKind,
      operation: input.operation ?? null,
    }));
  }
}

export async function captureVideoDateProviderException(
  error: unknown,
  fields: JsonRecord,
): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  if (!dsn) return;
  try {
    if (!sentryInitialized) {
      Sentry.init({
        dsn,
        defaultIntegrations: false,
        environment: Deno.env.get("SENTRY_ENVIRONMENT")?.trim() || Deno.env.get("ENVIRONMENT")?.trim() || "production",
        tracesSampleRate: 0,
      });
      Sentry.setTag("region", Deno.env.get("SB_REGION") ?? "unknown");
      Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID") ?? "unknown");
      sentryInitialized = true;
    }
    Sentry.captureException(error, {
      tags: {
        scope: "video_date_provider_reliability",
        provider: safeString(fields.provider),
        operation: safeString(fields.operation),
      },
      extra: sanitizeFields(fields),
    });
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS).catch(() => false);
  } catch (sentryError) {
    console.warn(JSON.stringify({
      event: "video_date_provider_sentry_capture_failed",
      error: sentryError instanceof Error ? sentryError.name : "unknown",
    }));
  }
}

export function providerRateLimitConfig(provider: "daily" | "onesignal", bucket: string): ProviderRateLimitConfig {
  if (provider === "onesignal") {
    return {
      provider,
      bucket,
      capacity: numericEnv("ONESIGNAL_RATE_LIMIT_BURST", 20, 1, 500),
      refillPerSecond: numericEnv("ONESIGNAL_RATE_LIMIT_RPS", 5, 0.1, 200),
    };
  }

  if (bucket === "room_create") {
    return {
      provider,
      bucket,
      capacity: numericEnv("DAILY_ROOM_CREATE_RATE_LIMIT_BURST", 6, 1, 500),
      refillPerSecond: numericEnv("DAILY_ROOM_CREATE_RATE_LIMIT_RPS", 2, 0.1, 200),
    };
  }
  if (bucket === "meeting_token") {
    return {
      provider,
      bucket,
      capacity: numericEnv("DAILY_TOKEN_RATE_LIMIT_BURST", 20, 1, 500),
      refillPerSecond: numericEnv("DAILY_TOKEN_RATE_LIMIT_RPS", 10, 0.1, 500),
    };
  }
  return {
    provider,
    bucket,
    capacity: numericEnv("DAILY_ROOM_READ_DELETE_RATE_LIMIT_BURST", 15, 1, 500),
    refillPerSecond: numericEnv("DAILY_ROOM_READ_DELETE_RATE_LIMIT_RPS", 5, 0.1, 300),
  };
}

export function providerFetchTimeoutMs(provider: "daily" | "onesignal" | "supabase", operation: string): number {
  const key = `${provider.toUpperCase()}_${operation.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TIMEOUT_MS`;
  const providerDefault = provider === "onesignal" ? 8_000 : provider === "daily" ? 7_000 : 6_000;
  return numericEnv(key, numericEnv(`${provider.toUpperCase()}_PROVIDER_TIMEOUT_MS`, providerDefault, 500, 30_000), 500, 30_000);
}

function safeString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "unknown";
}

function sanitizeFields(fields: JsonRecord): JsonRecord {
  const sanitized: JsonRecord = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      sanitized[key] = value;
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 20).map((item) => typeof item === "string" ? sanitizeString(item) : item);
      continue;
    }
    if (typeof value === "object") {
      sanitized[key] = sanitizeFields(value as JsonRecord);
    }
  }
  return sanitized;
}

function sanitizeString(value: string): string {
  if (SECRET_KEY_PATTERN.test(value)) return "[redacted]";
  try {
    const url = new URL(value);
    url.search = "";
    return url.toString().slice(0, 500);
  } catch {
    return value.slice(0, 500);
  }
}
