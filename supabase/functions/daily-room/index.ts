import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  buildVideoDateRoomProperties,
  buildMeetingTokenProperties,
  DAILY_VIDEO_DATE_ROOM_TTL_SECONDS as DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT,
  classifyDeleteRoomSafety,
  isDailyRoomAlreadyExistsErrorText,
  isDailyRoomUrlForName,
  planDailyProviderRoomRecovery,
  resolveCanonicalVideoDateRoom,
  resolveDailyRuntimeConfig,
  videoDateRoomNameForSession,
  videoDateRoomUrlForName as buildVideoDateRoomUrlForName,
  type DateRoomAction,
} from "./dailyRoomContracts.ts";
import {
  captureVideoDateProviderException,
  enforceProviderRateLimit,
  fetchWithTimeout,
  numericEnv,
  parseRetryAfterSeconds,
  providerFailureCode,
  providerFailureRetryAfter,
  providerFetchTimeoutMs,
  ProviderRateLimitError,
  providerRateLimitConfig,
} from "../_shared/video-date-provider-reliability.ts";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

type CorsHeaders = Record<string, string>;

const DAILY_RUNTIME_CONFIG = resolveDailyRuntimeConfig({
  dailyApiKey: Deno.env.get("DAILY_API_KEY")?.trim(),
  dailyDomainEnv: Deno.env.get("DAILY_DOMAIN")?.trim(),
  environment: Deno.env.get("ENVIRONMENT")?.trim(),
  allowLocalFallback: true,
  requireApiKey: true,
});
const DAILY_API_KEY = DAILY_RUNTIME_CONFIG.dailyApiKey ?? "";
const DAILY_DOMAIN = DAILY_RUNTIME_CONFIG.dailyDomain;
if (!DAILY_RUNTIME_CONFIG.ok) {
  console.error(JSON.stringify({
    event: "daily_runtime_config_blocked",
    code: "DAILY_CONFIG_BLOCKED",
    blockers: DAILY_RUNTIME_CONFIG.blockers,
    fallback_used: DAILY_RUNTIME_CONFIG.fallbackUsed,
  }));
} else if (DAILY_RUNTIME_CONFIG.fallbackUsed) {
  console.error(JSON.stringify({
    event: "daily_domain_local_fallback_used",
    code: "DAILY_DOMAIN_FALLBACK_USED",
    daily_domain: DAILY_DOMAIN,
  }));
}
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS_CONTRACT;
// The installed Daily web/native SDKs do not expose a typed meeting-token
// refresh method after join. Keep video-date tokens finite but aligned with the
// private provider room lifetime so users are not ejected mid-date by token exp.
const DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = DAILY_VIDEO_DATE_ROOM_TTL_SECONDS;
const DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS = 2 * 60 * 1000;
const DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS = 180;
const DAILY_VIDEO_DATE_HANDSHAKE_SECONDS = 60;
const DAILY_VIDEO_DATE_BASE_DATE_SECONDS = 300;
const DAILY_VIDEO_DATE_PROVIDER_PROOF_FRESH_MS = 90_000;
const DAILY_VIDEO_DATE_PROVIDER_PROOF_CLOCK_SKEW_MS = 5_000;
const DAILY_PROVIDER_MAX_RETRY_SLEEP_SECONDS = numericEnv("DAILY_PROVIDER_MAX_RETRY_SLEEP_SECONDS", 5, 0, 30);
const EDGE_PROCESS_STARTED_AT_MS = Date.now();

const DAILY_CONFIG_REQUIRED_ACTIONS = new Set([
  "prepare_date_entry",
  "delete_room",
]);

let providerReliabilityClient: any = null;

function getProviderReliabilityClient(): any {
  if (providerReliabilityClient) return providerReliabilityClient;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  providerReliabilityClient = createClient(supabaseUrl, serviceRoleKey);
  return providerReliabilityClient;
}

type VideoDateRoomGateSession = {
  id: string;
  event_id?: string | null;
  participant_1_id: string | null;
  participant_2_id: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  daily_room_provider_verify_reason?: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  handshake_started_at: string | null;
  date_started_at?: string | null;
  date_extra_seconds?: number | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | null;
  state: string | null;
  phase?: string | null;
};

type ClientRequestContext = {
  client_platform: string | null;
  client_platform_version: string | null;
  client_runtime: string | null;
  client_runtime_version: string | null;
};

type SupabaseEdgeClient = ReturnType<typeof createClient<any>>;

type DailyProviderOperation = "create_room" | "create_token" | "lookup_room" | "delete_room";

type DailyProviderErrorCode =
  | "DAILY_AUTH_FAILED"
  | "DAILY_RATE_LIMIT"
  | "DAILY_PROVIDER_UNAVAILABLE"
  | "DAILY_REQUEST_REJECTED"
  | "DAILY_PROVIDER_ERROR";

class DailyProviderError extends Error {
  readonly operation: DailyProviderOperation;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly roomName: string | null;
  readonly vibelyCode: DailyProviderErrorCode;
  readonly httpStatus: number;
  readonly clientMessage: string;
  readonly retryAfterSeconds: number | null;

  constructor(params: {
    operation: DailyProviderOperation;
    status: number | null;
    providerCode?: string | null;
    roomName?: string | null;
    vibelyCode: DailyProviderErrorCode;
    httpStatus: number;
    clientMessage: string;
    retryAfterSeconds?: number | null;
  }) {
    super(
      params.status == null
        ? `Daily ${params.operation} failed`
        : `Daily ${params.operation} failed with status ${params.status}`,
    );
    this.name = "DailyProviderError";
    this.operation = params.operation;
    this.status = params.status;
    this.providerCode = params.providerCode ?? null;
    this.roomName = params.roomName ?? null;
    this.vibelyCode = params.vibelyCode;
    this.httpStatus = params.httpStatus;
    this.clientMessage = params.clientMessage;
    this.retryAfterSeconds = typeof params.retryAfterSeconds === "number" && Number.isFinite(params.retryAfterSeconds)
      ? Math.min(300, Math.max(1, Math.ceil(params.retryAfterSeconds)))
      : null;
  }
}

function isDailyProviderError(error: unknown): error is DailyProviderError {
  return error instanceof DailyProviderError;
}

async function dailyProviderFetch(
  operation: DailyProviderOperation,
  bucket: string,
  input: string,
  init: RequestInit,
  roomName?: string | null,
): Promise<Response> {
  if (!DAILY_API_KEY) {
    throw new DailyProviderError({
      operation,
      status: null,
      providerCode: "daily_api_key_missing",
      roomName,
      vibelyCode: "DAILY_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
      clientMessage: "Video service temporarily unavailable.",
    });
  }

  const reliabilityClient = getProviderReliabilityClient();
  if (!reliabilityClient) {
    throw new DailyProviderError({
      operation,
      status: null,
      providerCode: "provider_reliability_client_missing",
      roomName,
      vibelyCode: "DAILY_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
      clientMessage: "Video service temporarily unavailable.",
    });
  }

  try {
    await enforceProviderRateLimit(reliabilityClient, providerRateLimitConfig("daily", bucket));
    return await fetchWithTimeout(input, init, {
      provider: "daily",
      operation,
      timeoutMs: providerFetchTimeoutMs("daily", operation),
      retryAfterSeconds: 30,
    });
  } catch (error) {
    const code = providerFailureCode(error);
    const rateLimited = error instanceof ProviderRateLimitError || code === "provider_rate_limited";
    const retryAfterSeconds = rateLimited ? providerFailureRetryAfter(error, 30) : null;
    await captureVideoDateProviderException(error, {
      provider: "daily",
      operation,
      room_name: roomName ?? null,
      provider_code: code,
      retry_after_seconds: retryAfterSeconds,
    });
    throw new DailyProviderError({
      operation,
      status: null,
      providerCode: code,
      roomName,
      vibelyCode: rateLimited
        ? "DAILY_RATE_LIMIT"
        : "DAILY_PROVIDER_UNAVAILABLE",
      httpStatus: rateLimited ? 429 : 503,
      clientMessage: rateLimited
        ? "Video service is rate limited. Please try again shortly."
        : "Video service temporarily unavailable.",
      retryAfterSeconds,
    });
  }
}

function sanitizeEntryAttemptId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

function createServerVideoDateTraceId(nowMs: number = Date.now()): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return `vdt_${nowMs.toString(36)}_${random}`;
}

function createDailyRoomHealthPingResponse(params: {
  requestStartedAt: number;
  edgeProcessUptimeMs: number;
  corsHeaders: CorsHeaders;
  authTimingMs?: number | null;
  authenticatedUserId?: string | null;
  source?: unknown;
}) {
  const responseReadyMs = Math.max(0, Date.now() - params.requestStartedAt);
  const timings: Record<string, number> = {
    edge_cold_start_ms: params.edgeProcessUptimeMs,
    edge_process_uptime_ms: params.edgeProcessUptimeMs,
    response_ready_ms: responseReadyMs,
    total_ms: responseReadyMs,
  };
  if (params.authTimingMs != null) timings.auth_ms = params.authTimingMs;
  console.log(JSON.stringify({
    event: "daily_room_health_ping_ok",
    source: typeof params.source === "string" ? params.source : null,
    authenticated: Boolean(params.authenticatedUserId),
    user_id: params.authenticatedUserId ?? null,
    timings,
  }));
  return new Response(
    JSON.stringify({
      success: true,
      ok: true,
      action: "health_ping",
      edge_cold_start_ms: params.edgeProcessUptimeMs,
      edge_process_uptime_ms: params.edgeProcessUptimeMs,
      timings,
    }),
    { headers: { ...params.corsHeaders, "Content-Type": "application/json" } },
  );
}

function createDailyConfigBlockedResponse(action: unknown, userId: string | null, corsHeaders: CorsHeaders) {
  const actionName = typeof action === "string" ? action : "unknown";
  console.error(JSON.stringify({
    event: "daily_config_blocked_request",
    code: "DAILY_CONFIG_BLOCKED",
    action: actionName,
    user_id: userId,
    blockers: DAILY_RUNTIME_CONFIG.blockers,
    fallback_used: DAILY_RUNTIME_CONFIG.fallbackUsed,
  }));
  return new Response(
    JSON.stringify({
      ok: false,
      success: false,
      code: "DAILY_CONFIG_BLOCKED",
      error: "Video service temporarily unavailable.",
      retryable: true,
      blockers: DAILY_RUNTIME_CONFIG.blockers,
    }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}

function dailyConfigRequiredForAction(action: unknown): boolean {
  return typeof action === "string" && DAILY_CONFIG_REQUIRED_ACTIONS.has(action);
}

function readVideoDateTraceContext(body: Record<string, unknown>, action: unknown): {
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
} {
  const providedEntryAttemptId = sanitizeEntryAttemptId(body?.entry_attempt_id ?? body?.entryAttemptId);
  const providedTraceId = sanitizeEntryAttemptId(body?.video_date_trace_id ?? body?.videoDateTraceId);
  const shouldGenerateTrace =
    action === "prepare_date_entry";
  const videoDateTraceId = providedTraceId ?? providedEntryAttemptId ?? (shouldGenerateTrace ? createServerVideoDateTraceId() : null);
  return {
    entryAttemptId: providedEntryAttemptId ?? videoDateTraceId,
    videoDateTraceId,
  };
}

function toSafeProviderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

async function readDailyProviderErrorBody(res: Response): Promise<{
  text: string;
  providerCode: string | null;
}> {
  const text = await res.clone().text().catch(() => "");
  if (!text) return { text: "", providerCode: null };
  try {
    const parsed = JSON.parse(text) as {
      code?: unknown;
      error_code?: unknown;
      error?: unknown;
      info?: unknown;
      message?: unknown;
    };
    return {
      text,
      providerCode:
        toSafeProviderCode(parsed.code) ??
        toSafeProviderCode(parsed.error_code) ??
        toSafeProviderCode(parsed.error) ??
        toSafeProviderCode(parsed.info) ??
        toSafeProviderCode(parsed.message),
    };
  } catch {
    return { text, providerCode: null };
  }
}

function classifyDailyProviderStatus(status: number): {
  vibelyCode: DailyProviderErrorCode;
  httpStatus: number;
  clientMessage: string;
} {
  if (status === 401 || status === 403) {
    return {
      vibelyCode: "DAILY_AUTH_FAILED",
      httpStatus: 502,
      clientMessage: "Video provider authentication failed.",
    };
  }
  if (status === 429) {
    return {
      vibelyCode: "DAILY_RATE_LIMIT",
      httpStatus: 429,
      clientMessage: "Video service is rate limited. Please try again shortly.",
    };
  }
  if (status >= 500) {
    return {
      vibelyCode: "DAILY_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
      clientMessage: "Video service temporarily unavailable.",
    };
  }
  if (status >= 400) {
    return {
      vibelyCode: "DAILY_REQUEST_REJECTED",
      httpStatus: 502,
      clientMessage: "Video provider rejected the room request.",
    };
  }
  return {
    vibelyCode: "DAILY_PROVIDER_ERROR",
    httpStatus: 503,
    clientMessage: "Video service temporarily unavailable.",
  };
}

async function dailyProviderErrorFromResponse(
  res: Response,
  operation: DailyProviderOperation,
  roomName?: string | null,
): Promise<DailyProviderError> {
  const { providerCode } = await readDailyProviderErrorBody(res);
  const classification = classifyDailyProviderStatus(res.status);
  return new DailyProviderError({
    operation,
    status: res.status,
    providerCode,
    roomName,
    retryAfterSeconds: res.status === 429 ? parseRetryAfterSeconds(res.headers, 30) : null,
    ...classification,
  });
}

function retryAfterHeaderValue(retryAfterSeconds: number | null | undefined): string | null {
  if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds)) return null;
  return String(Math.min(300, Math.max(1, Math.ceil(retryAfterSeconds))));
}

function jsonHeadersWithRetryAfter(
  corsHeaders: CorsHeaders,
  retryAfterSeconds: number | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    ...extra,
  };
  const retryAfter = retryAfterHeaderValue(retryAfterSeconds);
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return headers;
}

function retryAfterJsonFields(retryAfterSeconds: number | null | undefined): Record<string, number> {
  const retryAfter = retryAfterHeaderValue(retryAfterSeconds);
  return retryAfter
    ? {
      retry_after_seconds: Number(retryAfter),
      retryAfterSeconds: Number(retryAfter),
    }
    : {};
}

async function waitForBoundedDailyProviderRetry(headers: Headers, fallbackSeconds: number): Promise<boolean> {
  const retryAfterSeconds = parseRetryAfterSeconds(headers, fallbackSeconds);
  if (retryAfterSeconds > DAILY_PROVIDER_MAX_RETRY_SLEEP_SECONDS) return false;
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
  return true;
}

function logDailyProviderFailure(
  error: DailyProviderError,
  context: {
    action?: string | null;
    sessionId?: string | null;
    userId?: string | null;
    roomName?: string | null;
    matchId?: string | null;
    callId?: string | null;
    entryAttemptId?: string | null;
    videoDateTraceId?: string | null;
  } = {},
) {
  console.error(
    JSON.stringify({
      event: "daily_provider_error",
      operation: error.operation,
      status: error.status,
      providerCode: error.providerCode,
      room_name: context.roomName ?? error.roomName,
      session_id: context.sessionId ?? null,
      user_id: context.userId ?? null,
      match_id: context.matchId ?? null,
      call_id: context.callId ?? null,
      action: context.action ?? null,
      entry_attempt_id: context.entryAttemptId ?? null,
      video_date_trace_id: context.videoDateTraceId ?? context.entryAttemptId ?? null,
      vibely_code: error.vibelyCode,
      http_status: error.httpStatus,
    }),
  );
}

async function createDailyProviderFailureResponse(params: {
  serviceClient: SupabaseEdgeClient;
  error: DailyProviderError;
  action: DateRoomAction;
  sessionId: string | null | undefined;
  userId: string;
  corsHeaders: CorsHeaders;
  requestContext: ClientRequestContext;
  session?: VideoDateRoomGateSession | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
}) {
  logDailyProviderFailure(params.error, {
    action: params.action,
    sessionId: params.session?.id ?? params.sessionId ?? null,
    userId: params.userId,
    roomName: params.error.roomName,
    entryAttemptId: params.entryAttemptId ?? null,
    videoDateTraceId: params.videoDateTraceId ?? null,
  });
  await recordVideoDateProviderObservability({
    serviceClient: params.serviceClient,
    operation: "create_date_room_provider_error",
    outcome: "error",
    reasonCode: params.error.vibelyCode,
    eventId: params.session?.event_id ?? null,
    actorId: params.userId,
    sessionId: params.session?.id ?? (typeof params.sessionId === "string" ? params.sessionId : null),
    action: params.action,
    entryAttemptId: params.entryAttemptId ?? null,
    videoDateTraceId: params.videoDateTraceId ?? null,
    roomName: params.error.roomName,
    detail: {
      typed_error_code: params.error.vibelyCode,
      provider_operation: params.error.operation,
      provider_status: params.error.status,
      provider_code: params.error.providerCode,
      http_status: params.error.httpStatus,
      retry_after_seconds: params.error.retryAfterSeconds,
    },
  });
  return createDateRoomRejectResponse({
    action: params.action,
    sessionId: params.sessionId,
    userId: params.userId,
    status: params.error.httpStatus,
    code: params.error.vibelyCode,
    error: params.error.clientMessage,
    message: params.error.clientMessage,
    corsHeaders: params.corsHeaders,
    requestContext: params.requestContext,
    session: params.session,
    detail: params.error.message,
    retryAfterSeconds: params.error.retryAfterSeconds,
    extra: {
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
      operation: params.error.operation,
      provider_status: params.error.status,
      provider_code: params.error.providerCode,
      retry_after_seconds: params.error.retryAfterSeconds,
    },
  });
}

function createGenericDailyProviderFailureResponse(
  error: DailyProviderError,
  action: string | null,
  userId: string | null,
  corsHeaders: CorsHeaders,
) {
  logDailyProviderFailure(error, {
    action,
    userId,
    roomName: error.roomName,
  });
  return new Response(
    JSON.stringify({
      error: error.clientMessage,
      code: error.vibelyCode,
      message: error.clientMessage,
      ...retryAfterJsonFields(error.retryAfterSeconds),
    }),
    {
      status: error.httpStatus,
      headers: jsonHeadersWithRetryAfter(corsHeaders, error.retryAfterSeconds),
    },
  );
}

function getClientRequestContext(req: Request): ClientRequestContext {
  return {
    client_platform: req.headers.get("x-supabase-client-platform"),
    client_platform_version: req.headers.get("x-supabase-client-platform-version"),
    client_runtime: req.headers.get("x-supabase-client-runtime"),
    client_runtime_version: req.headers.get("x-supabase-client-runtime-version"),
  };
}

function logDateRoomReject(params: {
  action: DateRoomAction;
  sessionId: string | null | undefined;
  userId: string;
  code: string;
  httpStatus: number;
  requestContext: ClientRequestContext;
  session?: VideoDateRoomGateSession | null;
  detail?: string | null;
  extra?: Record<string, unknown>;
  retryAfterSeconds?: number | null;
}) {
  const { action, sessionId, userId, code, httpStatus, requestContext, session, detail, extra } = params;
  console.log(
    JSON.stringify({
      event: `${action}_rejected`,
      emitted_code: code,
      http_status: httpStatus,
      has_token: false,
      session_id: session?.id ?? sessionId ?? null,
      user_id: userId,
      participant_1_id: session?.participant_1_id ?? null,
      participant_2_id: session?.participant_2_id ?? null,
      state: session?.state ?? null,
      phase: session?.phase ?? null,
      handshake_started_at: session?.handshake_started_at ?? null,
      ready_gate_status: session?.ready_gate_status ?? null,
      ready_gate_expires_at: session?.ready_gate_expires_at ?? null,
      ended_at: session?.ended_at ?? null,
      detail,
      ...requestContext,
      ...(extra ?? {}),
    }),
  );
}

function createDateRoomRejectResponse(params: {
  action: DateRoomAction;
  sessionId: string | null | undefined;
  userId: string;
  status: number;
  code: string;
  error: string;
  message?: string;
  corsHeaders: CorsHeaders;
  requestContext: ClientRequestContext;
  session?: VideoDateRoomGateSession | null;
  detail?: string | null;
  extra?: Record<string, unknown>;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
}) {
  logDateRoomReject({
    action: params.action,
    sessionId: params.sessionId,
    userId: params.userId,
    code: params.code,
    httpStatus: params.status,
    requestContext: params.requestContext,
    session: params.session,
    detail: params.detail,
    extra: params.extra,
  });
  return new Response(
    JSON.stringify({
      error: params.error,
      code: params.code,
      ...(params.message ? { message: params.message } : {}),
      ...(typeof params.retryable === "boolean" ? { retryable: params.retryable } : {}),
      ...retryAfterJsonFields(params.retryAfterSeconds),
      ...(params.extra ? { details: params.extra } : {}),
    }),
    {
      status: params.status,
      headers: jsonHeadersWithRetryAfter(params.corsHeaders, params.retryAfterSeconds),
    },
  );
}

type VideoDateProviderObservabilityOperation =
  | "create_date_room_attempt"
  | "create_date_room_reused_existing_db_room"
  | "create_date_room_provider_already_exists"
  | "create_date_room_provider_created"
  | "create_date_room_provider_recovered_or_recreated"
  | "create_date_room_provider_verify_skipped"
  | "create_date_room_token_issued"
  | "create_date_room_blocked_session_ended"
  | "create_date_room_blocked_access_denied"
  | "create_date_room_provider_error";

async function recordVideoDateProviderObservability(params: {
  serviceClient: SupabaseEdgeClient;
  operation: VideoDateProviderObservabilityOperation;
  outcome: "success" | "blocked" | "error" | "no_op";
  reasonCode?: string | null;
  latencyMs?: number | null;
  eventId?: string | null;
  actorId?: string | null;
  sessionId?: string | null;
  action?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  roomName?: string | null;
  detail?: Record<string, unknown>;
}) {
  const traceId = params.videoDateTraceId ?? params.entryAttemptId ?? null;
  const detail = {
    action: params.action ?? null,
    daily_room_name: params.roomName ?? null,
    entry_attempt_id: params.entryAttemptId ?? traceId,
    video_date_trace_id: traceId,
    outcome: params.outcome,
    ...(params.detail ?? {}),
  };

  try {
    const { error } = await params.serviceClient.rpc("record_event_loop_observability", {
      p_operation: params.operation,
      p_outcome: params.outcome,
      p_reason_code: params.reasonCode ?? null,
      p_latency_ms: params.latencyMs ?? null,
      p_event_id: params.eventId ?? null,
      p_actor_id: params.actorId ?? null,
      p_session_id: params.sessionId ?? null,
      p_detail: detail,
    });
    if (error) {
      console.warn(JSON.stringify({
        event: "video_date_provider_observability_failed",
        operation: params.operation,
        session_id: params.sessionId ?? null,
        actor_id: params.actorId ?? null,
        video_date_trace_id: traceId,
        message: error.message,
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      event: "video_date_provider_observability_failed",
      operation: params.operation,
      session_id: params.sessionId ?? null,
      actor_id: params.actorId ?? null,
      video_date_trace_id: traceId,
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

function createBlockedDateRoomResponse(params: {
  action: DateRoomAction;
  sessionId: string | null | undefined;
  userId: string;
  corsHeaders: CorsHeaders;
  requestContext: ClientRequestContext;
  session?: VideoDateRoomGateSession | null;
  detail?: string | null;
}) {
  return createDateRoomRejectResponse({
    action: params.action,
    sessionId: params.sessionId,
    userId: params.userId,
    status: 403,
    code: "BLOCKED_PAIR",
    error: "blocked_pair",
    message: "This call is no longer available.",
    corsHeaders: params.corsHeaders,
    requestContext: params.requestContext,
    session: params.session,
    detail: params.detail,
  });
}

function videoDateRoomGateSessionEnded(session: {
  ended_at?: string | null;
  state?: string | null;
  phase?: string | null;
  ready_gate_status?: string | null;
} | null): boolean {
  return Boolean(
    session &&
      (session.ended_at ||
        session.state === "ended" ||
        session.phase === "ended" ||
        session.ready_gate_status === "expired" ||
        session.ready_gate_status === "forfeited")
  );
}

async function persistVideoDateRoomMetadata(
  serviceClient: SupabaseEdgeClient,
  params: {
    sessionId: string;
    roomName: string;
    roomUrl: string;
    userId: string;
    action: DateRoomAction;
    entryAttemptId?: string | null;
    videoDateTraceId?: string | null;
    verifiedAt?: string | null;
    expiresAt?: string | null;
    providerVerifyReason?: string | null;
  },
): Promise<
  | { ok: true }
  | {
      ok: false;
      code: "DB_ROOM_PERSIST_FAILED" | "SESSION_ENDED" | "EVENT_NOT_ACTIVE" | "SESSION_NOT_FOUND";
      detail: string | null;
      session?: VideoDateRoomGateSession | null;
      extra?: Record<string, unknown>;
    }
> {
  const { data, error } = await serviceClient
    .from("video_sessions")
    .update({
      daily_room_name: params.roomName,
      daily_room_url: params.roomUrl,
      daily_room_verified_at: params.verifiedAt ?? new Date().toISOString(),
      daily_room_expires_at: params.expiresAt ?? null,
      daily_room_provider_verify_reason: params.providerVerifyReason ?? null,
    })
    .eq("id", params.sessionId)
    .is("ended_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.log(JSON.stringify({
      event: "video_date_room_metadata_persist_failed",
      action: params.action,
      session_id: params.sessionId,
      user_id: params.userId,
      room_name: params.roomName,
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
      code: error?.code ?? null,
      message: error?.message ?? (!data ? "no_session_row_updated" : null),
    }));

    const { data: latest, error: readError } = await serviceClient
      .from("video_sessions")
      .select(
        "id, event_id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, daily_room_verified_at, daily_room_expires_at, daily_room_provider_verify_reason, ended_at, ended_reason, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
      )
      .eq("id", params.sessionId)
      .maybeSingle();
    const session = (latest as VideoDateRoomGateSession | null) ?? null;
    const baseExtra: Record<string, unknown> = {
      operation: "persist_room_metadata",
      room_name: params.roomName,
      db_error_code: error?.code ?? null,
      db_error_message: error?.message ?? null,
      db_error_details: error?.details ?? null,
      db_error_hint: error?.hint ?? null,
      db_read_error_code: readError?.code ?? null,
      db_read_error_message: readError?.message ?? null,
      session_state: session?.state ?? null,
      session_phase: session?.phase ?? null,
      ready_gate_status: session?.ready_gate_status ?? null,
      ready_gate_expires_at: session?.ready_gate_expires_at ?? null,
      ended_at: session?.ended_at ?? null,
      ended_reason: session?.ended_reason ?? null,
    };

    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        detail: readError?.message ?? error?.message ?? "session_not_found_after_metadata_update",
        session: null,
        extra: baseExtra,
      };
    }

    if (session.ended_at || session.state === "ended" || session.phase === "ended" || session.ready_gate_status === "expired") {
      return {
        ok: false,
        code: "SESSION_ENDED",
        detail: error?.message ?? "session_ended_before_room_metadata_persisted",
        session,
        extra: baseExtra,
      };
    }

    let inactiveReason: string | null = null;
    if (session.event_id) {
      const { data: inactiveData, error: inactiveError } = await serviceClient.rpc("get_event_lobby_inactive_reason", {
        p_event_id: session.event_id,
      });
      inactiveReason = typeof inactiveData === "string" && inactiveData ? inactiveData : null;
      baseExtra.event_inactive_reason = inactiveReason;
      baseExtra.event_inactive_error_code = inactiveError?.code ?? null;
      baseExtra.event_inactive_error_message = inactiveError?.message ?? null;
    }

    if (inactiveReason) {
      return {
        ok: false,
        code: "EVENT_NOT_ACTIVE",
        detail: inactiveReason,
        session,
        extra: baseExtra,
      };
    }

    return {
      ok: false,
      code: "DB_ROOM_PERSIST_FAILED",
      detail: error?.message ?? "no_session_row_updated",
      session,
      extra: baseExtra,
    };
  }

  console.log(JSON.stringify({
    event: "video_date_room_metadata_persisted",
    action: params.action,
    session_id: params.sessionId,
    user_id: params.userId,
    room_name: params.roomName,
    entry_attempt_id: params.entryAttemptId ?? null,
    video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
  }));
  return { ok: true };
}

async function confirmVideoDateEntryPrepared(
  serviceClient: SupabaseEdgeClient,
  params: {
    sessionId: string;
    roomName: string;
    roomUrl: string;
    entryAttemptId?: string | null;
  },
): Promise<{ data: PrepareEntryTransitionPayload | null; error: unknown }> {
  const { data, error } = await serviceClient.rpc("confirm_video_date_entry_prepared", {
    p_session_id: params.sessionId,
    p_room_name: params.roomName,
    p_room_url: params.roomUrl,
    p_entry_attempt_id: params.entryAttemptId ?? null,
  });
  return { data: (data ?? null) as PrepareEntryTransitionPayload | null, error };
}

async function isPairBlocked(
  serviceClient: SupabaseEdgeClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const { data: blockA, error: blockAError } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userA)
    .eq("blocked_id", userB)
    .maybeSingle();

  if (blockAError) throw blockAError;
  if (blockA?.id) return true;

  const { data: blockB, error: blockBError } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userB)
    .eq("blocked_id", userA)
    .maybeSingle();

  if (blockBError) throw blockBError;
  return Boolean(blockB?.id);
}

async function createMeetingToken(
  roomName: string,
  userId: string,
  expSeconds: number,
  retries = 2,
  options: { ejectAtTokenExp?: boolean } = {},
): Promise<string> {
  const res = await dailyProviderFetch("create_token", "meeting_token", `${DAILY_API_URL}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      properties: buildMeetingTokenProperties({
        roomName,
        userId,
        ttlSeconds: expSeconds,
        ejectAtTokenExp: options.ejectAtTokenExp,
      }),
    }),
  }, roomName);

  if (res.status === 429 && retries > 0) {
    if (await waitForBoundedDailyProviderRetry(res.headers, 3 - retries)) {
      return createMeetingToken(roomName, userId, expSeconds, retries - 1, options);
    }
  }

  if (!res.ok) {
    throw await dailyProviderErrorFromResponse(res, "create_token", roomName);
  }

  const data = await res.json().catch(() => null) as { token?: unknown } | null;
  if (typeof data?.token !== "string" || !data.token) {
    throw new DailyProviderError({
      operation: "create_token",
      status: res.status,
      roomName,
      vibelyCode: "DAILY_PROVIDER_ERROR",
      httpStatus: 503,
      clientMessage: "Video service temporarily unavailable.",
    });
  }
  return data.token;
}

function meetingTokenExpiresAtIso(ttlSeconds: number, nowMs = Date.now()): string {
  return new Date(nowMs + ttlSeconds * 1000).toISOString();
}

function videoDatePhaseDeadlineAtMs(session: VideoDateRoomGateSession): number | null {
  const phase = String(session.phase ?? session.state ?? "");
  if ((phase === "date" || session.date_started_at) && session.date_started_at) {
    const startedAtMs = Date.parse(session.date_started_at);
    if (Number.isFinite(startedAtMs)) {
      const extraSeconds =
        typeof session.date_extra_seconds === "number" && Number.isFinite(session.date_extra_seconds)
          ? Math.max(0, Math.floor(session.date_extra_seconds))
          : 0;
      return startedAtMs + (DAILY_VIDEO_DATE_BASE_DATE_SECONDS + extraSeconds) * 1000;
    }
  }
  if ((phase === "handshake" || session.handshake_started_at) && session.handshake_started_at) {
    const startedAtMs = Date.parse(session.handshake_started_at);
    if (Number.isFinite(startedAtMs)) return startedAtMs + DAILY_VIDEO_DATE_HANDSHAKE_SECONDS * 1000;
  }
  if ((phase === "ready_gate" || session.ready_gate_status) && session.ready_gate_expires_at) {
    const expiresAtMs = Date.parse(session.ready_gate_expires_at);
    if (Number.isFinite(expiresAtMs)) return expiresAtMs;
  }
  return null;
}

async function isClientFeatureFlagEnabled(
  supabase: SupabaseEdgeClient,
  flag: string,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("evaluate_client_feature_flag", {
      p_flag: flag,
      p_user: userId,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

function resolveVideoDateMeetingTokenWindow(params: {
  session: VideoDateRoomGateSession;
  nowMs: number;
  dailyRoomExpiresAt?: string | null;
  phaseBoundedTokens?: boolean;
}): { ttlSeconds: number; expiresAtIso: string; reason: "phase_deadline" | "daily_room_expiry" | "max_ttl" } {
  const maxTtlMs = DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS * 1000;
  const minTtlMs = DAILY_VIDEO_DATE_TOKEN_MIN_TTL_SECONDS * 1000;
  const roomExpiresAtMs = params.dailyRoomExpiresAt ? Date.parse(params.dailyRoomExpiresAt) : NaN;
  const phaseDeadlineAtMs = params.phaseBoundedTokens === true
    ? videoDatePhaseDeadlineAtMs(params.session)
    : null;
  let targetExpiresAtMs = params.nowMs + maxTtlMs;
  let reason: "phase_deadline" | "daily_room_expiry" | "max_ttl" = "max_ttl";

  if (phaseDeadlineAtMs != null && phaseDeadlineAtMs > params.nowMs) {
    targetExpiresAtMs = phaseDeadlineAtMs + DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS;
    reason = "phase_deadline";
  } else if (phaseDeadlineAtMs != null) {
    targetExpiresAtMs = params.nowMs + minTtlMs;
    reason = "phase_deadline";
  } else if (Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > params.nowMs) {
    targetExpiresAtMs = roomExpiresAtMs;
    reason = "daily_room_expiry";
  }

  targetExpiresAtMs = Math.min(targetExpiresAtMs, params.nowMs + maxTtlMs);
  if (Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > params.nowMs) {
    targetExpiresAtMs = Math.min(targetExpiresAtMs, roomExpiresAtMs);
  }
  if (targetExpiresAtMs <= params.nowMs + minTtlMs) {
    targetExpiresAtMs = Math.min(
      params.nowMs + minTtlMs,
      Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > params.nowMs
        ? roomExpiresAtMs
        : params.nowMs + maxTtlMs,
    );
  }

  const ttlSeconds = Math.max(1, Math.ceil((targetExpiresAtMs - params.nowMs) / 1000));
  return {
    ttlSeconds,
    expiresAtIso: meetingTokenExpiresAtIso(ttlSeconds, params.nowMs),
    reason,
  };
}

async function createDailyRoom(
  roomName: string,
  props: Record<string, unknown>,
  retries = 2
): Promise<{ url: string; name: string; expiresAt: string | null; alreadyExisted?: boolean }> {
  const res = await dailyProviderFetch("create_room", "room_create", `${DAILY_API_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({ name: roomName, privacy: "private", properties: props }),
  }, roomName);

  if (res.status === 429 && retries > 0) {
    if (await waitForBoundedDailyProviderRetry(res.headers, 3 - retries)) {
      return createDailyRoom(roomName, props, retries - 1);
    }
  }

  if (res.status === 400) {
    const errBody = await readDailyProviderErrorBody(res);
    if (isDailyRoomAlreadyExistsErrorText(errBody.text)) {
      return { url: `https://${DAILY_DOMAIN}/${roomName}`, name: roomName, expiresAt: null, alreadyExisted: true };
    }
    throw await dailyProviderErrorFromResponse(res, "create_room", roomName);
  }

  if (!res.ok) {
    throw await dailyProviderErrorFromResponse(res, "create_room", roomName);
  }

  const room = (await res.json().catch(() => null)) as {
    url?: unknown;
    name?: unknown;
    config?: { exp?: unknown; max_participants?: unknown };
  } | null;
  const exp = room?.config?.exp;
  const expectedMaxParticipants =
    typeof props.max_participants === "number" ? props.max_participants : null;
  if (
    typeof room?.url !== "string" ||
    !isDailyRoomUrlForName(room.url, roomName, DAILY_DOMAIN) ||
    typeof room?.name !== "string" ||
    room.name !== roomName ||
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp <= Math.floor(Date.now() / 1000) ||
    (
      expectedMaxParticipants !== null &&
      room.config?.max_participants !== expectedMaxParticipants
    )
  ) {
    throw new DailyProviderError({
      operation: "create_room",
      status: res.status,
      roomName,
      vibelyCode: "DAILY_PROVIDER_ERROR",
      httpStatus: 503,
      clientMessage: "Video service temporarily unavailable.",
    });
  }
  return { url: room.url, name: room.name, expiresAt: new Date(exp * 1000).toISOString(), alreadyExisted: false };
}

async function getDailyRoomProviderState(roomName: string, retries = 2): Promise<{
  exists: boolean;
  expired: boolean;
  expiresAt: string | null;
}> {
  const res = await dailyProviderFetch("lookup_room", "room_lookup", `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  }, roomName);

  if (res.status === 429 && retries > 0) {
    if (await waitForBoundedDailyProviderRetry(res.headers, 3 - retries)) {
      return getDailyRoomProviderState(roomName, retries - 1);
    }
  }

  if (res.status === 404) return { exists: false, expired: false, expiresAt: null };
  if (!res.ok) {
    throw await dailyProviderErrorFromResponse(res, "lookup_room", roomName);
  }

  const room = (await res.json().catch(() => null)) as { config?: { exp?: number } } | null;
  const exp = typeof room?.config?.exp === "number" ? room.config.exp : null;
  const expired = exp != null && exp <= Math.floor(Date.now() / 1000);
  return {
    exists: true,
    expired,
    expiresAt: exp == null ? null : new Date(exp * 1000).toISOString(),
  };
}

type DeleteDailyRoomOutcome = "deleted" | "not_found_idempotent";

async function deleteDailyRoom(
  roomName: string,
  options: { throwOnProviderError?: boolean } = {},
  retries = 2,
): Promise<DeleteDailyRoomOutcome> {
  try {
    const res = await dailyProviderFetch("delete_room", "room_delete", `${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    }, roomName);
    if (res.status === 429 && retries > 0) {
      if (await waitForBoundedDailyProviderRetry(res.headers, 3 - retries)) {
        return deleteDailyRoom(roomName, options, retries - 1);
      }
    }
    if (res.ok) return "deleted";
    if (res.status === 404) return "not_found_idempotent";
    const providerError = await dailyProviderErrorFromResponse(res, "delete_room", roomName);
    if (options.throwOnProviderError) throw providerError;
    logDailyProviderFailure(providerError, { roomName });
  } catch (error) {
    if (options.throwOnProviderError) throw error;
    // Best-effort
  }
  return "not_found_idempotent";
}

function videoDateRoomProperties(): Record<string, unknown> {
  return buildVideoDateRoomProperties({
    nowSeconds: Math.floor(Date.now() / 1000),
    ttlSeconds: DAILY_VIDEO_DATE_ROOM_TTL_SECONDS,
  });
}

function videoDateRoomUrlForName(roomName: string): string {
  return buildVideoDateRoomUrlForName(roomName, DAILY_DOMAIN);
}

type VideoDateProviderRoomProof =
  | {
      ok: true;
      roomName: string;
      roomUrl: string;
      reusedRoom: boolean;
      providerRoomRecreated: boolean;
      providerRoomRecovered: boolean;
      providerVerifySkipped: boolean;
      providerVerifyReason: string;
      dailyRoomVerifiedAt: string | null;
      dailyRoomExpiresAt: string | null;
    }
  | { ok: false; response: Response };

function hasFreshVideoDateProviderRoomProof(params: {
  session: VideoDateRoomGateSession;
  roomName: string;
  roomUrl: string;
  nowMs?: number;
}): boolean {
  const nowMs = params.nowMs ?? Date.now();
  if (params.session.daily_room_name !== params.roomName) return false;
  if (params.session.daily_room_url !== params.roomUrl) return false;
  const verifiedAtMs = params.session.daily_room_verified_at
    ? new Date(params.session.daily_room_verified_at).getTime()
    : NaN;
  if (!Number.isFinite(verifiedAtMs)) return false;
  if (verifiedAtMs - nowMs > DAILY_VIDEO_DATE_PROVIDER_PROOF_CLOCK_SKEW_MS) return false;
  if (nowMs - verifiedAtMs > DAILY_VIDEO_DATE_PROVIDER_PROOF_FRESH_MS) return false;
  const expiresAtMs = params.session.daily_room_expires_at
    ? new Date(params.session.daily_room_expires_at).getTime()
    : NaN;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs + 60_000) return false;
  return true;
}

async function ensureVideoDateProviderRoomForToken(params: {
  serviceClient: SupabaseEdgeClient;
  action: DateRoomAction;
  sessionId: string;
  userId: string;
  session: VideoDateRoomGateSession;
  corsHeaders: CorsHeaders;
  requestContext: ClientRequestContext;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
}): Promise<VideoDateProviderRoomProof> {
  const existingRoomName = params.session.daily_room_name ?? null;
  const existingRoomUrl = params.session.daily_room_url ?? null;
  const { roomName, roomUrl, metadataMatchesCanonical } = resolveCanonicalVideoDateRoom({
    sessionId: params.sessionId,
    dailyDomain: DAILY_DOMAIN,
    existingRoomName,
    existingRoomUrl,
  });
  let reusedRoom = metadataMatchesCanonical;
  let providerRoomRecreated = false;
  let providerRoomRecovered = false;
  let providerVerifyReason = "provider_room_exists";
  let dailyRoomVerifiedAt: string | null = null;
  let dailyRoomExpiresAt: string | null = null;

  const providerStartedAt = Date.now();
  await recordVideoDateProviderObservability({
    serviceClient: params.serviceClient,
    operation: "create_date_room_attempt",
    outcome: "success",
    reasonCode: params.action,
    eventId: params.session.event_id ?? null,
    actorId: params.userId,
    sessionId: params.sessionId,
    action: params.action,
    entryAttemptId: params.entryAttemptId ?? null,
    videoDateTraceId: params.videoDateTraceId ?? null,
    roomName,
    detail: {
      existing_room_name: existingRoomName,
      metadata_matches_canonical: metadataMatchesCanonical,
    },
  });

  if (hasFreshVideoDateProviderRoomProof({ session: params.session, roomName, roomUrl })) {
    providerVerifyReason = "fresh_provider_room_proof";
    await recordVideoDateProviderObservability({
      serviceClient: params.serviceClient,
      operation: "create_date_room_provider_verify_skipped",
      outcome: "success",
      reasonCode: providerVerifyReason,
      latencyMs: Date.now() - providerStartedAt,
      eventId: params.session.event_id ?? null,
      actorId: params.userId,
      sessionId: params.sessionId,
      action: params.action,
      entryAttemptId: params.entryAttemptId ?? null,
      videoDateTraceId: params.videoDateTraceId ?? null,
      roomName,
      detail: {
        daily_room_verified_at: params.session.daily_room_verified_at ?? null,
        daily_room_expires_at: params.session.daily_room_expires_at ?? null,
        metadata_matches_canonical: metadataMatchesCanonical,
      },
    });
    return {
      ok: true,
      roomName,
      roomUrl,
      reusedRoom: true,
      providerRoomRecreated: false,
      providerRoomRecovered: false,
      providerVerifySkipped: true,
      providerVerifyReason,
      dailyRoomVerifiedAt: params.session.daily_room_verified_at ?? null,
      dailyRoomExpiresAt: params.session.daily_room_expires_at ?? null,
    };
  }

  const providerRoomState = await getDailyRoomProviderState(roomName);
  const recoveryPlan = planDailyProviderRoomRecovery(providerRoomState);
  dailyRoomVerifiedAt = new Date().toISOString();
  dailyRoomExpiresAt = providerRoomState.expiresAt ?? null;
  if (recoveryPlan.shouldCreate) {
    providerRoomRecovered = Boolean(existingRoomName) || providerRoomState.expired;
    providerRoomRecreated = Boolean(existingRoomName) || providerRoomState.expired;
    reusedRoom = false;
    providerVerifyReason = providerRoomState.expired ? "provider_expired" : "provider_missing";
    console.log(JSON.stringify({
      event: "video_date_provider_room_missing_or_expired_recovering",
      action: params.action,
      session_id: params.sessionId,
      user_id: params.userId,
      room_name: roomName,
      existing_room_name: existingRoomName,
      existing_room_url: existingRoomUrl,
      provider_exists: providerRoomState.exists,
      provider_expired: providerRoomState.expired,
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
    }));
    if (recoveryPlan.shouldDeleteExpired) {
      await deleteDailyRoom(roomName, { throwOnProviderError: true });
    }
    const providerRoom = await createDailyRoom(roomName, videoDateRoomProperties());
    dailyRoomVerifiedAt = new Date().toISOString();
    if (providerRoom.alreadyExisted === true) {
      const verifiedExisting = await getDailyRoomProviderState(roomName);
      dailyRoomVerifiedAt = new Date().toISOString();
      if (!verifiedExisting.exists || verifiedExisting.expired) {
        if (verifiedExisting.expired) {
          await deleteDailyRoom(roomName, { throwOnProviderError: true });
        }
        const recreatedRoom = await createDailyRoom(roomName, videoDateRoomProperties());
        dailyRoomVerifiedAt = new Date().toISOString();
        if (recreatedRoom.alreadyExisted === true) {
          const finalProviderState = await getDailyRoomProviderState(roomName);
          dailyRoomVerifiedAt = new Date().toISOString();
          if (!finalProviderState.exists || finalProviderState.expired) {
            throw new Error("daily_provider_already_exists_recovery_failed");
          }
          dailyRoomExpiresAt = finalProviderState.expiresAt ?? null;
        } else {
          dailyRoomExpiresAt = recreatedRoom.expiresAt;
        }
        providerRoomRecovered = true;
        providerRoomRecreated = true;
        reusedRoom = false;
        providerVerifyReason = verifiedExisting.expired
          ? "provider_recreated_after_expired_already_exists"
          : "provider_recreated_after_missing_already_exists";
      } else {
        dailyRoomExpiresAt = verifiedExisting.expiresAt ?? null;
        providerVerifyReason = "provider_already_exists_after_create";
      }
    } else {
      dailyRoomExpiresAt = providerRoom.expiresAt;
    }
    await recordVideoDateProviderObservability({
      serviceClient: params.serviceClient,
      operation: providerRoom.alreadyExisted
        ? "create_date_room_provider_already_exists"
        : "create_date_room_provider_created",
      outcome: "success",
      reasonCode: providerRoom.alreadyExisted ? "provider_already_exists" : "provider_created",
      latencyMs: Date.now() - providerStartedAt,
      eventId: params.session.event_id ?? null,
      actorId: params.userId,
      sessionId: params.sessionId,
      action: params.action,
      entryAttemptId: params.entryAttemptId ?? null,
      videoDateTraceId: params.videoDateTraceId ?? null,
      roomName,
      detail: {
        provider_exists_before: providerRoomState.exists,
        provider_expired_before: providerRoomState.expired,
        provider_already_exists: providerRoom.alreadyExisted === true,
        provider_room_created: providerRoom.alreadyExisted !== true,
        provider_room_recreated: providerRoomRecreated,
        provider_room_recovered: providerRoomRecovered,
      },
    });
    if (providerRoomRecovered || providerRoomRecreated) {
      await recordVideoDateProviderObservability({
        serviceClient: params.serviceClient,
        operation: "create_date_room_provider_recovered_or_recreated",
        outcome: "success",
        reasonCode: providerRoomState.expired ? "provider_expired" : "provider_missing",
        latencyMs: Date.now() - providerStartedAt,
        eventId: params.session.event_id ?? null,
        actorId: params.userId,
        sessionId: params.sessionId,
        action: params.action,
        entryAttemptId: params.entryAttemptId ?? null,
        videoDateTraceId: params.videoDateTraceId ?? null,
        roomName,
        detail: {
          provider_exists_before: providerRoomState.exists,
          provider_expired_before: providerRoomState.expired,
          provider_room_recreated: providerRoomRecreated,
          provider_room_recovered: providerRoomRecovered,
        },
      });
    }
  } else if (!metadataMatchesCanonical) {
    reusedRoom = true;
    providerVerifyReason = "provider_room_exists_recanonicalized";
    await recordVideoDateProviderObservability({
      serviceClient: params.serviceClient,
      operation: "create_date_room_provider_already_exists",
      outcome: "success",
      reasonCode: "provider_room_exists",
      latencyMs: Date.now() - providerStartedAt,
      eventId: params.session.event_id ?? null,
      actorId: params.userId,
      sessionId: params.sessionId,
      action: params.action,
      entryAttemptId: params.entryAttemptId ?? null,
      videoDateTraceId: params.videoDateTraceId ?? null,
      roomName,
      detail: {
        metadata_matches_canonical: false,
        provider_exists_before: true,
        provider_expired_before: false,
      },
    });
    console.log(JSON.stringify({
      event: "video_date_provider_room_metadata_recanonicalized",
      action: params.action,
      session_id: params.sessionId,
      user_id: params.userId,
      room_name: roomName,
      existing_room_name: existingRoomName,
      existing_room_url: existingRoomUrl,
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
    }));
  } else {
    providerVerifyReason = "provider_room_exists";
    await recordVideoDateProviderObservability({
      serviceClient: params.serviceClient,
      operation: "create_date_room_reused_existing_db_room",
      outcome: "success",
      reasonCode: "metadata_matches_canonical",
      latencyMs: Date.now() - providerStartedAt,
      eventId: params.session.event_id ?? null,
      actorId: params.userId,
      sessionId: params.sessionId,
      action: params.action,
      entryAttemptId: params.entryAttemptId ?? null,
      videoDateTraceId: params.videoDateTraceId ?? null,
      roomName,
      detail: {
        provider_exists_before: true,
        provider_expired_before: false,
        metadata_matches_canonical: true,
      },
    });
    await recordVideoDateProviderObservability({
      serviceClient: params.serviceClient,
      operation: "create_date_room_provider_already_exists",
      outcome: "success",
      reasonCode: "provider_room_exists",
      latencyMs: Date.now() - providerStartedAt,
      eventId: params.session.event_id ?? null,
      actorId: params.userId,
      sessionId: params.sessionId,
      action: params.action,
      entryAttemptId: params.entryAttemptId ?? null,
      videoDateTraceId: params.videoDateTraceId ?? null,
      roomName,
      detail: {
        metadata_matches_canonical: true,
        provider_exists_before: true,
        provider_expired_before: false,
      },
    });
  }

  if (!metadataMatchesCanonical || providerRoomRecovered || providerRoomRecreated || dailyRoomVerifiedAt) {
    const persisted = await persistVideoDateRoomMetadata(params.serviceClient, {
      sessionId: params.sessionId,
      roomName,
      roomUrl,
      userId: params.userId,
      action: params.action,
      entryAttemptId: params.entryAttemptId,
      videoDateTraceId: params.videoDateTraceId,
      verifiedAt: dailyRoomVerifiedAt,
      expiresAt: dailyRoomExpiresAt,
      providerVerifyReason,
    });
    if (!persisted.ok) {
      return {
        ok: false,
        response: createDateRoomRejectResponse({
          action: params.action,
          sessionId: params.sessionId,
          userId: params.userId,
          status: statusForPrepareEntryCode(persisted.code),
          code: persisted.code,
          error:
            persisted.code === "SESSION_ENDED"
              ? "Session has ended"
              : persisted.code === "EVENT_NOT_ACTIVE"
                ? "Event is no longer active"
                : persisted.code === "SESSION_NOT_FOUND"
                  ? "Session not found"
                  : "Could not persist video room metadata",
          corsHeaders: params.corsHeaders,
          requestContext: params.requestContext,
          session: persisted.session ?? params.session,
          detail: persisted.detail,
          extra: {
            entry_attempt_id: params.entryAttemptId ?? null,
            video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
            ...(persisted.extra ?? { operation: "persist_room_metadata" }),
          },
        }),
      };
    }
  }

  return {
    ok: true,
    roomName,
    roomUrl,
    reusedRoom,
    providerRoomRecreated,
    providerRoomRecovered,
    providerVerifySkipped: false,
    providerVerifyReason,
    dailyRoomVerifiedAt,
    dailyRoomExpiresAt,
  };
}

type PrepareEntryTransitionPayload = {
  success?: boolean;
  code?: string;
  error?: string;
  preflight_only?: boolean;
  state?: string | null;
  phase?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  handshake_started_at?: string | null;
  date_started_at?: string | null;
  date_extra_seconds?: number | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  daily_room_provider_verify_reason?: string | null;
  entry_attempt_id?: string | null;
  retryable?: boolean;
  retry_after_seconds?: number | null;
  retry_after_ms?: number | null;
};

type ReadyGateActionabilityPayload = {
  ok?: boolean | string | number | null;
  success?: boolean | string | number | null;
  code?: string | null;
  error_code?: string | null;
  error?: string | null;
  reason?: string | null;
  retryable?: boolean | string | number | null;
  terminal?: boolean | string | number | null;
  retry_after_seconds?: number | string | null;
  retry_after_ms?: number | string | null;
  session_id?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  ready_gate_status?: string | null;
  status?: string | null;
  ready_gate_expires_at?: string | null;
  state?: string | null;
  phase?: string | null;
  ended_at?: string | null;
  registration_desync?: boolean | string | number | null;
  [key: string]: unknown;
};

function truthyPayloadField(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "t", "1", "yes"].includes(value.trim().toLowerCase());
  return false;
}

function optionalPayloadBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "t", "1", "yes"].includes(normalized)) return true;
    if (["false", "f", "0", "no"].includes(normalized)) return false;
  }
  return undefined;
}

function optionalPayloadNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function payloadText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function statusForReadyGateActionabilityCode(
  code?: string | null,
  payload?: ReadyGateActionabilityPayload | null,
): number {
  const normalized = (code ?? "").trim().toUpperCase();
  if (normalized === "AUTH_REQUIRED" || normalized === "UNAUTHORIZED") return 401;
  if (normalized === "SESSION_NOT_FOUND") return 404;
  if (
    normalized === "SESSION_ENDED" ||
    normalized === "READY_GATE_EXPIRED" ||
    normalized === "READY_GATE_STATUS_TIMESTAMP_DESYNC"
  ) return 410;
  if (
    normalized === "READY_GATE_ACTIONABILITY_UNAVAILABLE" ||
    normalized === "EVENT_ACTIVE_CHECK_UNAVAILABLE" ||
    normalized === "SAFETY_CHECK_UNAVAILABLE"
  ) return 503;
  if (
    normalized === "EVENT_NOT_ACTIVE" ||
    normalized === "READY_GATE_REGISTRATION_DESYNC" ||
    normalized === "TERMINALIZE_LOST_RACE"
  ) return 409;
  if (
    normalized === "ACCESS_DENIED" ||
    normalized === "BLOCKED_PAIR" ||
    normalized === "REPORTED_PAIR" ||
    normalized === "ACTOR_NOT_ELIGIBLE" ||
    normalized === "PARTNER_NOT_ELIGIBLE" ||
    normalized === "READY_GATE_NOT_OPEN" ||
    normalized === "READY_GATE_NOT_READY" ||
    normalized === "READY_GATE_SNOOZED" ||
    normalized === "PARTNER_SNOOZED"
  ) return 403;
  if (optionalPayloadBool(payload?.terminal) === true) return 410;
  if (optionalPayloadBool(payload?.retryable) === true) return 409;
  return 500;
}

function statusForPrepareEntryCode(code?: string): number {
  const actionabilityStatus = statusForReadyGateActionabilityCode(code);
  if (actionabilityStatus !== 500) return actionabilityStatus;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_ENDED") return 410;
  if (code === "EVENT_NOT_ACTIVE") return 409;
  if (code === "BLOCKED_PAIR" || code === "ACCESS_DENIED" || code === "READY_GATE_NOT_READY") return 403;
  if (code === "DB_ROOM_PERSIST_FAILED" || code === "REGISTRATION_PERSIST_FAILED") return 503;
  return 500;
}

async function requireVideoDateReadyGateActionability(params: {
  serviceClient: SupabaseEdgeClient;
  action: DateRoomAction;
  sessionId: string;
  userId: string;
  source: string;
  corsHeaders: CorsHeaders;
  requestContext: ClientRequestContext;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
}): Promise<Response | null> {
  const { data, error } = await params.serviceClient.rpc("video_date_ready_gate_actionability_v1", {
    p_session_id: params.sessionId,
    p_actor_id: params.userId,
    p_source: params.source,
    p_allow_actor_owned_snooze: false,
    p_require_current_ready_gate_registration: true,
    p_terminalize_invalid: true,
    p_lock_rows: true,
  });
  const payload = (data ?? null) as ReadyGateActionabilityPayload | null;
  if (!error && payload && truthyPayloadField(payload.ok ?? payload.success)) {
    return null;
  }

  const code = payloadText(payload?.code) ??
    payloadText(payload?.error_code) ??
    (error ? "READY_GATE_ACTIONABILITY_UNAVAILABLE" : "READY_GATE_NOT_ACTIONABLE");
  const reason = payloadText(payload?.reason) ?? payloadText(payload?.error) ?? "ready_gate_not_actionable";
  const retryAfterSeconds = optionalPayloadNumber(payload?.retry_after_seconds);
  const retryAfterMs = optionalPayloadNumber(payload?.retry_after_ms);
  const session: VideoDateRoomGateSession | null = payload
    ? {
        id: payloadText(payload.session_id) ?? params.sessionId,
        event_id: payloadText(payload.event_id),
        participant_1_id: payloadText(payload.participant_1_id),
        participant_2_id: payloadText(payload.participant_2_id),
        daily_room_name: null,
        ended_at: payloadText(payload.ended_at),
        handshake_started_at: null,
        ready_gate_status: payloadText(payload.ready_gate_status) ?? payloadText(payload.status),
        ready_gate_expires_at: payloadText(payload.ready_gate_expires_at),
        state: payloadText(payload.state),
        phase: payloadText(payload.phase),
      }
    : null;

  return createDateRoomRejectResponse({
    action: params.action,
    sessionId: params.sessionId,
    userId: params.userId,
    status: statusForReadyGateActionabilityCode(code, payload),
    code,
    error: reason,
    message: "This video date is no longer available.",
    corsHeaders: params.corsHeaders,
    requestContext: params.requestContext,
    session,
    detail: error ? error.message : null,
    retryable: optionalPayloadBool(payload?.retryable),
    retryAfterSeconds,
    extra: {
      actionability_source: params.source,
      actionability_code: code,
      actionability_reason: reason,
      ready_gate_status: payload?.ready_gate_status ?? payload?.status ?? null,
      terminal: optionalPayloadBool(payload?.terminal) ?? null,
      registration_desync: optionalPayloadBool(payload?.registration_desync) ?? null,
      retry_after_ms: retryAfterMs,
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
    },
  });
}

serve(async (req) => {
  const requestStartedAt = Date.now();
  const edgeProcessUptimeMs = Math.max(0, requestStartedAt - EDGE_PROCESS_STARTED_AT_MS);
  if (req.method === "OPTIONS")
    return preflightResponse(req);
  const corsHeaders = corsHeadersForRequest(req);
  if (isBrowserOriginRejected(req)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed", code: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let actionForLog: string | null = null;
  let userIdForLog: string | null = null;
  let authTimingMs: number | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    const requestContext = getClientRequestContext(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json();
    const { action, sessionId } = body;
    const { entryAttemptId, videoDateTraceId } = readVideoDateTraceContext(body, action);
    actionForLog = typeof action === "string" ? action : null;

    if (action === "health_ping") {
      const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
      const cronHeader = req.headers.get("x-cron-secret")?.trim();
      if (cronSecret && cronHeader === cronSecret) {
        return createDailyRoomHealthPingResponse({
          requestStartedAt,
          edgeProcessUptimeMs,
          corsHeaders,
          source: body.source,
        });
      }
    }

    // All actions require auth
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No auth header", code: "UNAUTHORIZED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const authStartedAt = Date.now();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    authTimingMs = Date.now() - authStartedAt;
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    userIdForLog = user.id;

    if (action === "health_ping") {
      return createDailyRoomHealthPingResponse({
        requestStartedAt,
        edgeProcessUptimeMs,
        corsHeaders,
        authTimingMs,
        authenticatedUserId: user.id,
        source: body.source,
      });
    }

    if (!DAILY_RUNTIME_CONFIG.ok && dailyConfigRequiredForAction(action)) {
      return createDailyConfigBlockedResponse(action, user.id, corsHeaders);
    }

    // ── ACTION: video_date_leave ──
    // Authenticated, non-destructive leave/away signal for unload/background paths.
    // This records reconnect state through the server-owned state machine; room
    // deletion remains cron-owned for video dates.
    if (action === "video_date_leave") {
      const actionName: DateRoomAction = "video_date_leave";
      if (typeof sessionId !== "string" || !sessionId) {
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: 400,
          code: "MISSING_SESSION_ID",
          error: "Missing or invalid sessionId",
          corsHeaders,
          requestContext,
        });
      }

      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 80)
          : "video_date_leave";
      const { data, error } = await supabase.rpc("video_date_transition", {
        p_session_id: sessionId,
        p_action: "mark_reconnect_self_away",
        p_reason: reason,
      });
      if (error || (data as { success?: boolean } | null)?.success === false) {
        const payload = (data ?? null) as {
          code?: string;
          error?: string;
          retryable?: boolean;
          retry_after_seconds?: number | null;
          retry_after_ms?: number | null;
        } | null;
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: payload?.code === "SESSION_ENDED" ? 410 : payload?.code === "ACCESS_DENIED" ? 403 : 409,
          code: payload?.code ?? "VIDEO_DATE_LEAVE_FAILED",
          error: payload?.error ?? "Could not mark video date leave",
          corsHeaders,
          requestContext,
          detail: error ? error.message : null,
          retryable: typeof payload?.retryable === "boolean" ? payload.retryable : error ? true : undefined,
          retryAfterSeconds: payload?.retry_after_seconds ?? null,
          extra: payload?.retry_after_ms == null ? undefined : { retry_after_ms: payload.retry_after_ms },
        });
      }

      console.log(JSON.stringify({
        event: "video_date_leave_recorded",
        session_id: sessionId,
        user_id: user.id,
        reason,
      }));
      return new Response(
        JSON.stringify({ success: true, code: "OK", data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── ACTION: delete_room ──
    // Requires auth. Caller must be a verified participant of the Video Date room.
    if (action === "delete_room") {
      const roomName = body.roomName;
      if (!roomName || typeof roomName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid roomName", code: "MISSING_ROOM_NAME" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let authorized = false;
      let roomType = "unknown";

      const { data: vsRow } = await supabase
        .from("video_sessions")
        .select("id, participant_1_id, participant_2_id, ended_at, state, phase")
        .eq("daily_room_name", roomName)
        .maybeSingle();

      if (vsRow) {
        authorized = vsRow.participant_1_id === user.id || vsRow.participant_2_id === user.id;
        roomType = "video_date";
      }

      console.log(JSON.stringify({
        event: "delete_room_attempt",
        user_id: user.id,
        room_name: roomName,
        room_type: roomType,
        authorized,
      }));

      if (!authorized) {
        return new Response(
          JSON.stringify({ error: "Not authorized to delete this room", code: "FORBIDDEN" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const decision = classifyDeleteRoomSafety({
        roomType: "video_date",
        endedAt: vsRow?.ended_at ?? null,
        state: vsRow?.state ?? null,
        phase: vsRow?.phase ?? null,
      });
      console.log(JSON.stringify({
        event: "delete_room_skipped",
        user_id: user.id,
        room_name: roomName,
        room_type: roomType,
        reason: "video_date_room_cleanup_owned_by_cron",
        session_id: vsRow?.id ?? null,
        session_ended: Boolean(vsRow?.ended_at),
        outcome: decision.outcome,
        code: decision.code,
      }));
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          code: decision.code,
          outcome: decision.outcome,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: prepare_date_entry ──
    // Single idempotent entry path for Ready Gate -> Daily join:
    // atomically prepare server state, create/reuse the deterministic Daily room,
    // then issue a caller-scoped token. Daily tokens are returned only to the
    // authenticated caller and are never persisted.
    if (action === "prepare_date_entry") {
      const actionName: DateRoomAction = "prepare_date_entry";
      const timings: Record<string, number> = {};
      const totalStartedAt = Date.now();
      timings.edge_cold_start_ms = edgeProcessUptimeMs;
      timings.edge_process_uptime_ms = edgeProcessUptimeMs;
      if (authTimingMs != null) timings.auth_ms = authTimingMs;
      timings.request_to_action_ms = Math.max(0, totalStartedAt - requestStartedAt);
      let sessionForLog: VideoDateRoomGateSession | null = null;

      if (typeof sessionId !== "string" || !sessionId) {
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: 400,
          code: "MISSING_SESSION_ID",
          error: "Missing or invalid sessionId",
          corsHeaders,
          requestContext,
        });
      }

      try {
        const actionabilityReject = await requireVideoDateReadyGateActionability({
          serviceClient,
          action: actionName,
          sessionId,
          userId: user.id,
          source: "daily_room.prepare_date_entry",
          corsHeaders,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        if (actionabilityReject) return actionabilityReject;

        const prepareStartedAt = Date.now();
        const { data: prepareData, error: prepareError } = await supabase.rpc("video_date_transition", {
          p_session_id: sessionId,
          p_action: "prepare_entry",
          p_reason: entryAttemptId ? `entry_attempt:${entryAttemptId}` : null,
        });
        timings.prepare_rpc_ms = Date.now() - prepareStartedAt;

        const preparePayload = (prepareData ?? null) as PrepareEntryTransitionPayload | null;
        sessionForLog = preparePayload
          ? {
              id: sessionId,
              event_id: preparePayload.event_id ?? null,
              participant_1_id: preparePayload.participant_1_id ?? null,
              participant_2_id: preparePayload.participant_2_id ?? null,
              daily_room_name: null,
              ended_at: preparePayload.state === "ended" ? new Date().toISOString() : null,
              handshake_started_at: preparePayload.handshake_started_at ?? null,
              ready_gate_status: preparePayload.ready_gate_status ?? null,
              ready_gate_expires_at: preparePayload.ready_gate_expires_at ?? null,
              state: preparePayload.state ?? null,
              phase: preparePayload.phase ?? null,
            }
          : null;

        if (prepareError || preparePayload?.success !== true) {
          const code = preparePayload?.code ?? (prepareError ? "RPC_ERROR" : "UNKNOWN");
          if (code === "SESSION_ENDED" || code === "ACCESS_DENIED") {
            await recordVideoDateProviderObservability({
              serviceClient,
              operation: code === "SESSION_ENDED"
                ? "create_date_room_blocked_session_ended"
                : "create_date_room_blocked_access_denied",
              outcome: "blocked",
              reasonCode: code,
              eventId: preparePayload?.event_id ?? null,
              actorId: user.id,
              sessionId,
              action: actionName,
              entryAttemptId,
              videoDateTraceId,
              roomName: videoDateRoomNameForSession(sessionId),
              detail: {
                typed_error_code: code,
                source: "prepare_entry_transition",
              },
            });
          }
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: preparePayload?.retryable === true ? 409 : statusForPrepareEntryCode(code),
            code,
            error: preparePayload?.error ?? "Could not prepare video date entry",
            corsHeaders,
            requestContext,
            session: sessionForLog,
            detail: prepareError ? prepareError.message : null,
            retryable: typeof preparePayload?.retryable === "boolean" ? preparePayload.retryable : undefined,
            retryAfterSeconds: preparePayload?.retry_after_seconds ?? null,
            extra: {
              entry_attempt_id: entryAttemptId,
              video_date_trace_id: videoDateTraceId,
              retry_after_ms: preparePayload?.retry_after_ms ?? null,
            },
          });
        }

        const participant1 = preparePayload.participant_1_id ?? null;
        const participant2 = preparePayload.participant_2_id ?? null;
        if (participant1 !== user.id && participant2 !== user.id) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "ACCESS_DENIED",
            eventId: preparePayload.event_id ?? null,
            actorId: user.id,
            sessionId,
            action: actionName,
            entryAttemptId,
            videoDateTraceId,
            roomName: videoDateRoomNameForSession(sessionId),
            detail: {
              typed_error_code: "ACCESS_DENIED",
              source: "participant_guard",
            },
          });
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            corsHeaders,
            requestContext,
            session: sessionForLog,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const partnerId = participant1 === user.id ? participant2 : participant1;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "BLOCKED_PAIR",
            eventId: preparePayload.event_id ?? null,
            actorId: user.id,
            sessionId,
            action: actionName,
            entryAttemptId,
            videoDateTraceId,
            roomName: videoDateRoomNameForSession(sessionId),
            detail: {
              typed_error_code: "BLOCKED_PAIR",
              source: "blocked_pair_guard",
            },
          });
          return createBlockedDateRoomResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            corsHeaders,
            requestContext,
            session: sessionForLog,
            detail: "service_role_post_prepare_block_check",
          });
        }

        const sessionRow: VideoDateRoomGateSession = {
          id: sessionId,
          event_id: preparePayload.event_id ?? null,
          participant_1_id: participant1,
          participant_2_id: participant2,
          daily_room_name: preparePayload.daily_room_name ?? null,
          daily_room_url: preparePayload.daily_room_url ?? null,
          daily_room_verified_at: preparePayload.daily_room_verified_at ?? null,
          daily_room_expires_at: preparePayload.daily_room_expires_at ?? null,
          daily_room_provider_verify_reason: preparePayload.daily_room_provider_verify_reason ?? null,
          ended_at: preparePayload.ended_at ?? (preparePayload.state === "ended" ? new Date().toISOString() : null),
          ended_reason: preparePayload.ended_reason ?? null,
          handshake_started_at: preparePayload.handshake_started_at ?? null,
          date_started_at: preparePayload.date_started_at ?? null,
          date_extra_seconds: preparePayload.date_extra_seconds ?? null,
          ready_gate_status: preparePayload.ready_gate_status ?? null,
          ready_gate_expires_at: preparePayload.ready_gate_expires_at ?? null,
          state: preparePayload.state ?? null,
          phase: preparePayload.phase ?? null,
        };

        sessionForLog = sessionRow;

        if (videoDateRoomGateSessionEnded(sessionForLog)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_session_ended",
            outcome: "blocked",
            reasonCode: "SESSION_ENDED",
            eventId: sessionForLog.event_id ?? null,
            actorId: user.id,
            sessionId,
            action: actionName,
            entryAttemptId,
            videoDateTraceId,
            roomName: videoDateRoomNameForSession(sessionId),
            detail: {
              typed_error_code: "SESSION_ENDED",
              source: "session_row_guard",
            },
          });
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            corsHeaders,
            requestContext,
            session: sessionForLog,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        // Durable entry contract: once both participants are ready and the
        // server owns deterministic room identity, persist routeable handshake
        // state before outbound provider work. Slow Daily verification/token
        // minting must not leave clients stranded in Ready Gate until cleanup
        // terminalizes the session.
        const roomName = preparePayload.daily_room_name ?? videoDateRoomNameForSession(sessionId);
        const roomUrl = preparePayload.daily_room_url ?? videoDateRoomUrlForName(roomName);
        const confirmStartedAt = Date.now();
        const { data: confirmPayload, error: confirmError } = await confirmVideoDateEntryPrepared(serviceClient, {
          sessionId,
          roomName,
          roomUrl,
          entryAttemptId,
        });
        timings.confirm_prepare_ms = Date.now() - confirmStartedAt;
        if (confirmError || confirmPayload?.success !== true) {
          const code = confirmPayload?.code ?? (confirmError ? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN");
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: confirmPayload?.retryable === true ? 409 : statusForPrepareEntryCode(code),
            code,
            error: confirmPayload?.error ?? "Could not persist date routing state",
            corsHeaders,
            requestContext,
            session: sessionForLog,
            detail: confirmError instanceof Error ? confirmError.message : confirmError ? String(confirmError) : null,
            retryable: typeof confirmPayload?.retryable === "boolean" ? confirmPayload.retryable : undefined,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId, operation: "confirm_prepare_entry" },
          });
        }
        sessionForLog = {
          ...(sessionRow as VideoDateRoomGateSession),
          daily_room_name: confirmPayload.daily_room_name ?? roomName,
          daily_room_url: confirmPayload.daily_room_url ?? roomUrl,
          state: confirmPayload.state ?? null,
          phase: confirmPayload.phase ?? null,
          handshake_started_at: confirmPayload.handshake_started_at ?? null,
          date_started_at: confirmPayload.date_started_at ?? sessionRow.date_started_at ?? null,
          date_extra_seconds: confirmPayload.date_extra_seconds ?? sessionRow.date_extra_seconds ?? null,
          ready_gate_status: confirmPayload.ready_gate_status ?? null,
          ready_gate_expires_at: confirmPayload.ready_gate_expires_at ?? null,
        };

        // Provider-idempotent room/token contract: with route state now durable,
        // verify/recreate provider-side room truth before token issuance, treat
        // Daily "already exists" as success, and write the same room_name/room_url
        // values idempotently through the already-confirmed session.
        const roomStartedAt = Date.now();
        const roomProof = await ensureVideoDateProviderRoomForToken({
          serviceClient,
          action: actionName,
          sessionId,
          userId: user.id,
          session: sessionForLog,
          corsHeaders,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        if (!roomProof.ok) {
          return roomProof.response;
        }
        const {
          roomName: providerRoomName,
          roomUrl: providerRoomUrl,
          reusedRoom,
          providerRoomRecreated,
          providerRoomRecovered,
          providerVerifySkipped,
          providerVerifyReason,
          dailyRoomVerifiedAt,
          dailyRoomExpiresAt,
        } = roomProof;
        timings.room_create_or_verify_ms = Date.now() - roomStartedAt;

        const tokenStartedAt = Date.now();
        const phaseBoundedTokens = await isClientFeatureFlagEnabled(
          serviceClient,
          "video_date.daily_token_refresh_v2",
          user.id,
        );
        const tokenWindow = resolveVideoDateMeetingTokenWindow({
          session: sessionForLog as VideoDateRoomGateSession,
          nowMs: tokenStartedAt,
          dailyRoomExpiresAt,
          phaseBoundedTokens,
        });
        const tokenExpiresAt = tokenWindow.expiresAtIso;
        const token = await createMeetingToken(
          providerRoomName,
          user.id,
          tokenWindow.ttlSeconds,
          undefined,
          { ejectAtTokenExp: true },
        );
        timings.token_ms = Date.now() - tokenStartedAt;
        await recordVideoDateProviderObservability({
          serviceClient,
          operation: "create_date_room_token_issued",
          outcome: "success",
          reasonCode: "token_issued",
          latencyMs: timings.token_ms,
          eventId: sessionForLog.event_id ?? null,
          actorId: user.id,
          sessionId,
          action: actionName,
          entryAttemptId,
          videoDateTraceId,
          roomName: providerRoomName,
          detail: {
            provider_room_reused: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_room_recovered: providerRoomRecovered,
            provider_verify_skipped: providerVerifySkipped,
            provider_verify_reason: providerVerifyReason,
            daily_room_verified_at: dailyRoomVerifiedAt,
            daily_room_expires_at: dailyRoomExpiresAt,
            token_ttl_seconds: tokenWindow.ttlSeconds,
            token_expiry_reason: tokenWindow.reason,
          },
        });
        timings.total_ms = Date.now() - totalStartedAt;
        timings.response_ready_ms = timings.total_ms;

        console.log(JSON.stringify({
          event: "prepare_date_entry_ok",
          session_id: sessionId,
          user_id: user.id,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          room_name: providerRoomName,
          reused_room: reusedRoom,
          provider_room_recreated: providerRoomRecreated,
          provider_room_recovered: providerRoomRecovered,
          provider_verify_skipped: providerVerifySkipped,
          provider_verify_reason: providerVerifyReason,
          daily_room_verified_at: dailyRoomVerifiedAt,
          daily_room_expires_at: dailyRoomExpiresAt,
          token_ttl_seconds: tokenWindow.ttlSeconds,
          token_expiry_reason: tokenWindow.reason,
          state: confirmPayload.state ?? null,
          phase: confirmPayload.phase ?? null,
          timings,
        }));

        return new Response(
          JSON.stringify({
            success: true,
            room_name: providerRoomName,
            room_url: providerRoomUrl,
            token,
            token_expires_at: tokenExpiresAt,
            token_ttl_seconds: tokenWindow.ttlSeconds,
            token_expiry_reason: tokenWindow.reason,
            session_state: confirmPayload.state ?? null,
            session_phase: confirmPayload.phase ?? null,
            handshake_started_at: confirmPayload.handshake_started_at ?? null,
            ready_gate_status: confirmPayload.ready_gate_status ?? null,
            ready_gate_expires_at: confirmPayload.ready_gate_expires_at ?? null,
            participant_1_id: confirmPayload.participant_1_id ?? participant1,
            participant_2_id: confirmPayload.participant_2_id ?? participant2,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            reused_room: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_room_recovered: providerRoomRecovered,
            provider_verify_skipped: providerVerifySkipped,
            provider_verify_reason: providerVerifyReason,
            daily_room_verified_at: dailyRoomVerifiedAt,
            daily_room_expires_at: dailyRoomExpiresAt,
            timings,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (error) {
        if (isDailyProviderError(error)) {
          return await createDailyProviderFailureResponse({
            serviceClient,
            error,
            action: actionName,
            sessionId,
            userId: user.id,
            corsHeaders,
            requestContext,
            session: sessionForLog,
            entryAttemptId,
            videoDateTraceId,
          });
        }
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: 503,
          code: "DAILY_PROVIDER_ERROR",
          error: "Video service temporarily unavailable",
          corsHeaders,
          requestContext,
          session: sessionForLog,
          detail: error instanceof Error ? error.message : String(error),
          extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (isDailyProviderError(error)) {
      return createGenericDailyProviderFailureResponse(
        error,
        actionForLog,
        userIdForLog,
        corsHeaders,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "daily_room_unhandled_exception",
        detail,
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );
    return new Response(
      JSON.stringify({
        error: "Video service temporarily unavailable",
        code: "DAILY_PROVIDER_ERROR",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
