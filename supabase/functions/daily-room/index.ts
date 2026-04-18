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

async function deleteDailyRoom(roomName: string): Promise<void> {
  try {
    await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    });
  } catch {
    // Best-effort
  }
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
        .select("id, participant_1_id, participant_2_id")
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

      await deleteDailyRoom(roomName);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: create_date_room ──
    if (action === "create_date_room") {
      const { data: session } = await supabase
        .from("video_sessions")
        .select(
          "id, participant_1_id, participant_2_id, daily_room_name, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state",
        )
        .eq("id", sessionId)
        .maybeSingle();

      if (!session) {
        return new Response(
          JSON.stringify({
            error: "Session not found",
            code: "SESSION_NOT_FOUND",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (
        session.participant_1_id !== user.id &&
        session.participant_2_id !== user.id
      ) {
        return new Response(
          JSON.stringify({ error: "Access denied", code: "ACCESS_DENIED" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (session.ended_at) {
        return new Response(
          JSON.stringify({
            error: "Session has ended",
            code: "SESSION_ENDED",
          }),
          {
            status: 410,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canIssueVideoDateRoomToken(session)) {
        return new Response(
          JSON.stringify({
            error: "Both participants must be ready before starting video",
            code: "READY_GATE_NOT_READY",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const roomName =
        session.daily_room_name ||
        `date-${sessionId.replace(/-/g, "")}`;
      const roomUrl = `https://${DAILY_DOMAIN}/${roomName}`;

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
      }

      const token = await createMeetingToken(roomName, user.id, 7200);

      return new Response(
        JSON.stringify({ room_name: roomName, room_url: roomUrl, token }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: join_date_room ──
    if (action === "join_date_room") {
      const { data: session } = await supabase
        .from("video_sessions")
        .select(
          "id, participant_1_id, participant_2_id, daily_room_name, ended_at, handshake_started_at, ready_gate_status, ready_gate_expires_at, state",
        )
        .eq("id", sessionId)
        .maybeSingle();

      if (!session || !session.daily_room_name) {
        return new Response(
          JSON.stringify({ error: "Room not found", code: "ROOM_NOT_FOUND" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (
        session.participant_1_id !== user.id &&
        session.participant_2_id !== user.id
      ) {
        return new Response(
          JSON.stringify({ error: "Access denied", code: "ACCESS_DENIED" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (session.ended_at) {
        return new Response(
          JSON.stringify({
            error: "Session has ended",
            code: "SESSION_ENDED",
          }),
          {
            status: 410,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canIssueVideoDateRoomToken(session)) {
        return new Response(
          JSON.stringify({
            error: "Both participants must be ready before joining video",
            code: "READY_GATE_NOT_READY",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
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
      const callerToken = await createMeetingToken(roomName, user.id, 7200);

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
        throw callError;
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

    // ── ACTION: answer_match_call ──
    if (action === "answer_match_call") {
      const targetCallId = callId || sessionId;

      // Fetch the call row first (read-only, callee-only guard)
      const { data: call } = await supabase
        .from("match_calls")
        .select("id, callee_id, daily_room_name, daily_room_url, status")
        .eq("id", targetCallId)
        .eq("callee_id", user.id)
        .maybeSingle();

      if (!call) {
        return new Response(
          JSON.stringify({ error: "Call not found or access denied", code: "NOT_FOUND" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
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
            detail,
          }),
        );
        try {
          const { data: rollback } = await supabase.rpc("match_call_transition", {
            p_call_id: call.id,
            p_action: "end",
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
    console.error("Daily room error:", error);
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
