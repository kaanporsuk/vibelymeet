import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildMeetingTokenProperties,
  canIssueAnswerTokenForMatchCallStatus,
  canReuseOpenMatchCallForCreateRetry,
  classifyDeleteRoomSafety,
  isDailyRoomAlreadyExistsErrorText,
  planDailyProviderRoomRecovery,
  resolveCanonicalVideoDateRoom,
  videoDateRoomNameForSession,
  videoDateRoomUrlForName as buildVideoDateRoomUrlForName,
  type DateRoomAction,
  type OpenMatchCallForRetry,
} from "./dailyRoomContracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_DOMAIN_FALLBACK = "vibelyapp.daily.co";
const DAILY_DOMAIN_ENV = Deno.env.get("DAILY_DOMAIN")?.trim();
const DAILY_DOMAIN = DAILY_DOMAIN_ENV || DAILY_DOMAIN_FALLBACK;
if (!DAILY_DOMAIN_ENV) {
  console.error(JSON.stringify({
    event: "daily_domain_env_missing",
    code: "DAILY_DOMAIN_FALLBACK_USED",
    daily_domain: DAILY_DOMAIN,
  }));
}
const DAILY_API_URL = "https://api.daily.co/v1";
const DAILY_MATCH_CALL_TOKEN_TTL_SECONDS = 30 * 60;
const DAILY_MATCH_CALL_ROOM_TTL_SECONDS = 60 * 60;
// Video dates can be extended with credits; keep provider credentials finite
// while covering the normal 5-minute flow plus generous extension/reconnect room.
const DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS = 15 * 60;
const DAILY_VIDEO_DATE_ROOM_TTL_SECONDS = 14_400;
const DAILY_VIDEO_DATE_PROVIDER_PROOF_FRESH_MS = 90_000;
const DAILY_VIDEO_DATE_PROVIDER_PROOF_CLOCK_SKEW_MS = 5_000;

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
  ready_gate_status: string | null;
  ready_gate_expires_at: string | null;
  state: string | null;
  phase?: string | null;
};

type MatchCallMatch = {
  id: string;
  profile_id_1: string;
  profile_id_2: string;
  archived_at: string | null;
};

type MatchCallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type?: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  status: string | null;
  match_id: string | null;
  ended_at?: string | null;
  provider_deleted_at?: string | null;
};

type ClientRequestContext = {
  client_platform: string | null;
  client_platform_version: string | null;
  client_runtime: string | null;
  client_runtime_version: string | null;
};

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

  constructor(params: {
    operation: DailyProviderOperation;
    status: number | null;
    providerCode?: string | null;
    roomName?: string | null;
    vibelyCode: DailyProviderErrorCode;
    httpStatus: number;
    clientMessage: string;
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
  }
}

function isDailyProviderError(error: unknown): error is DailyProviderError {
  return error instanceof DailyProviderError;
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

function readVideoDateTraceContext(body: Record<string, unknown>, action: unknown): {
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
} {
  const providedEntryAttemptId = sanitizeEntryAttemptId(body?.entry_attempt_id ?? body?.entryAttemptId);
  const providedTraceId = sanitizeEntryAttemptId(body?.video_date_trace_id ?? body?.videoDateTraceId);
  const shouldGenerateTrace =
    action === "prepare_date_entry" ||
    action === "ensure_date_room" ||
    action === "create_date_room" ||
    action === "join_date_room";
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
      httpStatus: 503,
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
    ...classification,
  });
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
  serviceClient: ReturnType<typeof createClient>;
  error: DailyProviderError;
  action: DateRoomAction;
  sessionId: string | null | undefined;
  userId: string;
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
    requestContext: params.requestContext,
    session: params.session,
    detail: params.error.message,
    extra: {
      entry_attempt_id: params.entryAttemptId ?? null,
      video_date_trace_id: params.videoDateTraceId ?? params.entryAttemptId ?? null,
      operation: params.error.operation,
      provider_status: params.error.status,
      provider_code: params.error.providerCode,
    },
  });
}

function createGenericDailyProviderFailureResponse(error: DailyProviderError, action: string | null, userId: string | null) {
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
    }),
    {
      status: error.httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  requestContext: ClientRequestContext;
  session?: VideoDateRoomGateSession | null;
  detail?: string | null;
  extra?: Record<string, unknown>;
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
      ...(params.extra ? { details: params.extra } : {}),
    }),
    {
      status: params.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  serviceClient: ReturnType<typeof createClient>;
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
    requestContext: params.requestContext,
    session: params.session,
    detail: params.detail,
  });
}

function createBlockedMatchCallResponse(params: {
  event: string;
  userId: string;
  peerId?: string | null;
  matchId?: string | null;
  callId?: string | null;
  detail?: string | null;
}) {
  console.log(
    JSON.stringify({
      event: params.event,
      code: "USERS_BLOCKED",
      user_id: params.userId,
      peer_id: params.peerId ?? null,
      match_id: params.matchId ?? null,
      call_id: params.callId ?? null,
      detail: params.detail ?? null,
      has_token: false,
    }),
  );

  return new Response(
    JSON.stringify({
      error: "blocked_pair",
      code: "USERS_BLOCKED",
      message: "This call is no longer available.",
    }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

/** Server-owned: allow Daily token only after provider-prepared handshake/date truth is confirmed. */
function canIssueVideoDateRoomToken(session: {
  ended_at: string | null;
  handshake_started_at: string | null;
  state: string | null;
  phase?: string | null;
}): boolean {
  if (videoDateRoomGateSessionEnded(session)) return false;
  if (
    session.state === "handshake" ||
    session.state === "date" ||
    session.handshake_started_at
  ) {
    return true;
  }
  return false;
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
  serviceClient: ReturnType<typeof createClient>,
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
  serviceClient: ReturnType<typeof createClient>,
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
  serviceClient: ReturnType<typeof createClient>,
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

async function maybeReturnBlockedDateSessionFallback(params: {
  serviceClient: ReturnType<typeof createClient>;
  action: DateRoomAction;
  sessionId: unknown;
  userId: string;
  requestContext: ClientRequestContext;
}): Promise<Response | null> {
  const { serviceClient, action, sessionId, userId, requestContext } = params;
  if (typeof sessionId !== "string" || !sessionId) return null;

  const { data, error } = await serviceClient
    .from("video_sessions")
    .select(
      "id, participant_1_id, participant_2_id, daily_room_name, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw error;

  const session = (data as VideoDateRoomGateSession | null) ?? null;
  if (!session) return null;
  if (session.participant_1_id !== userId && session.participant_2_id !== userId) {
    return null;
  }

  const partnerId = session.participant_1_id === userId ? session.participant_2_id : session.participant_1_id;
  if (partnerId && await isPairBlocked(serviceClient, userId, partnerId)) {
    return createBlockedDateRoomResponse({
      action,
      sessionId,
      userId,
      requestContext,
      session,
      detail: "service_role_participant_block_fallback",
    });
  }

  return null;
}

async function maybeReturnBlockedMatchFallback(params: {
  serviceClient: ReturnType<typeof createClient>;
  matchId: unknown;
  userId: string;
  event: string;
}): Promise<Response | null> {
  const { serviceClient, matchId, userId, event } = params;
  if (typeof matchId !== "string" || !matchId) return null;

  const { data, error } = await serviceClient
    .from("matches")
    .select("id, profile_id_1, profile_id_2, archived_at")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw error;

  const match = (data as MatchCallMatch | null) ?? null;
  if (!match) return null;
  if (match.profile_id_1 !== userId && match.profile_id_2 !== userId) {
    return null;
  }

  const peerId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
  if (await isPairBlocked(serviceClient, userId, peerId)) {
    return createBlockedMatchCallResponse({
      event,
      userId,
      peerId,
      matchId,
      detail: "service_role_participant_block_fallback",
    });
  }

  return null;
}

async function maybeReturnBlockedMatchCallFallback(params: {
  serviceClient: ReturnType<typeof createClient>;
  callId: unknown;
  userId: string;
  event: string;
}): Promise<Response | null> {
  const { serviceClient, callId, userId, event } = params;
  if (typeof callId !== "string" || !callId) return null;

  const { data, error } = await serviceClient
    .from("match_calls")
    .select("id, caller_id, callee_id, daily_room_name, daily_room_url, status, match_id")
    .eq("id", callId)
    .maybeSingle();

  if (error) throw error;

  const call = (data as MatchCallRow | null) ?? null;
  if (!call) return null;
  if (call.caller_id !== userId && call.callee_id !== userId) {
    return null;
  }

  const peerId = call.caller_id === userId ? call.callee_id : call.caller_id;
  if (await isPairBlocked(serviceClient, userId, peerId)) {
    return createBlockedMatchCallResponse({
      event,
      userId,
      peerId,
      matchId: call.match_id,
      callId,
      detail: "service_role_participant_block_fallback",
    });
  }

  return null;
}

async function createMeetingToken(
  roomName: string,
  userId: string,
  expSeconds: number,
  retries = 2,
  options: { ejectAtTokenExp?: boolean } = {},
): Promise<string> {
  const res = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
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
  });

  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 1000 * (3 - retries)));
    return createMeetingToken(roomName, userId, expSeconds, retries - 1, options);
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

async function createDailyRoom(
  roomName: string,
  props: Record<string, unknown>,
  retries = 2
): Promise<{ url: string; name: string; alreadyExisted?: boolean }> {
  const res = await fetch(`${DAILY_API_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({ name: roomName, privacy: "private", properties: props }),
  });

  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 1000 * (3 - retries)));
    return createDailyRoom(roomName, props, retries - 1);
  }

  if (res.status === 400) {
    const errBody = await readDailyProviderErrorBody(res);
    if (isDailyRoomAlreadyExistsErrorText(errBody.text)) {
      return { url: `https://${DAILY_DOMAIN}/${roomName}`, name: roomName, alreadyExisted: true };
    }
    throw await dailyProviderErrorFromResponse(res, "create_room", roomName);
  }

  if (!res.ok) {
    throw await dailyProviderErrorFromResponse(res, "create_room", roomName);
  }

  const room = await res.json();
  return { url: room.url, name: room.name, alreadyExisted: false };
}

async function getDailyRoomProviderState(roomName: string, retries = 2): Promise<{
  exists: boolean;
  expired: boolean;
  expiresAt: string | null;
}> {
  const res = await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  });

  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 1000 * (3 - retries)));
    return getDailyRoomProviderState(roomName, retries - 1);
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
    const res = await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    });
    if (res.status === 429 && retries > 0) {
      await new Promise((r) => setTimeout(r, 1000 * (3 - retries)));
      return deleteDailyRoom(roomName, options, retries - 1);
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
  return {
    max_participants: 2,
    enable_chat: false,
    enable_screenshare: false,
    enable_recording: false,
    enable_knocking: false,
    enforce_unique_user_ids: true,
    start_video_off: false,
    start_audio_off: false,
    exp: Math.floor(Date.now() / 1000) + DAILY_VIDEO_DATE_ROOM_TTL_SECONDS,
    eject_at_room_exp: true,
  };
}

function matchCallRoomProperties(callTypeValue: "voice" | "video"): Record<string, unknown> {
  return {
    max_participants: 2,
    enable_chat: false,
    enable_screenshare: false,
    enable_recording: false,
    enable_knocking: false,
    enforce_unique_user_ids: true,
    start_video_off: callTypeValue === "voice",
    start_audio_off: false,
    exp: Math.floor(Date.now() / 1000) + DAILY_MATCH_CALL_ROOM_TTL_SECONDS,
    eject_at_room_exp: true,
  };
}

function videoDateRoomUrlForName(roomName: string): string {
  return buildVideoDateRoomUrlForName(roomName, DAILY_DOMAIN);
}

function matchCallRoomUrlForName(roomName: string): string {
  return `https://${DAILY_DOMAIN}/${roomName}`;
}

async function ensureMatchCallProviderRoomForToken(params: {
  action: string;
  callId: string;
  matchId?: string | null;
  userId: string;
  roomName: string;
  roomUrl?: string | null;
  callType: "voice" | "video";
}): Promise<{ roomName: string; roomUrl: string; providerRoomRecreated: boolean; providerRoomRecovered: boolean }> {
  const roomName = params.roomName;
  const roomUrl = params.roomUrl ?? matchCallRoomUrlForName(roomName);
  const state = await getDailyRoomProviderState(roomName);
  const recoveryPlan = planDailyProviderRoomRecovery(state);

  if (recoveryPlan.shouldCreate) {
    console.log(JSON.stringify({
      event: "match_call_provider_room_missing_or_expired_recovering",
      action: params.action,
      call_id: params.callId,
      match_id: params.matchId ?? null,
      user_id: params.userId,
      room_name: roomName,
      provider_exists: state.exists,
      provider_expired: state.expired,
    }));
    if (recoveryPlan.shouldDeleteExpired) {
      await deleteDailyRoom(roomName, { throwOnProviderError: true });
    }
    await createDailyRoom(roomName, matchCallRoomProperties(params.callType));
  }

  return {
    roomName,
    roomUrl,
    providerRoomRecreated: recoveryPlan.providerRoomRecreated,
    providerRoomRecovered: recoveryPlan.providerRoomRecovered,
  };
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
  serviceClient: ReturnType<typeof createClient>;
  action: DateRoomAction;
  sessionId: string;
  userId: string;
  session: VideoDateRoomGateSession;
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
      dailyRoomExpiresAt = verifiedExisting.expiresAt ?? null;
      providerVerifyReason = verifiedExisting.expired ? "provider_expired" : "provider_already_exists_after_create";
    } else {
      dailyRoomExpiresAt = new Date(Date.now() + DAILY_VIDEO_DATE_ROOM_TTL_SECONDS * 1000).toISOString();
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
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  daily_room_provider_verify_reason?: string | null;
  entry_attempt_id?: string | null;
};

function statusForPrepareEntryCode(code?: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_ENDED") return 410;
  if (code === "EVENT_NOT_ACTIVE") return 409;
  if (code === "BLOCKED_PAIR" || code === "ACCESS_DENIED" || code === "READY_GATE_NOT_READY") return 403;
  if (code === "DB_ROOM_PERSIST_FAILED" || code === "REGISTRATION_PERSIST_FAILED") return 503;
  return 500;
}

type MatchCallProfileGate = {
  id: string;
  is_suspended: boolean | null;
  account_paused: boolean | null;
  account_paused_until: string | null;
  is_paused: boolean | null;
  paused_until: string | null;
};

function profileIsEffectivelyPaused(p: MatchCallProfileGate | null | undefined): boolean {
  if (!p) return true;
  const legacyPaused =
    p.is_paused === true &&
    (p.paused_until == null || new Date(p.paused_until) > new Date());
  const accountPaused =
    p.account_paused === true &&
    (p.account_paused_until == null || new Date(p.account_paused_until) > new Date());
  return legacyPaused || accountPaused;
}

function profileIsSuspended(p: MatchCallProfileGate | null | undefined): boolean {
  return p?.is_suspended === true;
}

/** Server-owned gates for chat match calls (aligns with product: no calls on archived/blocked/suspended/paused; one active/ringing row per match). */
async function assertCreateMatchCallAllowed(params: {
  serviceClient: ReturnType<typeof createClient>;
  matchId: string;
  callerId: string;
  calleeId: string;
  archivedAt: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; status: number; code: string; message: string; duplicateCall?: OpenMatchCallForRetry | null }
> {
  const { serviceClient, matchId, callerId, calleeId, archivedAt } = params;

  const { data: blockA } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", callerId)
    .eq("blocked_id", calleeId)
    .maybeSingle();

  const { data: blockB } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", calleeId)
    .eq("blocked_id", callerId)
    .maybeSingle();

  if (blockA || blockB) {
    return {
      ok: false,
      status: 403,
      code: "USERS_BLOCKED",
      message: "Cannot call this user",
    };
  }

  if (archivedAt != null) {
    return {
      ok: false,
      status: 403,
      code: "ARCHIVED_MATCH",
      message: "Archived match cannot start a call",
    };
  }

  const { data: dup } = await serviceClient
    .from("match_calls")
    .select("id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status")
    .eq("match_id", matchId)
    .in("status", ["ringing", "active"])
    .limit(1)
    .maybeSingle();

  if (dup?.id) {
    return {
      ok: false,
      status: 409,
      code: "DUPLICATE_ACTIVE_CALL",
      message: "A call is already in progress for this match",
      duplicateCall: dup as OpenMatchCallForRetry,
    };
  }

  const { data: profiles, error: profErr } = await serviceClient
    .from("profiles")
    .select("id, is_suspended, account_paused, account_paused_until, is_paused, paused_until")
    .in("id", [callerId, calleeId]);

  if (profErr || !profiles || profiles.length < 2) {
    return {
      ok: false,
      status: 403,
      code: "PROFILE_UNAVAILABLE",
      message: "Participant profiles unavailable",
    };
  }

  for (const row of profiles) {
    const p = row as MatchCallProfileGate;
    if (profileIsSuspended(p)) {
      return {
        ok: false,
        status: 403,
        code: "PARTICIPANT_SUSPENDED",
        message: "Account restricted",
      };
    }
    if (profileIsEffectivelyPaused(p)) {
      return {
        ok: false,
        status: 403,
        code: "PARTICIPANT_PAUSED",
        message: "Account paused",
      };
    }
  }

  return { ok: true };
}

async function fetchOpenMatchCallForMatch(
  serviceClient: ReturnType<typeof createClient>,
  matchId: string,
): Promise<OpenMatchCallForRetry | null> {
  const { data, error } = await serviceClient
    .from("match_calls")
    .select("id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status")
    .eq("match_id", matchId)
    .in("status", ["ringing", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as OpenMatchCallForRetry | null) ?? null;
}

function createDuplicateActiveMatchCallResponse(matchId: string, callerId: string, calleeId?: string | null) {
  console.log(
    JSON.stringify({
      event: "create_match_call_rejected",
      code: "DUPLICATE_ACTIVE_CALL",
      match_id: matchId,
      caller_id: callerId,
      callee_id: calleeId ?? null,
    }),
  );
  return new Response(
    JSON.stringify({
      error: "A call is already in progress for this match",
      code: "DUPLICATE_ACTIVE_CALL",
    }),
    {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

async function maybeCreateMatchCallRetryResponse(params: {
  call: OpenMatchCallForRetry | null | undefined;
  request: {
    matchId: string;
    callerId: string;
    calleeId: string;
    callType: "voice" | "video";
  };
}): Promise<Response | null> {
  if (!canReuseOpenMatchCallForCreateRetry(params.call, params.request)) {
    return null;
  }

  try {
    const providerRoom = await ensureMatchCallProviderRoomForToken({
      action: "create_match_call_retry",
      callId: params.call.id,
      matchId: params.call.match_id,
      userId: params.request.callerId,
      roomName: params.call.daily_room_name,
      roomUrl: params.call.daily_room_url,
      callType: params.request.callType,
    });
    const token = await createMeetingToken(
      providerRoom.roomName,
      params.request.callerId,
      DAILY_MATCH_CALL_TOKEN_TTL_SECONDS,
      undefined,
      { ejectAtTokenExp: true },
    );

    console.log(
      JSON.stringify({
        event: "create_match_call_retry_reused_existing_call",
        call_id: params.call.id,
        match_id: params.request.matchId,
        caller_id: params.request.callerId,
        callee_id: params.request.calleeId,
        call_type: params.request.callType,
        room_name: providerRoom.roomName,
        status: params.call.status,
        provider_room_recreated: providerRoom.providerRoomRecreated,
        provider_room_recovered: providerRoom.providerRoomRecovered,
        has_token: true,
      }),
    );

    return new Response(
      JSON.stringify({
        call_id: params.call.id,
        room_name: providerRoom.roomName,
        room_url: providerRoom.roomUrl,
        token,
        reused_call: true,
        status: params.call.status,
        provider_room_recreated: providerRoom.providerRoomRecreated,
        provider_room_recovered: providerRoom.providerRoomRecovered,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (tokenErr) {
    const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    if (isDailyProviderError(tokenErr)) {
      logDailyProviderFailure(tokenErr, {
        action: "create_match_call_retry",
        matchId: params.request.matchId,
        callId: params.call.id,
        userId: params.request.callerId,
        roomName: params.call.daily_room_name,
      });
    }
    console.error(
      JSON.stringify({
        event: "create_match_call_retry_token_failed",
        call_id: params.call.id,
        match_id: params.request.matchId,
        caller_id: params.request.callerId,
        room_name: params.call.daily_room_name,
        detail,
      }),
    );
    return new Response(
      JSON.stringify({
        error: "Call service temporarily unavailable",
        code: "TOKEN_ISSUE_FAILED",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}

serve(async (req) => {
  const requestStartedAt = Date.now();
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

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
    const { action, sessionId, matchId, callType, callId } = body;
    const { entryAttemptId, videoDateTraceId } = readVideoDateTraceContext(body, action);
    actionForLog = typeof action === "string" ? action : null;

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
        const payload = (data ?? null) as { code?: string; error?: string } | null;
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: payload?.code === "SESSION_ENDED" ? 410 : payload?.code === "ACCESS_DENIED" ? 403 : 409,
          code: payload?.code ?? "VIDEO_DATE_LEAVE_FAILED",
          error: payload?.error ?? "Could not mark video date leave",
          requestContext,
          detail: error ? error.message : null,
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
    // Requires auth. Caller must be a verified participant of the room (video_session or match_call).
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
      let callRow: MatchCallRow | null = null;

      // Check video_sessions first
      const { data: vsRow } = await supabase
        .from("video_sessions")
        .select("id, participant_1_id, participant_2_id, ended_at, state, phase")
        .eq("daily_room_name", roomName)
        .maybeSingle();

      if (vsRow) {
        authorized = vsRow.participant_1_id === user.id || vsRow.participant_2_id === user.id;
        roomType = "video_date";
      } else {
        // Fall back to match_calls
        const { data: rawCallRow } = await supabase
          .from("match_calls")
          .select("id, caller_id, callee_id, match_id, call_type, daily_room_name, daily_room_url, status, ended_at, provider_deleted_at")
          .eq("daily_room_name", roomName)
          .maybeSingle();
        callRow = (rawCallRow as MatchCallRow | null) ?? null;

        if (callRow) {
          authorized = callRow.caller_id === user.id || callRow.callee_id === user.id;
          roomType = "match_call";
        }
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

      if (roomType === "video_date") {
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

      if (roomType === "match_call" && callRow) {
        const decision = classifyDeleteRoomSafety({
          roomType: "match_call",
          status: callRow.status,
          endedAt: callRow.ended_at ?? null,
          providerDeletedAt: callRow.provider_deleted_at ?? null,
        });
        if (!decision.shouldDelete) {
          console.log(JSON.stringify({
            event: "delete_room_skipped",
            user_id: user.id,
            room_name: roomName,
            room_type: roomType,
            call_id: callRow.id,
            match_id: callRow.match_id,
            status: callRow.status,
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
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const deleteOutcome = await deleteDailyRoom(roomName, { throwOnProviderError: true });
      if (roomType === "match_call" && callRow) {
        await serviceClient
          .from("match_calls")
          .update({ provider_deleted_at: new Date().toISOString() })
          .eq("id", callRow.id)
          .is("provider_deleted_at", null);
      }
      return new Response(
        JSON.stringify({ success: true, code: deleteOutcome === "deleted" ? "DELETED" : "NOT_FOUND_IDEMPOTENT", outcome: deleteOutcome }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: ensure_date_room ──
    // Room-only warmup for Ready Gate. This verifies/creates the deterministic
    // Daily room but never issues a token, joins media, or transitions date state.
    if (action === "ensure_date_room") {
      const actionName: DateRoomAction = "ensure_date_room";
      const timings: Record<string, number> = {};
      const totalStartedAt = Date.now();
      if (authTimingMs != null) timings.auth_ms = authTimingMs;
      timings.request_to_action_ms = Math.max(0, totalStartedAt - requestStartedAt);
      let session: VideoDateRoomGateSession | null = null;

      if (typeof sessionId !== "string" || !sessionId) {
        return createDateRoomRejectResponse({
          action: actionName,
          sessionId,
          userId: user.id,
          status: 400,
          code: "MISSING_SESSION_ID",
          error: "Missing or invalid sessionId",
          requestContext,
        });
      }

      try {
        const sessionStartedAt = Date.now();
        const { data, error } = await supabase
          .from("video_sessions")
          .select(
            "id, event_id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, daily_room_verified_at, daily_room_expires_at, daily_room_provider_verify_reason, ended_at, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
          )
          .eq("id", sessionId)
          .maybeSingle();
        timings.session_fetch_ms = Date.now() - sessionStartedAt;
        session = (data as VideoDateRoomGateSession | null) ?? null;

        if (error || !session) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 404,
            code: "SESSION_NOT_FOUND",
            error: "Session not found",
            requestContext,
            detail: error ? error.message : null,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        if (session.participant_1_id !== user.id && session.participant_2_id !== user.id) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          return createBlockedDateRoomResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            requestContext,
            session,
            detail: "ensure_date_room_block_check",
          });
        }

        if (videoDateRoomGateSessionEnded(session)) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const warmupEligibleStatuses = new Set(["ready_a", "ready_b", "both_ready"]);
        if (!warmupEligibleStatuses.has(String(session.ready_gate_status ?? ""))) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 403,
            code: "READY_GATE_NOT_READY",
            error: "Ready Gate must be open before warming the room",
            requestContext,
            session,
            extra: {
              ready_gate_status: session.ready_gate_status ?? null,
              entry_attempt_id: entryAttemptId,
              video_date_trace_id: videoDateTraceId,
            },
          });
        }

        const roomStartedAt = Date.now();
        const roomProof = await ensureVideoDateProviderRoomForToken({
          serviceClient,
          action: actionName,
          sessionId,
          userId: user.id,
          session,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        timings.room_create_or_verify_ms = Date.now() - roomStartedAt;
        timings.total_ms = Date.now() - totalStartedAt;
        timings.response_ready_ms = timings.total_ms;
        if (!roomProof.ok) return roomProof.response;

        console.log(JSON.stringify({
          event: "ensure_date_room_ok",
          session_id: sessionId,
          user_id: user.id,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          room_name: roomProof.roomName,
          provider_verify_skipped: roomProof.providerVerifySkipped,
          provider_verify_reason: roomProof.providerVerifyReason,
          timings,
        }));

        return new Response(
          JSON.stringify({
            success: true,
            room_name: roomProof.roomName,
            room_url: roomProof.roomUrl,
            reused_room: roomProof.reusedRoom,
            provider_room_recreated: roomProof.providerRoomRecreated,
            provider_room_recovered: roomProof.providerRoomRecovered,
            provider_verify_skipped: roomProof.providerVerifySkipped,
            provider_verify_reason: roomProof.providerVerifyReason,
            daily_room_verified_at: roomProof.dailyRoomVerifiedAt,
            daily_room_expires_at: roomProof.dailyRoomExpiresAt,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
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
            requestContext,
            session,
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
          requestContext,
          session,
          detail: error instanceof Error ? error.message : String(error),
          extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
        });
      }
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
          requestContext,
        });
      }

      try {
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
            status: statusForPrepareEntryCode(code),
            code,
            error: preparePayload?.error ?? "Could not prepare video date entry",
            requestContext,
            session: sessionForLog,
            detail: prepareError ? prepareError.message : null,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
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
            requestContext,
            session: sessionForLog,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        // Provider-idempotent prepare-entry contract: video_date_transition('prepare_entry')
        // validates the row without making it routeable, then this function uses
        // a deterministic room name, verifies/recreates provider-side room truth
        // before token issuance, treats Daily "already exists" as success, and
        // writes the same room_name/room_url values idempotently. Holding a DB
        // advisory lock across outbound Daily HTTP would require a long-lived DB
        // transaction from the Edge Function, so the bounded safe contract is
        // deterministic provider idempotency plus same-value DB writes.
        const roomStartedAt = Date.now();
        const roomProof = await ensureVideoDateProviderRoomForToken({
          serviceClient,
          action: actionName,
          sessionId,
          userId: user.id,
          session: sessionForLog,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        if (!roomProof.ok) {
          return roomProof.response;
        }
        const {
          roomName,
          roomUrl,
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
        const tokenExpiresAt = meetingTokenExpiresAtIso(DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS, tokenStartedAt);
        const token = await createMeetingToken(roomName, user.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS);
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
          roomName,
          detail: {
            provider_room_reused: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_room_recovered: providerRoomRecovered,
            provider_verify_skipped: providerVerifySkipped,
            provider_verify_reason: providerVerifyReason,
            daily_room_verified_at: dailyRoomVerifiedAt,
            daily_room_expires_at: dailyRoomExpiresAt,
          },
        });
        const confirmStartedAt = Date.now();
        const { data: confirmPayload, error: confirmError } = await confirmVideoDateEntryPrepared(serviceClient, {
          sessionId,
          roomName,
          roomUrl,
          entryAttemptId,
        });
        timings.confirm_prepare_ms = Date.now() - confirmStartedAt;
        timings.total_ms = Date.now() - totalStartedAt;
        timings.response_ready_ms = timings.total_ms;
        if (confirmError || confirmPayload?.success !== true) {
          const code = confirmPayload?.code ?? (confirmError ? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN");
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: statusForPrepareEntryCode(code),
            code,
            error: confirmPayload?.error ?? "Could not persist date routing state",
            requestContext,
            session: sessionForLog,
            detail: confirmError instanceof Error ? confirmError.message : confirmError ? String(confirmError) : null,
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
          ready_gate_status: confirmPayload.ready_gate_status ?? null,
          ready_gate_expires_at: confirmPayload.ready_gate_expires_at ?? null,
        };

        console.log(JSON.stringify({
          event: "prepare_date_entry_ok",
          session_id: sessionId,
          user_id: user.id,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          room_name: roomName,
          reused_room: reusedRoom,
          provider_room_recreated: providerRoomRecreated,
          provider_room_recovered: providerRoomRecovered,
          provider_verify_skipped: providerVerifySkipped,
          provider_verify_reason: providerVerifyReason,
          daily_room_verified_at: dailyRoomVerifiedAt,
          daily_room_expires_at: dailyRoomExpiresAt,
          state: confirmPayload.state ?? null,
          phase: confirmPayload.phase ?? null,
          timings,
        }));

        return new Response(
          JSON.stringify({
            success: true,
            room_name: roomName,
            room_url: roomUrl,
            token,
            token_expires_at: tokenExpiresAt,
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
          requestContext,
          session: sessionForLog,
          detail: error instanceof Error ? error.message : String(error),
          extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
        });
      }
    }

    // ── ACTION: create_date_room ──
    if (action === "create_date_room") {
      let session: VideoDateRoomGateSession | null = null;
      try {
        const { data } = await supabase
          .from("video_sessions")
          .select(
            "id, event_id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, daily_room_verified_at, daily_room_expires_at, daily_room_provider_verify_reason, ended_at, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
          )
          .eq("id", sessionId)
          .maybeSingle();

        session = (data as VideoDateRoomGateSession | null) ?? null;

        if (!session) {
          const blockedFallback = await maybeReturnBlockedDateSessionFallback({
            serviceClient,
            action,
            sessionId,
            userId: user.id,
            requestContext,
          });
          if (blockedFallback) return blockedFallback;

          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 404,
            code: "SESSION_NOT_FOUND",
            error: "Session not found",
            requestContext,
          });
        }

        if (
          session.participant_1_id !== user.id &&
          session.participant_2_id !== user.id
        ) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "ACCESS_DENIED",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "ACCESS_DENIED",
              source: "participant_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "BLOCKED_PAIR",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "BLOCKED_PAIR",
              source: "blocked_pair_guard",
            },
          });
          return createBlockedDateRoomResponse({
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
          });
        }

        if (videoDateRoomGateSessionEnded(session)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_session_ended",
            outcome: "blocked",
            reasonCode: "SESSION_ENDED",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "SESSION_ENDED",
              source: "session_row_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        if (!canIssueVideoDateRoomToken(session)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "READY_GATE_NOT_READY",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "READY_GATE_NOT_READY",
              source: "provider_prepared_truth_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "READY_GATE_NOT_READY",
            error: "Both participants must be ready before starting video",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const roomProof = await ensureVideoDateProviderRoomForToken({
          serviceClient,
          action,
          sessionId,
          userId: user.id,
          session,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        if (!roomProof.ok) {
          return roomProof.response;
        }
        const {
          roomName,
          roomUrl,
          reusedRoom,
          providerRoomRecreated,
          providerRoomRecovered,
          providerVerifySkipped,
          providerVerifyReason,
          dailyRoomVerifiedAt,
          dailyRoomExpiresAt,
        } = roomProof;

        const tokenStartedAt = Date.now();
        const tokenExpiresAt = meetingTokenExpiresAtIso(DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS, tokenStartedAt);
        const token = await createMeetingToken(roomName, user.id, DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS);
        await recordVideoDateProviderObservability({
          serviceClient,
          operation: "create_date_room_token_issued",
          outcome: "success",
          reasonCode: "token_issued",
          eventId: session.event_id ?? null,
          actorId: user.id,
          sessionId: typeof sessionId === "string" ? sessionId : null,
          action,
          entryAttemptId,
          videoDateTraceId,
          roomName,
          detail: {
            provider_room_reused: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_room_recovered: providerRoomRecovered,
            provider_verify_skipped: providerVerifySkipped,
            provider_verify_reason: providerVerifyReason,
            daily_room_verified_at: dailyRoomVerifiedAt,
            daily_room_expires_at: dailyRoomExpiresAt,
          },
        });
        const { data: confirmPayload, error: confirmError } = await confirmVideoDateEntryPrepared(serviceClient, {
          sessionId,
          roomName,
          roomUrl,
          entryAttemptId,
        });
        if (confirmError || confirmPayload?.success !== true) {
          const code = confirmPayload?.code ?? (confirmError ? "REGISTRATION_PERSIST_FAILED" : "UNKNOWN");
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: statusForPrepareEntryCode(code),
            code,
            error: confirmPayload?.error ?? "Could not persist date routing state",
            requestContext,
            session,
            detail: confirmError instanceof Error ? confirmError.message : confirmError ? String(confirmError) : null,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId, operation: "confirm_prepare_entry" },
          });
        }

        return new Response(
          JSON.stringify({
            room_name: roomName,
            room_url: roomUrl,
            token,
            token_expires_at: tokenExpiresAt,
            reused_room: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_room_recovered: providerRoomRecovered,
            provider_verify_skipped: providerVerifySkipped,
            provider_verify_reason: providerVerifyReason,
            daily_room_verified_at: dailyRoomVerifiedAt,
            daily_room_expires_at: dailyRoomExpiresAt,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
        if (isDailyProviderError(error)) {
          return await createDailyProviderFailureResponse({
            serviceClient,
            error,
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
            entryAttemptId,
            videoDateTraceId,
          });
        }
        return createDateRoomRejectResponse({
          action,
          sessionId,
          userId: user.id,
          status: 503,
          code: "DAILY_PROVIDER_ERROR",
          error: "Video service temporarily unavailable",
          requestContext,
          session,
          detail: error instanceof Error ? error.message : String(error),
          extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
        });
      }
    }

    // ── ACTION: join_date_room ──
    if (action === "join_date_room") {
      let session: VideoDateRoomGateSession | null = null;
      try {
        const { data } = await supabase
          .from("video_sessions")
          .select(
            "id, event_id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, daily_room_verified_at, daily_room_expires_at, daily_room_provider_verify_reason, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
          )
          .eq("id", sessionId)
          .maybeSingle();

        session = (data as VideoDateRoomGateSession | null) ?? null;

        if (!session) {
          const blockedFallback = await maybeReturnBlockedDateSessionFallback({
            serviceClient,
            action,
            sessionId,
            userId: user.id,
            requestContext,
          });
          if (blockedFallback) return blockedFallback;

          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 404,
            code: "ROOM_NOT_FOUND",
            error: "Room not found",
            requestContext,
            session,
          });
        }

        if (
          session.participant_1_id !== user.id &&
          session.participant_2_id !== user.id
        ) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "ACCESS_DENIED",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "ACCESS_DENIED",
              source: "participant_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "BLOCKED_PAIR",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "BLOCKED_PAIR",
              source: "blocked_pair_guard",
            },
          });
          return createBlockedDateRoomResponse({
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
          });
        }

        if (videoDateRoomGateSessionEnded(session)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_session_ended",
            outcome: "blocked",
            reasonCode: "SESSION_ENDED",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "SESSION_ENDED",
              source: "session_row_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        if (!canIssueVideoDateRoomToken(session)) {
          await recordVideoDateProviderObservability({
            serviceClient,
            operation: "create_date_room_blocked_access_denied",
            outcome: "blocked",
            reasonCode: "READY_GATE_NOT_READY",
            eventId: session.event_id ?? null,
            actorId: user.id,
            sessionId: typeof sessionId === "string" ? sessionId : null,
            action,
            entryAttemptId,
            videoDateTraceId,
            roomName: typeof sessionId === "string" ? videoDateRoomNameForSession(sessionId) : null,
            detail: {
              typed_error_code: "READY_GATE_NOT_READY",
              source: "provider_prepared_truth_guard",
            },
          });
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "READY_GATE_NOT_READY",
            error: "Both participants must be ready before joining video",
            requestContext,
            session,
            extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
          });
        }

        const roomProof = await ensureVideoDateProviderRoomForToken({
          serviceClient,
          action,
          sessionId,
          userId: user.id,
          session,
          requestContext,
          entryAttemptId,
          videoDateTraceId,
        });
        if (!roomProof.ok) {
          return roomProof.response;
        }

        const tokenStartedAt = Date.now();
        const tokenExpiresAt = meetingTokenExpiresAtIso(DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS, tokenStartedAt);
        const token = await createMeetingToken(
          roomProof.roomName,
          user.id,
          DAILY_VIDEO_DATE_TOKEN_TTL_SECONDS,
        );
        await recordVideoDateProviderObservability({
          serviceClient,
          operation: "create_date_room_token_issued",
          outcome: "success",
          reasonCode: "token_issued",
          eventId: session.event_id ?? null,
          actorId: user.id,
          sessionId: typeof sessionId === "string" ? sessionId : null,
          action,
          entryAttemptId,
          videoDateTraceId,
          roomName: roomProof.roomName,
          detail: {
            provider_room_reused: roomProof.reusedRoom,
            provider_room_recreated: roomProof.providerRoomRecreated,
            provider_room_recovered: roomProof.providerRoomRecovered,
            provider_verify_skipped: roomProof.providerVerifySkipped,
            provider_verify_reason: roomProof.providerVerifyReason,
            daily_room_verified_at: roomProof.dailyRoomVerifiedAt,
            daily_room_expires_at: roomProof.dailyRoomExpiresAt,
          },
        });

        return new Response(
          JSON.stringify({
            room_name: roomProof.roomName,
            room_url: roomProof.roomUrl,
            token,
            token_expires_at: tokenExpiresAt,
            reused_room: roomProof.reusedRoom,
            provider_room_recreated: roomProof.providerRoomRecreated,
            provider_room_recovered: roomProof.providerRoomRecovered,
            provider_verify_skipped: roomProof.providerVerifySkipped,
            provider_verify_reason: roomProof.providerVerifyReason,
            daily_room_verified_at: roomProof.dailyRoomVerifiedAt,
            daily_room_expires_at: roomProof.dailyRoomExpiresAt,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
        if (isDailyProviderError(error)) {
          return await createDailyProviderFailureResponse({
            serviceClient,
            error,
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
            entryAttemptId,
            videoDateTraceId,
          });
        }
        return createDateRoomRejectResponse({
          action,
          sessionId,
          userId: user.id,
          status: 503,
          code: "DAILY_PROVIDER_ERROR",
          error: "Video service temporarily unavailable",
          requestContext,
          session,
          detail: error instanceof Error ? error.message : String(error),
          extra: { entry_attempt_id: entryAttemptId, video_date_trace_id: videoDateTraceId },
        });
      }
    }

    // ── ACTION: create_match_call ──
    if (action === "create_match_call") {
      const { data: match } = await supabase
        .from("matches")
        .select("id, profile_id_1, profile_id_2, archived_at")
        .eq("id", matchId)
        .maybeSingle();

      if (
        !match ||
        (match.profile_id_1 !== user.id && match.profile_id_2 !== user.id)
      ) {
        const blockedFallback = await maybeReturnBlockedMatchFallback({
          serviceClient,
          matchId,
          userId: user.id,
          event: "create_match_call_rejected",
        });
        if (blockedFallback) return blockedFallback;

        console.log(
          JSON.stringify({
            event: "create_match_call_rejected",
            code: "ACCESS_DENIED",
            match_id: matchId,
            caller_id: user.id,
          }),
        );
        return new Response(
          JSON.stringify({ error: "Access denied", code: "ACCESS_DENIED" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const calleeId =
        match.profile_id_1 === user.id
          ? match.profile_id_2
          : match.profile_id_1;
      const callTypeValue = callType === "voice" ? "voice" : "video";

      const gate = await assertCreateMatchCallAllowed({
        serviceClient,
        matchId,
        callerId: user.id,
        calleeId,
        archivedAt: match.archived_at,
      });

      if (!gate.ok) {
        if (gate.code === "DUPLICATE_ACTIVE_CALL") {
          const retryResponse = await maybeCreateMatchCallRetryResponse({
            call: gate.duplicateCall ?? null,
            request: { matchId, callerId: user.id, calleeId, callType: callTypeValue },
          });
          if (retryResponse) return retryResponse;
          return createDuplicateActiveMatchCallResponse(matchId, user.id, calleeId);
        }
        console.log(
          JSON.stringify({
            event: "create_match_call_rejected",
            code: gate.code,
            reject_layer: "precheck",
            match_id: matchId,
            caller_id: user.id,
            callee_id: calleeId,
          }),
        );
        return new Response(
          JSON.stringify({ error: gate.message, code: gate.code }),
          {
            status: gate.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const roomName = `call-${matchId
        .replace(/-/g, "")
        .substring(0, 20)}-${Date.now().toString(36)}`;

      await createDailyRoom(roomName, matchCallRoomProperties(callTypeValue));

      const roomUrl = matchCallRoomUrlForName(roomName);
      let callerToken: string;
      try {
        callerToken = await createMeetingToken(
          roomName,
          user.id,
          DAILY_MATCH_CALL_TOKEN_TTL_SECONDS,
          undefined,
          { ejectAtTokenExp: true },
        );
      } catch (tokenErr) {
        await deleteDailyRoom(roomName);
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        if (isDailyProviderError(tokenErr)) {
          logDailyProviderFailure(tokenErr, {
            action: "create_match_call",
            matchId,
            userId: user.id,
            roomName,
          });
        }
        console.error(
          JSON.stringify({
            event: "create_match_call_token_failed",
            match_id: matchId,
            caller_id: user.id,
            room_name: roomName,
            detail,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Call service temporarily unavailable",
            code: "TOKEN_ISSUE_FAILED",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: call, error: callError } = await serviceClient
        .from("match_calls")
        .insert({
          match_id: matchId,
          caller_id: user.id,
          callee_id: calleeId,
          call_type: callTypeValue,
          daily_room_name: roomName,
          daily_room_url: roomUrl,
          status: "ringing",
        })
        .select()
        .single();

      if (callError) {
        await deleteDailyRoom(roomName);
        const pgCode = (callError as { code?: string }).code;
        if (pgCode === "23505") {
          const existingCall = await fetchOpenMatchCallForMatch(serviceClient, matchId);
          const retryResponse = await maybeCreateMatchCallRetryResponse({
            call: existingCall,
            request: { matchId, callerId: user.id, calleeId, callType: callTypeValue },
          });
          if (retryResponse) return retryResponse;
          console.log(
            JSON.stringify({
              event: "create_match_call_duplicate_db",
              reject_layer: "db_unique",
              code: "DUPLICATE_ACTIVE_CALL",
              match_id: matchId,
              caller_id: user.id,
            }),
          );
          return createDuplicateActiveMatchCallResponse(matchId, user.id, calleeId);
        }
        console.error(
          JSON.stringify({
            event: "create_match_call_insert_failed",
            match_id: matchId,
            caller_id: user.id,
            pg_code: pgCode,
            message: (callError as { message?: string }).message,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Could not create call",
            code: "INSERT_FAILED",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      console.log(
        JSON.stringify({
          event: "create_match_call_ok",
          call_id: call.id,
          match_id: matchId,
          caller_id: user.id,
          callee_id: calleeId,
          call_type: callTypeValue,
        }),
      );

      try {
        const { data: callerProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();
        const callerName = (callerProfile?.name as string | undefined)?.trim() || "Your match";
        const bodyText =
          callTypeValue === "voice"
            ? `${callerName} is calling you`
            : `${callerName} is video calling you`;
        await serviceClient.functions.invoke("send-notification", {
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
          body: {
            user_id: calleeId,
            category: "match_call",
            title: "Incoming call",
            body: bodyText,
            data: {
              match_id: matchId,
              sender_id: user.id,
              other_user_id: user.id,
              call_id: call.id,
              call_type: callTypeValue,
              url: `/chat/${user.id}`,
            },
          },
        });
      } catch (notifyError) {
        console.error("create_match_call send-notification error:", notifyError);
      }

      return new Response(
        JSON.stringify({
          call_id: call.id,
          room_name: roomName,
          room_url: roomUrl,
          token: callerToken,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: join_match_call ──
    if (action === "join_match_call") {
      const targetCallId = callId || sessionId;
      if (!targetCallId || typeof targetCallId !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing call id", code: "MISSING_CALL_ID" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: call } = await supabase
        .from("match_calls")
        .select("id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, match_id")
        .eq("id", targetCallId)
        .maybeSingle();

      if (
        !call ||
        (call.caller_id !== user.id && call.callee_id !== user.id)
      ) {
        const blockedFallback = await maybeReturnBlockedMatchCallFallback({
          serviceClient,
          callId: targetCallId,
          userId: user.id,
          event: "join_match_call_rejected",
        });
        if (blockedFallback) return blockedFallback;

        console.log(
          JSON.stringify({
            event: "join_match_call_not_found",
            call_id: targetCallId,
            user_id: user.id,
          }),
        );
        return new Response(
          JSON.stringify({ error: "Call not found or access denied", code: "NOT_FOUND" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const peerId = call.caller_id === user.id ? call.callee_id : call.caller_id;
      if (await isPairBlocked(serviceClient, user.id, peerId)) {
        return createBlockedMatchCallResponse({
          event: "join_match_call_rejected",
          userId: user.id,
          peerId,
          matchId: call.match_id,
          callId: call.id,
        });
      }

      if (call.status !== "active") {
        console.log(
          JSON.stringify({
            event: "join_match_call_rejected",
            code: "CALL_NOT_ACTIVE",
            call_id: call.id,
            status: call.status,
            user_id: user.id,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Call is not active",
            code: "CALL_NOT_ACTIVE",
            status: call.status,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!call.daily_room_name) {
        return new Response(
          JSON.stringify({
            error: "Call room is unavailable",
            code: "ROOM_NOT_FOUND",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let token: string;
      let providerRoom: { roomName: string; roomUrl: string; providerRoomRecreated: boolean; providerRoomRecovered: boolean };
      try {
        providerRoom = await ensureMatchCallProviderRoomForToken({
          action: "join_match_call",
          callId: call.id,
          matchId: call.match_id,
          userId: user.id,
          roomName: call.daily_room_name,
          roomUrl: call.daily_room_url,
          callType: call.call_type === "voice" ? "voice" : "video",
        });
        token = await createMeetingToken(
          providerRoom.roomName,
          user.id,
          DAILY_MATCH_CALL_TOKEN_TTL_SECONDS,
          undefined,
          { ejectAtTokenExp: true },
        );
      } catch (tokenErr) {
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        if (isDailyProviderError(tokenErr)) {
          logDailyProviderFailure(tokenErr, {
            action: "join_match_call",
            callId: call.id,
            matchId: call.match_id,
            userId: user.id,
            roomName: call.daily_room_name,
          });
        }
        console.error(
          JSON.stringify({
            event: "join_match_call_token_failed",
            call_id: call.id,
            match_id: call.match_id,
            user_id: user.id,
            detail,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Call service temporarily unavailable",
            code: "TOKEN_ISSUE_FAILED",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          call_id: call.id,
          room_name: providerRoom.roomName,
          room_url: providerRoom.roomUrl,
          token,
          provider_room_recreated: providerRoom.providerRoomRecreated,
          provider_room_recovered: providerRoom.providerRoomRecovered,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── ACTION: answer_match_call ──
    if (action === "answer_match_call") {
      const targetCallId = callId || sessionId;
      if (!targetCallId || typeof targetCallId !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing call id", code: "MISSING_CALL_ID" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Fetch the call row first (read-only, callee-only guard)
      const { data: call } = await supabase
        .from("match_calls")
        .select("id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, match_id")
        .eq("id", targetCallId)
        .eq("callee_id", user.id)
        .maybeSingle();

      if (!call) {
        const blockedFallback = await maybeReturnBlockedMatchCallFallback({
          serviceClient,
          callId: targetCallId,
          userId: user.id,
          event: "answer_match_call_rejected",
        });
        if (blockedFallback) return blockedFallback;

        console.log(
          JSON.stringify({
            event: "answer_match_call_not_found",
            call_id: targetCallId,
            callee_id: user.id,
          }),
        );
        return new Response(
          JSON.stringify({ error: "Call not found or access denied", code: "NOT_FOUND" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const peerId = call.caller_id === user.id ? call.callee_id : call.caller_id;
      if (await isPairBlocked(serviceClient, user.id, peerId)) {
        return createBlockedMatchCallResponse({
          event: "answer_match_call_rejected",
          userId: user.id,
          peerId,
          matchId: call.match_id,
          callId: call.id,
        });
      }

      let callForToken = call as MatchCallRow;
      const callTypeValue = callForToken.call_type === "voice" ? "voice" : "video";
      if (!canIssueAnswerTokenForMatchCallStatus(callForToken.status)) {
        console.log(
          JSON.stringify({
            event: "answer_match_call_rejected",
            code: "CALL_NOT_RINGING",
            call_id: callForToken.id,
            status: callForToken.status,
          }),
        );
        return new Response(
          JSON.stringify({ error: "Call is no longer ringing", code: "CALL_NOT_RINGING", status: callForToken.status }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      let activatedDuringRequest = false;
      let idempotentAnswerRetry = callForToken.status === "active";
      if (callForToken.status === "ringing") {
        // Activate first (row lock + single source of truth), then issue token — avoids returning a usable token while DB is still "ringing".
        const { data: transition } = await supabase.rpc("match_call_transition", {
          p_call_id: callForToken.id,
          p_action: "answer",
        });

        if (!transition?.ok) {
          const { data: refreshedCall } = await serviceClient
            .from("match_calls")
            .select("id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, match_id")
            .eq("id", callForToken.id)
            .maybeSingle();
          const activeRetry = (refreshedCall as MatchCallRow | null) ?? null;
          if (activeRetry?.callee_id === user.id && activeRetry.status === "active") {
            callForToken = activeRetry;
            idempotentAnswerRetry = true;
          } else {
            console.log(
              JSON.stringify({
                event: "answer_match_call_transition_failed",
                call_id: callForToken.id,
                transition_code: transition?.code,
              }),
            );
            return new Response(
              JSON.stringify({
                error: "Call is no longer ringing",
                code: transition?.code || "CALL_NOT_RINGING",
                status: transition?.status ?? callForToken.status,
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
        } else {
          activatedDuringRequest = true;
        }
      }

      if (!callForToken.daily_room_name) {
        return new Response(
          JSON.stringify({
            error: "Call room is unavailable",
            code: "ROOM_NOT_FOUND",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let token: string;
      let providerRoom: { roomName: string; roomUrl: string; providerRoomRecreated: boolean; providerRoomRecovered: boolean };
      try {
        providerRoom = await ensureMatchCallProviderRoomForToken({
          action: "answer_match_call",
          callId: callForToken.id,
          matchId: callForToken.match_id,
          userId: user.id,
          roomName: callForToken.daily_room_name,
          roomUrl: callForToken.daily_room_url,
          callType: callTypeValue,
        });
        token = await createMeetingToken(
          providerRoom.roomName,
          user.id,
          DAILY_MATCH_CALL_TOKEN_TTL_SECONDS,
          undefined,
          { ejectAtTokenExp: true },
        );
      } catch (tokenErr) {
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        if (isDailyProviderError(tokenErr)) {
          logDailyProviderFailure(tokenErr, {
            action: "answer_match_call",
            callId: callForToken.id,
            matchId: callForToken.match_id,
            userId: user.id,
            roomName: callForToken.daily_room_name,
          });
        }
        console.error(
          JSON.stringify({
            event: "answer_match_call_token_failed_after_transition",
            call_id: callForToken.id,
            match_id: callForToken.match_id,
            callee_id: user.id,
            detail,
          }),
        );
        if (activatedDuringRequest) {
          try {
            const { data: rollback } = await supabase.rpc("match_call_transition", {
              p_call_id: callForToken.id,
              p_action: "join_failed",
            });
            console.log(
              JSON.stringify({
                event: "answer_match_call_token_rollback_end",
                call_id: callForToken.id,
                rollback_ok: rollback?.ok === true,
              }),
            );
          } catch (rollbackErr) {
            console.error(
              JSON.stringify({
                event: "answer_match_call_token_rollback_failed",
                call_id: callForToken.id,
                detail: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
              }),
            );
          }
        }
        return new Response(
          JSON.stringify({
            error: "Call service temporarily unavailable",
            code: "TOKEN_ISSUE_FAILED",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          call_id: callForToken.id,
          room_name: providerRoom.roomName,
          room_url: providerRoom.roomUrl,
          token,
          idempotent_answer_retry: idempotentAnswerRetry,
          provider_room_recreated: providerRoom.providerRoomRecreated,
          provider_room_recovered: providerRoom.providerRoomRecovered,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
