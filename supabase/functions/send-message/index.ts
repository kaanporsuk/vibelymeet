import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { match_id, content } = await req.json();

    if (!match_id || typeof content !== "string" || !content.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_request" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: userRes, error: userError } = await userClient.auth.getUser();
    if (userError || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const actorId = userRes.user.id;

    // Load match and validate participation server-side
    const { data: match, error: matchError } = await serviceClient
      .from("matches")
      .select("id, profile_id_1, profile_id_2")
      .eq("id", match_id)
      .maybeSingle();

    if (matchError || !match) {
      return new Response(
        JSON.stringify({ success: false, error: "match_not_found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (match.profile_id_1 !== actorId && match.profile_id_2 !== actorId) {
      return new Response(
        JSON.stringify({ success: false, error: "access_denied" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Idempotency: check for a very recent identical message from this actor
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const trimmed = content.trim();

    const { data: existing } = await serviceClient
      .from("messages")
      .select("id, match_id, sender_id, content, created_at")
      .eq("match_id", match_id)
      .eq("sender_id", actorId)
      .eq("content", trimmed)
      .gte("created_at", fiveSecondsAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let messageRow: any = existing;
    let idempotent = false;

    if (!messageRow) {
      const { data: inserted, error: insertError } = await serviceClient
        .from("messages")
        .insert({
          match_id,
          sender_id: actorId,
          content: trimmed,
        })
        .select(
          "id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds",
        )
        .single();

      if (insertError || !inserted) {
        console.error("send-message insert error:", insertError);
        return new Response(
          JSON.stringify({ success: false, error: "insert_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      messageRow = inserted;
    } else {
      idempotent = true;
    }

    // Determine recipient
    const recipientId =
      match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;

    // Only send notification for non-idempotent inserts
    if (!idempotent) {
      try {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        const preview =
          trimmed.length > 80 ? trimmed.slice(0, 80) + "…" : trimmed;

        await serviceClient.functions.invoke("send-notification", {
          body: {
            user_id: recipientId,
            category: "messages",
            title: senderProfile?.name || "New message",
            body: preview,
            // Web + native /chat/:id both use the other user's profile_id (sender), not match_id
            data: {
              url: `/chat/${actorId}`,
              match_id,
              sender_id: actorId,
            },
          },
        });
      } catch (notifyError) {
        console.error("send-message notification error:", notifyError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        idempotent,
        message: messageRow,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-message unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

