import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_DOMAIN = Deno.env.get("DAILY_DOMAIN") || "vibelyapp.daily.co";
const DAILY_API_URL = "https://api.daily.co/v1";

type DateRoomAction = "create_date_room" | "join_date_room" | "prepare_date_entry";

type VideoDateRoomGateSession = {
  id: string;
  participant_1_id: string | null;
  participant_2_id: string | null;
  daily_room_name?: string | null;
  ended_at: string | null;
  handshake_started_at: string | null;
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
  daily_room_name: string | null;
  daily_room_url: string | null;
  status: string | null;
  match_id: string | null;
};

type ClientRequestContext = {
  client_platform: string | null;
  client_platform_version: string | null;
  client_runtime: string | null;
  client_runtime_version: string | null;
};

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
    }),
    {
      status: params.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
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

/** Server-owned: allow Daily token only for active handshake/date states or non-expired both_ready gate. */
function canIssueVideoDateRoomToken(session: {
  ended_at: string | null;
  handshake_started_at: string | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | null;
  state: string | null;
}): boolean {
  if (session.ended_at) return false;
  if (
    session.state === "handshake" ||
    session.state === "date" ||
    session.handshake_started_at
  ) {
    return true;
  }

  if (session.ready_gate_status !== "both_ready") return false;

  if (!session.ready_gate_expires_at) return false;
  const gateDeadline = new Date(session.ready_gate_expires_at).getTime();
  if (Number.isNaN(gateDeadline)) return false;
  return gateDeadline > Date.now();
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
  expSeconds: number
): Promise<string> {
  const res = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + expSeconds,
      },
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error("Failed to create meeting token");
  return data.token;
}

async function createDailyRoom(
  roomName: string,
  props: Record<string, unknown>,
  retries = 2
): Promise<{ url: string; name: string }> {
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
    const errBody = await res.json().catch(() => ({}));
    if (
      errBody?.info?.includes("already exists") ||
      errBody?.error?.includes("already exists")
    ) {
      return { url: `https://${DAILY_DOMAIN}/${roomName}`, name: roomName };
    }
    throw new Error(`Daily room creation failed: ${JSON.stringify(errBody)}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Daily API error ${res.status}: ${errText}`);
  }

  const room = await res.json();
  return { url: room.url, name: room.name };
}

/** Skip Daily REST GET when handshake just started — room was created for this window or DB is authoritative; mitigates double RTT on every launch. */
function shouldSkipDailyProviderVerifyForVideoDate(session: VideoDateRoomGateSession): boolean {
  if (!session.daily_room_name) return false;
  const hs = session.handshake_started_at;
  if (!hs) return false;
  const t = new Date(hs).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs < 120_000;
}

async function getDailyRoomProviderState(roomName: string): Promise<{ exists: boolean; expired: boolean }> {
  const res = await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  });

  if (res.status === 404) return { exists: false, expired: false };
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Daily room lookup failed ${res.status}: ${errText}`);
  }

  const room = (await res.json().catch(() => null)) as { config?: { exp?: number } } | null;
  const exp = typeof room?.config?.exp === "number" ? room.config.exp : null;
  const expired = exp != null && exp <= Math.floor(Date.now() / 1000);
  return { exists: true, expired };
}

async function deleteDailyRoom(roomName: string): Promise<void> {
  try {
    await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    });
  } catch {
    // Best-effort
  }
}

function videoDateRoomProperties(): Record<string, unknown> {
  return {
    max_participants: 2,
    enable_chat: false,
    enable_screenshare: false,
    enable_knocking: false,
    start_video_off: false,
    start_audio_off: false,
    exp: Math.floor(Date.now() / 1000) + 7200,
    eject_at_room_exp: true,
  };
}

type PrepareEntryTransitionPayload = {
  success?: boolean;
  code?: string;
  error?: string;
  state?: string | null;
  phase?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  handshake_started_at?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
};

function statusForPrepareEntryCode(code?: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_ENDED") return 410;
  if (code === "BLOCKED_PAIR" || code === "ACCESS_DENIED" || code === "READY_GATE_NOT_READY") return 403;
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
  | { ok: false; status: number; code: string; message: string }
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
    .select("id")
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

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const requestContext = getClientRequestContext(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json();
    const { action, sessionId, matchId, callType, callId } = body;

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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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

      // Check video_sessions first
      const { data: vsRow } = await supabase
        .from("video_sessions")
        .select("id, participant_1_id, participant_2_id, ended_at")
        .eq("daily_room_name", roomName)
        .maybeSingle();

      if (vsRow) {
        authorized = vsRow.participant_1_id === user.id || vsRow.participant_2_id === user.id;
        roomType = "video_date";
      } else {
        // Fall back to match_calls
        const { data: callRow } = await supabase
          .from("match_calls")
          .select("id, caller_id, callee_id")
          .eq("daily_room_name", roomName)
          .maybeSingle();

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
        console.log(JSON.stringify({
          event: "delete_room_skipped",
          user_id: user.id,
          room_name: roomName,
          room_type: roomType,
          reason: "video_date_room_cleanup_owned_by_cron",
          session_id: vsRow?.id ?? null,
          session_ended: Boolean(vsRow?.ended_at),
        }));
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await deleteDailyRoom(roomName);
      return new Response(
        JSON.stringify({ success: true }),
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
        });
        timings.prepare_rpc_ms = Date.now() - prepareStartedAt;

        const preparePayload = (prepareData ?? null) as PrepareEntryTransitionPayload | null;
        sessionForLog = preparePayload
          ? {
              id: sessionId,
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
          });
        }

        const participant1 = preparePayload.participant_1_id ?? null;
        const participant2 = preparePayload.participant_2_id ?? null;
        if (participant1 !== user.id && participant2 !== user.id) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session: sessionForLog,
          });
        }

        const partnerId = participant1 === user.id ? participant2 : participant1;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          return createBlockedDateRoomResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            requestContext,
            session: sessionForLog,
            detail: "service_role_post_prepare_block_check",
          });
        }

        const { data: sessionRow, error: sessionError } = await serviceClient
          .from("video_sessions")
          .select(
            "id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
          )
          .eq("id", sessionId)
          .maybeSingle();

        if (sessionError || !sessionRow) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 404,
            code: "SESSION_NOT_FOUND",
            error: "Session not found",
            requestContext,
            session: sessionForLog,
            detail: sessionError ? sessionError.message : null,
          });
        }

        sessionForLog = (sessionRow as VideoDateRoomGateSession | null) ?? sessionForLog;

        if (sessionForLog?.ended_at) {
          return createDateRoomRejectResponse({
            action: actionName,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session: sessionForLog,
          });
        }

        const roomName = `date-${sessionId.replace(/-/g, "")}`;
        const roomUrl = `https://${DAILY_DOMAIN}/${roomName}`;
        const existingRoomName = (sessionRow as { daily_room_name?: string | null }).daily_room_name ?? null;
        const existingRoomUrl = (sessionRow as { daily_room_url?: string | null }).daily_room_url ?? null;
        let reusedRoom = existingRoomName === roomName;
        let providerRoomRecreated = false;
        let providerVerifySkipped = false;

        const roomStartedAt = Date.now();
        if (existingRoomName !== roomName || existingRoomUrl !== roomUrl) {
          const providerRoomState = await getDailyRoomProviderState(roomName);
          if (providerRoomState.exists && providerRoomState.expired) {
            console.log(JSON.stringify({
              event: "prepare_date_entry_untracked_provider_expired_recreate",
              session_id: sessionId,
              user_id: user.id,
              room_name: roomName,
            }));
            await deleteDailyRoom(roomName);
            await createDailyRoom(roomName, videoDateRoomProperties());
            providerRoomRecreated = true;
            reusedRoom = false;
          } else if (providerRoomState.exists) {
            reusedRoom = true;
          } else {
            await createDailyRoom(roomName, videoDateRoomProperties());
            reusedRoom = false;
          }
          await serviceClient
            .from("video_sessions")
            .update({ daily_room_name: roomName, daily_room_url: roomUrl })
            .eq("id", sessionId)
            .is("ended_at", null);
        } else if (shouldSkipDailyProviderVerifyForVideoDate(sessionForLog)) {
          providerVerifySkipped = true;
          console.log(JSON.stringify({
            event: "prepare_date_entry_provider_verify_skipped",
            session_id: sessionId,
            user_id: user.id,
            room_name: roomName,
            handshake_started_at: sessionForLog.handshake_started_at,
          }));
        } else {
          const providerRoomState = await getDailyRoomProviderState(roomName);
          if (!providerRoomState.exists || providerRoomState.expired) {
            console.log(JSON.stringify({
              event: "prepare_date_entry_provider_unusable_recreate",
              session_id: sessionId,
              user_id: user.id,
              room_name: roomName,
              provider_exists: providerRoomState.exists,
              provider_expired: providerRoomState.expired,
            }));
            if (providerRoomState.exists) {
              await deleteDailyRoom(roomName);
            }
            await createDailyRoom(roomName, videoDateRoomProperties());
            await serviceClient
              .from("video_sessions")
              .update({ daily_room_name: roomName, daily_room_url: roomUrl })
              .eq("id", sessionId)
              .is("ended_at", null);
            reusedRoom = false;
            providerRoomRecreated = true;
          }
        }
        timings.room_create_or_verify_ms = Date.now() - roomStartedAt;

        const tokenStartedAt = Date.now();
        const token = await createMeetingToken(roomName, user.id, 7200);
        timings.token_ms = Date.now() - tokenStartedAt;
        timings.total_ms = Date.now() - totalStartedAt;

        console.log(JSON.stringify({
          event: "prepare_date_entry_ok",
          session_id: sessionId,
          user_id: user.id,
          room_name: roomName,
          reused_room: reusedRoom,
          provider_room_recreated: providerRoomRecreated,
          provider_verify_skipped: providerVerifySkipped,
          state: preparePayload.state ?? null,
          phase: preparePayload.phase ?? null,
          timings,
        }));

        return new Response(
          JSON.stringify({
            success: true,
            room_name: roomName,
            room_url: roomUrl,
            token,
            session_state: preparePayload.state ?? null,
            session_phase: preparePayload.phase ?? null,
            handshake_started_at: preparePayload.handshake_started_at ?? null,
            reused_room: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_verify_skipped: providerVerifySkipped,
            timings,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (error) {
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
            "id, participant_1_id, participant_2_id, daily_room_name, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
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
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session,
          });
        }

        const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          return createBlockedDateRoomResponse({
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
          });
        }

        if (session.ended_at) {
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session,
          });
        }

        if (!canIssueVideoDateRoomToken(session)) {
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "READY_GATE_NOT_READY",
            error: "Both participants must be ready before starting video",
            requestContext,
            session,
          });
        }

        const roomName =
          session.daily_room_name ||
          `date-${sessionId.replace(/-/g, "")}`;
        const roomUrl = `https://${DAILY_DOMAIN}/${roomName}`;
        let reusedRoom = Boolean(session.daily_room_name);
        let providerRoomRecreated = false;
        let providerVerifySkipped = false;

        if (!session.daily_room_name) {
          await createDailyRoom(roomName, {
            max_participants: 2,
            enable_chat: false,
            enable_screenshare: false,
            enable_knocking: false,
            start_video_off: false,
            start_audio_off: false,
            exp: Math.floor(Date.now() / 1000) + 7200,
            eject_at_room_exp: true,
          });

          await supabase
            .from("video_sessions")
            .update({ daily_room_name: roomName, daily_room_url: roomUrl })
            .eq("id", sessionId);
          reusedRoom = false;
        } else if (shouldSkipDailyProviderVerifyForVideoDate(session)) {
          providerVerifySkipped = true;
          console.log(JSON.stringify({
            event: "date_room_provider_verify_skipped",
            session_id: sessionId,
            user_id: user.id,
            room_name: roomName,
            handshake_started_at: session.handshake_started_at,
          }));
        } else {
          const providerRoomState = await getDailyRoomProviderState(roomName);
          if (!providerRoomState.exists || providerRoomState.expired) {
            console.log(JSON.stringify({
              event: "date_room_provider_unusable_recreate",
              session_id: sessionId,
              user_id: user.id,
              room_name: roomName,
              provider_exists: providerRoomState.exists,
              provider_expired: providerRoomState.expired,
            }));
            if (providerRoomState.exists) {
              await deleteDailyRoom(roomName);
            }
            await createDailyRoom(roomName, {
              max_participants: 2,
              enable_chat: false,
              enable_screenshare: false,
              enable_knocking: false,
              start_video_off: false,
              start_audio_off: false,
              exp: Math.floor(Date.now() / 1000) + 7200,
              eject_at_room_exp: true,
            });
            await supabase
              .from("video_sessions")
              .update({ daily_room_name: roomName, daily_room_url: roomUrl })
              .eq("id", sessionId);
            reusedRoom = false;
            providerRoomRecreated = true;
          }
        }

        const token = await createMeetingToken(roomName, user.id, 7200);

        return new Response(
          JSON.stringify({
            room_name: roomName,
            room_url: roomUrl,
            token,
            reused_room: reusedRoom,
            provider_room_recreated: providerRoomRecreated,
            provider_verify_skipped: providerVerifySkipped,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
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
            "id, participant_1_id, participant_2_id, daily_room_name, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state, phase",
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
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "ACCESS_DENIED",
            error: "Access denied",
            requestContext,
            session,
          });
        }

        const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        if (!partnerId || await isPairBlocked(serviceClient, user.id, partnerId)) {
          return createBlockedDateRoomResponse({
            action,
            sessionId,
            userId: user.id,
            requestContext,
            session,
          });
        }

        if (!session.daily_room_name) {
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

        if (session.ended_at) {
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 410,
            code: "SESSION_ENDED",
            error: "Session has ended",
            requestContext,
            session,
          });
        }

        if (!canIssueVideoDateRoomToken(session)) {
          return createDateRoomRejectResponse({
            action,
            sessionId,
            userId: user.id,
            status: 403,
            code: "READY_GATE_NOT_READY",
            error: "Both participants must be ready before joining video",
            requestContext,
            session,
          });
        }

        const token = await createMeetingToken(
          session.daily_room_name,
          user.id,
          7200
        );

        return new Response(
          JSON.stringify({
            room_name: session.daily_room_name,
            room_url: `https://${DAILY_DOMAIN}/${session.daily_room_name}`,
            token,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
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

      const gate = await assertCreateMatchCallAllowed({
        serviceClient,
        matchId,
        callerId: user.id,
        calleeId,
        archivedAt: match.archived_at,
      });

      if (!gate.ok) {
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
      const callTypeValue = callType === "voice" ? "voice" : "video";

      await createDailyRoom(roomName, {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        start_video_off: callTypeValue === "voice",
        start_audio_off: false,
        exp: Math.floor(Date.now() / 1000) + 7200,
        eject_at_room_exp: false,
      });

      const roomUrl = `https://${DAILY_DOMAIN}/${roomName}`;
      let callerToken: string;
      try {
        callerToken = await createMeetingToken(roomName, user.id, 7200);
      } catch (tokenErr) {
        await deleteDailyRoom(roomName);
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
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
          console.log(
            JSON.stringify({
              event: "create_match_call_duplicate_db",
              reject_layer: "db_unique",
              code: "DUPLICATE_ACTIVE_CALL",
              match_id: matchId,
              caller_id: user.id,
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
        .select("id, caller_id, callee_id, daily_room_name, daily_room_url, status, match_id")
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

      let token: string;
      try {
        token = await createMeetingToken(call.daily_room_name, user.id, 7200);
      } catch (tokenErr) {
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
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
          room_name: call.daily_room_name,
          room_url: call.daily_room_url,
          token,
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
        .select("id, caller_id, callee_id, daily_room_name, daily_room_url, status, match_id")
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

      if (call.status !== "ringing") {
        console.log(
          JSON.stringify({
            event: "answer_match_call_rejected",
            code: "CALL_NOT_RINGING",
            call_id: call.id,
            status: call.status,
          }),
        );
        return new Response(
          JSON.stringify({ error: "Call is no longer ringing", code: "CALL_NOT_RINGING", status: call.status }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Activate first (row lock + single source of truth), then issue token — avoids returning a usable token while DB is still "ringing".
      const { data: transition } = await supabase.rpc("match_call_transition", {
        p_call_id: call.id,
        p_action: "answer",
      });

      if (!transition?.ok) {
        console.log(
          JSON.stringify({
            event: "answer_match_call_transition_failed",
            call_id: call.id,
            transition_code: transition?.code,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Call is no longer ringing",
            code: transition?.code || "CALL_NOT_RINGING",
            status: transition?.status ?? call.status,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      let token: string;
      try {
        token = await createMeetingToken(call.daily_room_name, user.id, 7200);
      } catch (tokenErr) {
        const detail = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        console.error(
          JSON.stringify({
            event: "answer_match_call_token_failed_after_transition",
            call_id: call.id,
            match_id: call.match_id,
            callee_id: user.id,
            detail,
          }),
        );
        try {
          const { data: rollback } = await supabase.rpc("match_call_transition", {
            p_call_id: call.id,
            p_action: "join_failed",
          });
          console.log(
            JSON.stringify({
              event: "answer_match_call_token_rollback_end",
              call_id: call.id,
              rollback_ok: rollback?.ok === true,
            }),
          );
        } catch (rollbackErr) {
          console.error(
            JSON.stringify({
              event: "answer_match_call_token_rollback_failed",
              call_id: call.id,
              detail: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            }),
          );
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
          call_id: call.id,
          room_name: call.daily_room_name,
          room_url: call.daily_room_url,
          token,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
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
