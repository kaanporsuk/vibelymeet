import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { syncChatMessageMedia } from "../_shared/media-lifecycle.ts";
import { maskId, redactMediaPath } from "../_shared/media-log-redact.ts";

// Fail-soft media authorization: chat media paths embed `.../match-{matchId}/{senderId}/...`.
// We verify the ref is scoped to this sender + match and log a redacted warning on mismatch,
// but do NOT reject unless CHAT_MEDIA_SENDER_SCOPE_ENFORCE is explicitly enabled (default off),
// so legitimate sends can never break. Flip the flag to hard-enforce once monitoring is clean.
const SENDER_SCOPE_ENFORCE =
  (Deno.env.get("CHAT_MEDIA_SENDER_SCOPE_ENFORCE") ?? "").trim().toLowerCase() === "true";

function mediaRefSenderScope(value: string): { matchId: string | null; userId: string | null } {
  const raw = value.trim();
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    // raw storage ref (not an absolute URL) — use as-is
  }
  const m = path.match(/match-([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})(?:\/|$)/);
  return { matchId: m?.[1] ?? null, userId: m?.[2] ?? null };
}

/**
 * Returns true when the send may proceed. Logs a redacted warning on a positive scope mismatch.
 * "Unverifiable" refs (legacy absolute URLs we cannot parse) are allowed through even when
 * enforcing, so only a *proven* cross-sender/cross-match ref is ever blocked.
 */
function mediaSenderScopeOk(
  ref: string,
  expectedMatchId: string,
  expectedUserId: string,
  family: "photos" | "voice" | "chat-videos",
): boolean {
  const { matchId, userId } = mediaRefSenderScope(ref);
  const verdict = !matchId || !userId
    ? "unverifiable"
    : matchId === expectedMatchId && userId === expectedUserId
      ? "ok"
      : "mismatch";
  if (verdict === "ok") return true;
  console.warn(JSON.stringify({
    event: "send_message_media_scope_check",
    verdict,
    family,
    actor_id: maskId(expectedUserId),
    match_id: maskId(expectedMatchId),
    ref_match_id: maskId(matchId),
    ref_user_id: maskId(userId),
    ref: redactMediaPath(ref),
    enforced: SENDER_SCOPE_ENFORCE,
  }));
  return !(verdict === "mismatch" && SENDER_SCOPE_ENFORCE);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EdgeRuntimeWithWaitUntil = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

async function runBackgroundTask(label: string, task: () => Promise<unknown>): Promise<void> {
  const promise = (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${label} error:`, error);
    }
  })();
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(promise);
  } else {
    await promise;
  }
}

function invokeSendNotification(
  serviceClient: SupabaseClient,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  return serviceClient.functions.invoke("send-notification", {
    headers: { Authorization: `Bearer ${serviceRoleKey}` },
    body,
  });
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

/** Match `shared/chat/messageRouting` `CHAT_IMAGE_MESSAGE_PREFIX` — avoid leaking transport form in push body. */
const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

/** Keep regex aligned with `shared/chat/conversationListPreview.ts` `HTTP_URL_IN_TEXT_RE`. */
const HTTP_URL_IN_TEXT_RE = /https?:\/\/[^\s]+/gi;
const VIBE_CLIP_MAX_DURATION_MS = 30_000;
const VIBE_CLIP_DURATION_TOLERANCE_MS = 250;

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

function shouldSyncLifecycleForTextContent(trimmed: string): boolean {
  return trimmed.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)
    || (/^https?:\/\/\S+$/i.test(trimmed) && /\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(trimmed));
}

function imageMarkerUrl(trimmed: string): string | null {
  if (!trimmed.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) return null;
  const url = trimmed.slice(CHAT_IMAGE_MESSAGE_PREFIX.length).trim();
  return url || null;
}

function chatImageStructuredPayload(mediaRef: string, clientRequestId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: mediaRef,
  };
  if (clientRequestId && isUuid(clientRequestId)) {
    payload.client_request_id = clientRequestId;
  }
  return payload;
}

function mediaRefHasStorageSegment(value: string, segment: "photos" | "voice" | "chat-videos"): boolean {
  const raw = value.trim();
  if (raw.startsWith(`${segment}/`) && !raw.includes("..")) return true;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (!parsed.hostname || parsed.hostname === "undefined" || parsed.hostname === "placehold.co") return false;
  return parsed.pathname.includes(`/${segment}/`);
}

type BlockedUserRow = {
  id: string;
};

async function isPairBlocked(
  serviceClient: SupabaseClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const { data: blockAData, error: blockAError } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userA)
    .eq("blocked_id", userB)
    .maybeSingle();
  const blockA = blockAData as BlockedUserRow | null;

  if (blockAError) throw blockAError;
  if (blockA?.id) return true;

  const { data: blockBData, error: blockBError } = await serviceClient
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userB)
    .eq("blocked_id", userA)
    .maybeSingle();
  const blockB = blockBData as BlockedUserRow | null;

  if (blockBError) throw blockBError;
  return Boolean(blockB?.id);
}

async function ensureMessageMediaOrRollback(
  serviceClient: SupabaseClient,
  messageId: string,
  label: string,
  options?: { requireAssets?: boolean },
): Promise<boolean> {
  const syncResult = await syncChatMessageMedia(serviceClient, messageId);
  const assetsSynced = syncResult.assetsSynced ?? 0;
  if (syncResult.success && (!options?.requireAssets || assetsSynced > 0)) {
    return true;
  }

  console.error(
    `send-message ${label} media sync failed:`,
    syncResult.success ? `zero_assets_synced assets=${assetsSynced}` : syncResult.error,
  );
  const { error: rollbackError } = await serviceClient
    .from("messages")
    .delete()
    .eq("id", messageId);
  if (rollbackError) {
    console.error(`send-message ${label} rollback delete failed:`, rollbackError);
  }
  return false;
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
      const durationMs = body?.duration_ms;
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
      if (
        typeof durationMs !== "number" ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        durationMs > VIBE_CLIP_MAX_DURATION_MS + VIBE_CLIP_DURATION_TOLERANCE_MS
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "Video must be 30 seconds or shorter." }),
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

    const recipientId = match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;
    try {
      if (await isPairBlocked(serviceClient, actorId, recipientId)) {
        console.log(JSON.stringify({
          event: "send_message_blocked_pair",
          actor_id: actorId,
          recipient_id: recipientId,
          match_id,
          message_kind: messageKind ?? "text",
        }));
        return new Response(
          JSON.stringify({ success: false, error: "message_blocked", code: "blocked_pair" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (blockError) {
      console.error("send-message block check failed:", blockError);
      return new Response(
        JSON.stringify({ success: false, error: "block_check_failed", code: "block_check_failed" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const selectCols =
      "id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, structured_payload";

    // ── Legacy storage-backed Vibe Clip publish path ────────────────────────
    // New Chat Vibe Clips publish through complete-chat-vibe-clip-upload after
    // direct Bunny Stream TUS upload. Keep this branch only for older clients.
    if (isVibeClip) {
      const videoUrl = (body.video_url as string).trim();
      const durationMs = Math.min(VIBE_CLIP_MAX_DURATION_MS, Math.max(1, Math.round(body.duration_ms as number)));
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

      if (
        !mediaRefHasStorageSegment(videoUrl, "chat-videos") ||
        (thumbnailUrl && !mediaRefHasStorageSegment(thumbnailUrl, "chat-videos"))
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_media_url" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (
        !mediaSenderScopeOk(videoUrl, match_id, actorId, "chat-videos") ||
        (thumbnailUrl && !mediaSenderScopeOk(thumbnailUrl, match_id, actorId, "chat-videos"))
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_media_url" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

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

      if (
        !(await ensureMessageMediaOrRollback(serviceClient, insertedClip.id, "vibe_clip", {
          requireAssets: true,
        }))
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "media_sync_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await runBackgroundTask("send-message vibe_clip notification", async () => {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        await invokeSendNotification(serviceClient, serviceRoleKey, {
          user_id: recipientId,
          category: "messages",
          title: senderProfile?.name || "New message",
          body: "\uD83C\uDFAC Sent you a Vibe Clip",
          data: { url: `/chat/${actorId}`, match_id, sender_id: actorId },
        });
      });

      return new Response(
        JSON.stringify({ success: true, idempotent: false, message: insertedClip }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Voice message canonical publish path ──
    if (isVoice) {
      const audioUrl = (body.audio_url as string).trim();
      if (!mediaRefHasStorageSegment(audioUrl, "voice")) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_media_url" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!mediaSenderScopeOk(audioUrl, match_id, actorId, "voice")) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid_media_url" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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

      if (!(await ensureMessageMediaOrRollback(serviceClient, insertedVoice.id, "voice", { requireAssets: true }))) {
        return new Response(
          JSON.stringify({ success: false, error: "media_sync_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await runBackgroundTask("send-message voice notification", async () => {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        await invokeSendNotification(serviceClient, serviceRoleKey, {
          user_id: recipientId,
          category: "messages",
          title: senderProfile?.name || "New message",
          body: "🎤 Sent a voice message",
          data: { url: `/chat/${actorId}`, match_id, sender_id: actorId },
        });
      });

      return new Response(
        JSON.stringify({ success: true, idempotent: false, message: insertedVoice }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Standard text/image message path (unchanged) ──
    const trimmed = content!.trim();
    const chatImageMarkerUrl = imageMarkerUrl(trimmed);
    if (chatImageMarkerUrl && !mediaRefHasStorageSegment(chatImageMarkerUrl, "photos")) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_media_url" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (chatImageMarkerUrl && !mediaSenderScopeOk(chatImageMarkerUrl, match_id, actorId, "photos")) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_media_url" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
      if (chatImageMarkerUrl) {
        insertRow.structured_payload = chatImageStructuredPayload(chatImageMarkerUrl, clientRequestId);
      } else if (clientRequestId && isUuid(clientRequestId)) {
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

      if (
        shouldSyncLifecycleForTextContent(trimmed)
        && !(await ensureMessageMediaOrRollback(serviceClient, inserted.id, "text_or_image", {
          requireAssets: trimmed.startsWith(CHAT_IMAGE_MESSAGE_PREFIX),
        }))
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "media_sync_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      idempotent = true;
    }

    if (!idempotent) {
      await runBackgroundTask("send-message notification", async () => {
        const { data: senderProfile } = await serviceClient
          .from("profiles")
          .select("name")
          .eq("id", actorId)
          .maybeSingle();

        const preview = notificationPreviewFromTextContent(trimmed);

        await invokeSendNotification(serviceClient, serviceRoleKey, {
          user_id: recipientId,
          category: "messages",
          title: senderProfile?.name || "New message",
          body: preview,
          data: {
            url: `/chat/${actorId}`,
            match_id,
            sender_id: actorId,
          },
        });
      });
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
