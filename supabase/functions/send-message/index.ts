import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

/** Match `shared/chat/messageRouting` `CHAT_IMAGE_MESSAGE_PREFIX` — avoid leaking transport form in push body. */
const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

/** Keep regex aligned with `shared/chat/conversationListPreview.ts` `HTTP_URL_IN_TEXT_RE`. */
const HTTP_URL_IN_TEXT_RE = /https?:\/\/[^\s]+/gi;

function stripEmbeddedHttpUrlsForPushBody(text: string): string {
  return text.replace(HTTP_URL_IN_TEXT_RE, " ").replace(/\s+/g, " ").trim();
}

function pushPlainBodyHasSubstance(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function notificationPreviewFromTextContent(trimmed: string): string {
  if (trimmed.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) return "Photo";
  const sansUrls = stripEmbeddedHttpUrlsForPushBody(trimmed);
  if (!sansUrls || !pushPlainBodyHasSubstance(sansUrls)) return "Message";
  return sansUrls.length > 80 ? sansUrls.slice(0, 80) + "…" : sansUrls;
}

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

    const body = await req.json();
    const match_id = body?.match_id as string | undefined;
    const content = body?.content as string | undefined;
    const rawClientId = body?.client_request_id as string | undefined;
    const clientRequestId =
      typeof rawClientId === "string" && rawClientId.trim().length > 0 ? rawClientId.trim() : "";

    const messageKind = body?.message_kind as string | undefined;
    const isVibeClip = messageKind === "vibe_clip";
    const isVoice = messageKind === "voice";

    if (isVibeClip) {
      const videoUrl = body?.video_url as string | undefined;
      const durationMs = body?.duration_ms as number | undefined;
      if (
        !match_id ||
        !videoUrl ||
        typeof videoUrl !== "string" ||
        !videoUrl.trim()
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_request" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!clientRequestId || !isUuid(clientRequestId)) {
        return new Response(
          JSON.stringify({ success: false, error: "client_request_id_required" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (isVoice) {
      const audioUrl = body?.audio_url as string | undefined;
      if (!match_id || !audioUrl || typeof audioUrl !== "string" || !audioUrl.trim()) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_request" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!clientRequestId || !isUuid(clientRequestId)) {
        return new Response(
          JSON.stringify({ success: false, error: "client_request_id_required" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (!match_id || typeof content !== "string" || !content.trim()) {
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

    const selectCols =
      "id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, structured_payload";

    // ── Vibe Clip canonical publish path ──
    if (isVibeClip) {
      const videoUrl = (body.video_url as string).trim();
      const durationMs = typeof body.duration_ms === "number" ? Math.max(0, Math.round(body.duration_ms)) : 0;
      const durationSec = Math.max(1, Math.round(durationMs / 1000));
      const thumbnailUrl = typeof body.thumbnail_url === "string" && body.thumbnail_url.trim()
        ? body.thumbnail_url.trim()
        : null;
      const aspectRatioRaw = body.aspect_ratio;
      const aspectRatio =
        typeof aspectRatioRaw === "number" && Number.isFinite(aspectRatioRaw) && aspectRatioRaw > 0
          ? aspectRatioRaw
          : null;
      const posterSource = thumbnailUrl ? "uploaded_thumbnail" : "first_frame";

      const clipPayload = {
        v: 2,
        kind: "vibe_clip",
        client_request_id: clientRequestId,
        duration_ms: durationMs,
        thumbnail_url: thumbnailUrl,
        poster_source: posterSource,
        aspect_ratio: aspectRatio,
        processing_status: "ready",
        upload_provider: "bunny",
      };

      // Idempotency check
      const { data: existingClip } = await serviceClient
        .from("messages")
        .select(selectCols)
        .eq("match_id", match_id)
        .eq("sender_id", actorId)
        .contains("structured_payload", { client_request_id: clientRequestId })
        .maybeSingle();

      if (existingClip) {
        return new Response(
          JSON.stringify({ success: true, idempotent: true, message: existingClip }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const clipRow: Record<string, unknown> = {
        match_id,
        sender_id: actorId,
        content: "\uD83C\uDFAC Vibe Clip",
        message_kind: "vibe_clip",
        video_url: videoUrl,
        video_duration_seconds: durationSec,
        structured_payload: clipPayload,
      };

      const { data: insertedClip, error: clipInsertError } = await serviceClient
        .from("messages")
        .insert(clipRow)
        .select(selectCols)
        .single();

      if (clipInsertError || !insertedClip) {
        const code = (clipInsertError as { code?: string })?.code;
        if (code === "23505") {
          const { data: afterConflict } = await serviceClient
            .from("messages")
            .select(selectCols)
            .eq("match_id", match_id)
            .eq("sender_id", actorId)
            .contains("structured_payload", { client_request_id: clientRequestId })
            .maybeSingle();
          if (afterConflict) {
            return new Response(
              JSON.stringify({ success: true, idempotent: true, message: afterConflict }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
        console.error("send-message vibe_clip insert error:", clipInsertError);
        return new Response(
          JSON.stringify({ success: false, error: "insert_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const recipientId =
        match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;

      try {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        await serviceClient.functions.invoke("send-notification", {
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
          body: {
            user_id: recipientId,
            category: "messages",
            title: senderProfile?.name || "New message",
            body: "\uD83C\uDFAC Sent you a Vibe Clip",
            data: { url: `/chat/${actorId}`, match_id, sender_id: actorId },
          },
        });
      } catch (notifyError) {
        console.error("send-message vibe_clip notification error:", notifyError);
      }

      return new Response(
        JSON.stringify({ success: true, idempotent: false, message: insertedClip }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Voice message canonical publish path ──
    if (isVoice) {
      const audioUrl = (body.audio_url as string).trim();
      const durationRaw = body.audio_duration_seconds;
      let durationSec = 1;
      if (typeof durationRaw === "number" && Number.isFinite(durationRaw)) {
        durationSec = Math.max(1, Math.round(durationRaw));
      } else if (typeof durationRaw === "string" && durationRaw.trim()) {
        const n = Number.parseFloat(durationRaw);
        if (Number.isFinite(n)) durationSec = Math.max(1, Math.round(n));
      }

      const voicePayload = {
        v: 1,
        client_request_id: clientRequestId,
      };

      const { data: existingVoice } = await serviceClient
        .from("messages")
        .select(selectCols)
        .eq("match_id", match_id)
        .eq("sender_id", actorId)
        .contains("structured_payload", { client_request_id: clientRequestId })
        .maybeSingle();

      if (existingVoice) {
        return new Response(
          JSON.stringify({ success: true, idempotent: true, message: existingVoice }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const voiceRow: Record<string, unknown> = {
        match_id,
        sender_id: actorId,
        content: "🎤 Voice message",
        message_kind: "voice",
        audio_url: audioUrl,
        audio_duration_seconds: durationSec,
        structured_payload: voicePayload,
      };

      const { data: insertedVoice, error: voiceInsertError } = await serviceClient
        .from("messages")
        .insert(voiceRow)
        .select(selectCols)
        .single();

      if (voiceInsertError || !insertedVoice) {
        const code = (voiceInsertError as { code?: string })?.code;
        if (code === "23505") {
          const { data: afterConflict } = await serviceClient
            .from("messages")
            .select(selectCols)
            .eq("match_id", match_id)
            .eq("sender_id", actorId)
            .contains("structured_payload", { client_request_id: clientRequestId })
            .maybeSingle();
          if (afterConflict) {
            return new Response(
              JSON.stringify({ success: true, idempotent: true, message: afterConflict }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
        console.error("send-message voice insert error:", voiceInsertError);
        return new Response(
          JSON.stringify({ success: false, error: "insert_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const recipientIdVoice =
        match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;

      try {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        await serviceClient.functions.invoke("send-notification", {
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
          body: {
            user_id: recipientIdVoice,
            category: "messages",
            title: senderProfile?.name || "New message",
            body: "🎤 Sent a voice message",
            data: { url: `/chat/${actorId}`, match_id, sender_id: actorId },
          },
        });
      } catch (notifyError) {
        console.error("send-message voice notification error:", notifyError);
      }

      return new Response(
        JSON.stringify({ success: true, idempotent: false, message: insertedVoice }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Standard text/image message path (unchanged) ──
    const trimmed = content!.trim();

    // Durable idempotency: same client_request_id + match + sender → return existing row
    if (clientRequestId && isUuid(clientRequestId)) {
      const { data: existingByClient } = await serviceClient
        .from("messages")
        .select(selectCols)
        .eq("match_id", match_id)
        .eq("sender_id", actorId)
        .contains("structured_payload", { client_request_id: clientRequestId })
        .maybeSingle();

      if (existingByClient) {
        return new Response(
          JSON.stringify({
            success: true,
            idempotent: true,
            message: existingByClient,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Short-window idempotency (legacy): identical content within 5s
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const { data: existingRecent } = await serviceClient
      .from("messages")
      .select(selectCols)
      .eq("match_id", match_id)
      .eq("sender_id", actorId)
      .eq("content", trimmed)
      .gte("created_at", fiveSecondsAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let messageRow: any = existingRecent;
    let idempotent = false;

    if (!messageRow) {
      const insertRow: Record<string, unknown> = {
        match_id,
        sender_id: actorId,
        content: trimmed,
      };
      if (clientRequestId && isUuid(clientRequestId)) {
        insertRow.structured_payload = { client_request_id: clientRequestId, v: 1 };
      }

      const { data: inserted, error: insertError } = await serviceClient
        .from("messages")
        .insert(insertRow)
        .select(selectCols)
        .single();

      if (insertError || !inserted) {
        const code = (insertError as { code?: string })?.code;
        if (code === "23505" && clientRequestId && isUuid(clientRequestId)) {
          const { data: afterConflict } = await serviceClient
            .from("messages")
            .select(selectCols)
            .eq("match_id", match_id)
            .eq("sender_id", actorId)
            .contains("structured_payload", { client_request_id: clientRequestId })
            .maybeSingle();
          if (afterConflict) {
            return new Response(
              JSON.stringify({
                success: true,
                idempotent: true,
                message: afterConflict,
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
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

    const recipientId =
      match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;

    if (!idempotent) {
      try {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        const preview = notificationPreviewFromTextContent(trimmed);

        await serviceClient.functions.invoke("send-notification", {
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
          body: {
            user_id: recipientId,
            category: "messages",
            title: senderProfile?.name || "New message",
            body: preview,
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
