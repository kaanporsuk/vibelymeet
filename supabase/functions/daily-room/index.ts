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

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const body = await req.json();
    const { action, sessionId, matchId, callType, callId } = body;

    // delete_room can be unauthenticated (called via sendBeacon)
    if (action === "delete_room") {
      const roomName = body.roomName;
      if (roomName) await deleteDailyRoom(roomName);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All other actions require auth
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: create_date_room ──
    if (action === "create_date_room") {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("id, participant_1_id, participant_2_id, daily_room_name")
        .eq("id", sessionId)
        .maybeSingle();

      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (
        session.participant_1_id !== user.id &&
        session.participant_2_id !== user.id
      ) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
          eject_at_room_exp: false,
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
        .select("id, participant_1_id, participant_2_id, daily_room_name")
        .eq("id", sessionId)
        .maybeSingle();

      if (!session || !session.daily_room_name) {
        return new Response(JSON.stringify({ error: "Room not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (
        session.participant_1_id !== user.id &&
        session.participant_2_id !== user.id
      ) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    }

    // ── ACTION: create_match_call ──
    if (action === "create_match_call") {
      const { data: match } = await supabase
        .from("matches")
        .select("id, profile_id_1, profile_id_2")
        .eq("id", matchId)
        .maybeSingle();

      if (
        !match ||
        (match.profile_id_1 !== user.id && match.profile_id_2 !== user.id)
      ) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const calleeId =
        match.profile_id_1 === user.id
          ? match.profile_id_2
          : match.profile_id_1;
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

      const { data: call, error: callError } = await supabase
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

      if (callError) throw callError;

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
      const { data: call } = await supabase
        .from("match_calls")
        .select("*")
        .eq("id", targetCallId)
        .eq("callee_id", user.id)
        .eq("status", "ringing")
        .maybeSingle();

      if (!call) {
        return new Response(
          JSON.stringify({ error: "Call not found or already answered" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const token = await createMeetingToken(
        call.daily_room_name,
        user.id,
        7200
      );

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
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
