import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const file = formData.get("file") as File;
    const thumbnailFile = formData.get("thumbnail") as File | null;
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

    // Validate video MIME type
    const allowedTypes = [
      "video/webm",
      "video/mp4",
      "video/quicktime",
      "video/x-m4v",
    ];
    const baseType = file.type.split(";")[0].trim();
    if (!allowedTypes.includes(baseType) && !file.type.startsWith("video/")) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid file type. Video files only." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Max 20MB for chat video clips
    if (file.size > 20 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ success: false, error: "File too large. Maximum 20MB." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extMap: Record<string, string> = {
      "video/webm": "webm",
      "video/mp4": "mp4",
      "video/quicktime": "mp4",
      "video/x-m4v": "m4v",
    };
    const ext = extMap[baseType] ?? "webm";
    const timestamp = Date.now();
    const storagePath = `chat-videos/${matchId.trim()}/${user.id}_${timestamp}.${ext}`;
    let thumbnailPath: string | null = null;

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const fileBuffer = await file.arrayBuffer();
    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": file.type || "video/webm",
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[upload-chat-video] Bunny upload failed:", uploadRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "Upload to CDN failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (thumbnailFile) {
      const thumbBaseType = thumbnailFile.type.split(";")[0].trim();
      const allowedThumbTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (!allowedThumbTypes.includes(thumbBaseType)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid thumbnail type." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (thumbnailFile.size > 2 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ success: false, error: "Thumbnail too large. Maximum 2MB." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const thumbExtMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const thumbExt = thumbExtMap[thumbBaseType] ?? "jpg";
      thumbnailPath = `chat-videos/${matchId.trim()}/${user.id}_${timestamp}_thumb.${thumbExt}`;
      const thumbBuffer = await thumbnailFile.arrayBuffer();
      const thumbUploadRes = await fetch(
        `https://storage.bunnycdn.com/${storageZone}/${thumbnailPath}`,
        {
          method: "PUT",
          headers: {
            "AccessKey": apiKey,
            "Content-Type": thumbBaseType,
          },
          body: thumbBuffer,
        }
      );
      if (!thumbUploadRes.ok) {
        const thumbErr = await thumbUploadRes.text();
        console.error("[upload-chat-video] Bunny thumbnail upload failed:", thumbUploadRes.status, thumbErr);
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
        mimeType: file.type || baseType || "video/webm",
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

      if (thumbnailPath && thumbnailFile) {
        const thumbAsset = await registerMediaAsset(adminSupabase, {
          provider: PROVIDERS.BUNNY_STORAGE,
          mediaFamily: MEDIA_FAMILIES.CHAT_VIDEO_THUMBNAIL,
          ownerUserId: user.id,
          providerPath: thumbnailPath,
          mimeType: thumbnailFile.type || "image/jpeg",
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
        url: videoUrl,
        thumbnail_url: thumbnailUrl,
        poster_source: thumbnailUrl ? "uploaded_thumbnail" : "first_frame",
        aspect_ratio: aspectRatio,
        processing_status: "ready",
        upload_provider: "bunny",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[upload-chat-video] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
