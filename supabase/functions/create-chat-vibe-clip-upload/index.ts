import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { corsHeadersForRequest, jsonResponse, preflightResponse } from "../_shared/cors.ts";
import {
  CHAT_VIBE_CLIP_MAX_SOURCE_BYTES,
  CHAT_VIBE_CLIP_SOFT_SOURCE_BYTES,
  CHAT_VIBE_CLIP_TUS_TTL_SECONDS,
  createTusSignature,
  getAdminClient,
  getChatStreamConfig,
  validateChatVibeClipCreateInput,
  verifyChatVibeClipMatch,
} from "../_shared/chat-vibe-clips.ts";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function deleteCreatedVideoQuiet(libraryId: string, apiKey: string, videoId: string) {
  try {
    await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`, {
      method: "DELETE",
      headers: { AccessKey: apiKey },
    });
  } catch {
    // Durable orphan cleanup can be added later; creation failure path should not block response.
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflightResponse(req);
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400 });

    const matchId = stringValue(body.match_id);
    const clientRequestId = stringValue(body.client_request_id);
    const fileName = stringValue(body.file_name) ?? "chat-vibe-clip";
    const input = validateChatVibeClipCreateInput({
      matchId,
      clientRequestId,
      durationMs: body.duration_ms,
      sourceBytes: body.source_bytes,
      mimeType: body.mime_type,
      fileName,
    });
    if (!input.ok || !matchId || !clientRequestId) {
      return jsonResponse(req, { success: false, error: input.ok ? "invalid_request" : input.error }, { status: 400 });
    }

    const config = getChatStreamConfig();
    if (!config) {
      return jsonResponse(req, { success: false, error: "missing_bunny_chat_stream_config" }, { status: 503 });
    }

    const admin = getAdminClient();
    const matchCheck = await verifyChatVibeClipMatch(admin, matchId, user.id);
    if (!matchCheck.ok) {
      return jsonResponse(req, { success: false, error: matchCheck.error }, {
        status: matchCheck.error === "blocked_pair" ? 403 : 400,
      });
    }

    const existing = await admin
      .from("chat_vibe_clip_uploads")
      .select("*")
      .eq("sender_id", user.id)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing.error) {
      return jsonResponse(req, { success: false, error: existing.error.message }, { status: 500 });
    }

    let uploadId: string;
    let videoId: string;
    let assetId: string | null = null;
    let status = "uploading";

    if (existing.data) {
      if (existing.data.match_id !== matchId) {
        return jsonResponse(req, { success: false, error: "client_request_id_conflict" }, { status: 409 });
      }
      uploadId = existing.data.id;
      videoId = existing.data.provider_object_id;
      assetId = existing.data.media_asset_id ?? null;
      status = existing.data.status ?? "uploading";
    } else {
      const title = `chat-vibe-${matchId}-${clientRequestId}`;
      const createBody: Record<string, unknown> = { title };
      if (config.collectionId) createBody.collectionId = config.collectionId;

      const bunnyCreate = await fetch(`https://video.bunnycdn.com/library/${config.libraryId}/videos`, {
        method: "POST",
        headers: {
          AccessKey: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createBody),
      });
      if (!bunnyCreate.ok) {
        return jsonResponse(req, { success: false, error: "bunny_create_failed" }, { status: 502 });
      }

      const bunnyPayload = await bunnyCreate.json().catch(() => null) as { guid?: unknown } | null;
      videoId = typeof bunnyPayload?.guid === "string" ? bunnyPayload.guid : "";
      if (!videoId) return jsonResponse(req, { success: false, error: "bunny_create_invalid_response" }, { status: 502 });

      const registered = await registerMediaAsset(admin, {
        provider: PROVIDERS.BUNNY_STREAM,
        mediaFamily: MEDIA_FAMILIES.CHAT_VIDEO,
        ownerUserId: user.id,
        providerObjectId: videoId,
        mimeType: input.mimeType,
        bytes: input.sourceBytes,
        legacyTable: "matches",
        legacyId: matchId,
        status: "uploading",
      });
      if (!registered.success || !registered.assetId) {
        await deleteCreatedVideoQuiet(config.libraryId, config.apiKey, videoId);
        return jsonResponse(req, { success: false, error: registered.error ?? "asset_register_failed" }, { status: 500 });
      }
      assetId = registered.assetId;

      const aspectRatioRaw = body.aspect_ratio;
      const aspectRatio =
        typeof aspectRatioRaw === "number" && Number.isFinite(aspectRatioRaw) && aspectRatioRaw > 0
          ? aspectRatioRaw
          : null;
      const expiresAt = new Date(Date.now() + CHAT_VIBE_CLIP_TUS_TTL_SECONDS * 1000).toISOString();
      const inserted = await admin
        .from("chat_vibe_clip_uploads")
        .insert({
          match_id: matchId,
          sender_id: user.id,
          client_request_id: clientRequestId,
          media_asset_id: assetId,
          provider_object_id: videoId,
          duration_ms: input.durationMs,
          aspect_ratio: aspectRatio,
          source_bytes: input.sourceBytes,
          mime_type: input.mimeType,
          status: "uploading",
          expires_at: expiresAt,
        })
        .select("id,status")
        .single();
      if (inserted.error || !inserted.data) {
        await deleteCreatedVideoQuiet(config.libraryId, config.apiKey, videoId);
        return jsonResponse(req, { success: false, error: inserted.error?.message ?? "upload_session_create_failed" }, { status: 500 });
      }
      uploadId = inserted.data.id;
      status = inserted.data.status;
    }

    const expirationTime = Math.floor(Date.now() / 1000) + CHAT_VIBE_CLIP_TUS_TTL_SECONDS;
    const signature = await createTusSignature({
      libraryId: config.libraryId,
      apiKey: config.apiKey,
      expirationTime,
      videoId,
    });

    return jsonResponse(req, {
      success: true,
      upload_id: uploadId,
      video_id: videoId,
      media_asset_id: assetId,
      library_id: config.libraryId,
      tus_endpoint: "https://video.bunnycdn.com/tusupload",
      expiration_time: expirationTime,
      signature,
      cdn_hostname: config.cdnHostname,
      status,
      max_duration_ms: 30_000,
      max_source_bytes: CHAT_VIBE_CLIP_MAX_SOURCE_BYTES,
      soft_source_bytes: CHAT_VIBE_CLIP_SOFT_SOURCE_BYTES,
      mime_type: input.mimeType,
    });
  } catch (error) {
    console.error("create-chat-vibe-clip-upload unexpected:", error);
    return jsonResponse(req, { success: false, error: "internal" }, {
      status: 500,
      headers: corsHeadersForRequest(req),
    });
  }
});
