import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";
import { validateVoiceUploadBytes } from "../_shared/media-upload-sniffing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const conversationId = formData.get("conversation_id") as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ success: false, error: "No file provided" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Empty audio file." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Max 10MB for voice clips
    if (file.size > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ success: false, error: "File too large. Maximum 10MB." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!conversationId || typeof conversationId !== "string" || conversationId.trim() === "") {
      return new Response(
        JSON.stringify({ success: false, error: "conversation_id is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: match, error: matchError } = await adminSupabase
      .from("matches")
      .select("id, profile_id_1, profile_id_2")
      .eq("id", conversationId.trim())
      .maybeSingle();

    if (matchError || !match || (match.profile_id_1 !== user.id && match.profile_id_2 !== user.id)) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const mediaValidation = validateVoiceUploadBytes(fileBuffer, file.type);
    if (!mediaValidation.ok) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid file type. Audio files only." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sniffedMedia = mediaValidation.media;
    const ext = sniffedMedia.extension;
    const timestamp = Date.now();

    // Path: voice/{conversationId}/{userId}_{timestamp}.ext
    // or:   voice/{userId}/{timestamp}.ext if no conversationId
    const folder = `voice/${conversationId.trim()}`;
    const storagePath = `${folder}/${user.id}_${timestamp}.${ext}`;

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;

    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": sniffedMedia.mimeType,
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      console.error("[upload-voice] Bunny upload failed:", await providerErrorMeta(uploadRes));
      return new Response(
        JSON.stringify({ success: false, error: "Upload to CDN failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return both the path and the full CDN URL.
    const audioUrl = bunnyCdnUrl(storagePath);

    try {
      const lifecycle = await registerMediaAsset(adminSupabase, {
        provider: PROVIDERS.BUNNY_STORAGE,
        mediaFamily: MEDIA_FAMILIES.VOICE_MESSAGE,
        ownerUserId: user.id,
        providerPath: storagePath,
        mimeType: sniffedMedia.mimeType,
        bytes: file.size,
        legacyTable: "matches",
        legacyId: conversationId.trim(),
        status: "uploading",
      });
      if (!lifecycle.success) {
        console.error(
          `[upload-voice] voice asset registration failed userId=${user.id} matchId=${conversationId} path=${storagePath} err=${lifecycle.error}`,
        );
      }
    } catch (lifecycleError) {
      console.error("[upload-voice] lifecycle tracking error:", lifecycleError);
    }

    return new Response(
      JSON.stringify({ success: true, path: storagePath, url: audioUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[upload-voice] Unexpected error:", safeUnexpectedError(err));
    return new Response(
      JSON.stringify({ success: false, error: "Upload failed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
