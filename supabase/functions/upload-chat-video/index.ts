import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";
import {
  validateChatVideoThumbnailBytes,
  validateChatVideoUploadBytes,
} from "../_shared/media-upload-sniffing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Legacy Bunny Storage chat-video upload. New Chat Vibe Clips must use
// create-chat-vibe-clip-upload -> Bunny Stream TUS instead.
const CHAT_VIDEO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

async function providerErrorMeta(res: Response): Promise<{ status: number; bodyLength: number }> {
  const text = await res.text().catch(() => "");
  return { status: res.status, bodyLength: text.length };
}

function safeUnexpectedError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name || "Error" };
  }
  return { name: typeof error };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = isUploadFile(fileValue) ? fileValue : null;
    const thumbnailValue = formData.get("thumbnail");
    const thumbnailFile = isUploadFile(thumbnailValue) ? thumbnailValue : null;
    const matchId = formData.get("match_id") as string | null;
    const aspectRatioRaw = formData.get("aspect_ratio");

    if (!file) {
      return new Response(
        JSON.stringify({ success: false, error: "No file provided" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!matchId || typeof matchId !== "string" || matchId.trim() === "") {
      return new Response(
        JSON.stringify({ success: false, error: "match_id is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user belongs to the match
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id")
      .eq("id", matchId.trim())
      .or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`)
      .maybeSingle();

    if (matchError || !match) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Empty video file." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Max 8MB for the video file; multipart POST must stay under the hosted
    // Supabase Edge Function ~10MB request-body cap (thumbnail + overhead).
    if (file.size > CHAT_VIDEO_MAX_UPLOAD_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: "File too large. Maximum 8MB." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const videoValidation = validateChatVideoUploadBytes(fileBuffer, file.type);
    if (!videoValidation.ok) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid file type. Video files only." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sniffedVideo = videoValidation.media;
    const ext = sniffedVideo.extension;
    const timestamp = Date.now();
    const storagePath = `chat-videos/${matchId.trim()}/${user.id}_${timestamp}.${ext}`;
    let thumbnailPath: string | null = null;
    let thumbnailBuffer: ArrayBuffer | null = null;
    let sniffedThumbnail: { mimeType: string; extension: string } | null = null;

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (thumbnailFile) {
      if (thumbnailFile.size > 2 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ success: false, error: "Thumbnail too large. Maximum 2MB." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      thumbnailBuffer = await thumbnailFile.arrayBuffer();
      const thumbnailValidation = validateChatVideoThumbnailBytes(thumbnailBuffer, thumbnailFile.type);
      if (!thumbnailValidation.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid thumbnail type." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      sniffedThumbnail = thumbnailValidation.media;
      thumbnailPath = `chat-videos/${matchId.trim()}/${user.id}_${timestamp}_thumb.${sniffedThumbnail.extension}`;
    }

    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": sniffedVideo.mimeType,
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      console.error("[upload-chat-video] Bunny upload failed:", await providerErrorMeta(uploadRes));
      return new Response(
        JSON.stringify({ success: false, error: "Upload to CDN failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (thumbnailPath && thumbnailBuffer && sniffedThumbnail) {
      const thumbUploadRes = await fetch(
        `https://storage.bunnycdn.com/${storageZone}/${thumbnailPath}`,
        {
          method: "PUT",
          headers: {
            "AccessKey": apiKey,
            "Content-Type": sniffedThumbnail.mimeType,
          },
          body: thumbnailBuffer,
        }
      );
      if (!thumbUploadRes.ok) {
        console.error("[upload-chat-video] Bunny thumbnail upload failed:", await providerErrorMeta(thumbUploadRes));
      }
    }

    const videoUrl = bunnyCdnUrl(storagePath);
    const thumbnailUrl = thumbnailPath ? bunnyCdnUrl(thumbnailPath) : null;
    const aspectRatioNum = typeof aspectRatioRaw === "string" ? Number.parseFloat(aspectRatioRaw) : NaN;
    const aspectRatio =
      Number.isFinite(aspectRatioNum) && aspectRatioNum > 0 ? aspectRatioNum : null;

    try {
      const videoAsset = await registerMediaAsset(adminSupabase, {
        provider: PROVIDERS.BUNNY_STORAGE,
        mediaFamily: MEDIA_FAMILIES.CHAT_VIDEO,
        ownerUserId: user.id,
        providerPath: storagePath,
        mimeType: sniffedVideo.mimeType,
        bytes: file.size,
        legacyTable: "matches",
        legacyId: matchId.trim(),
        status: "uploading",
      });
      if (!videoAsset.success) {
        console.error(
          `[upload-chat-video] video asset registration failed userId=${user.id} matchId=${matchId} path=${storagePath} err=${videoAsset.error}`,
        );
      }

      if (thumbnailPath && thumbnailFile && sniffedThumbnail) {
        const thumbAsset = await registerMediaAsset(adminSupabase, {
          provider: PROVIDERS.BUNNY_STORAGE,
          mediaFamily: MEDIA_FAMILIES.CHAT_VIDEO_THUMBNAIL,
          ownerUserId: user.id,
          providerPath: thumbnailPath,
          mimeType: sniffedThumbnail.mimeType,
          bytes: thumbnailFile.size,
          legacyTable: "matches",
          legacyId: matchId.trim(),
          status: "uploading",
        });
        if (!thumbAsset.success) {
          console.error(
            `[upload-chat-video] thumbnail asset registration failed userId=${user.id} matchId=${matchId} path=${thumbnailPath} err=${thumbAsset.error}`,
          );
        }
      }
    } catch (lifecycleError) {
      console.error("[upload-chat-video] lifecycle tracking error:", lifecycleError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        path: storagePath,
        url: videoUrl,
        thumbnail_path: thumbnailPath,
        thumbnail_url: thumbnailUrl,
        poster_source: thumbnailUrl ? "uploaded_thumbnail" : "first_frame",
        aspect_ratio: aspectRatio,
        processing_status: "ready",
        upload_provider: "bunny",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[upload-chat-video] Unexpected error:", safeUnexpectedError(err));
    return new Response(
      JSON.stringify({ success: false, error: "Upload failed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
