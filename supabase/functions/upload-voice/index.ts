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
    const conversationId = formData.get("conversation_id") as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ success: false, error: "No file provided" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate audio type
    const allowedTypes = [
      "audio/webm", "audio/ogg", "audio/mp4",
      "audio/mpeg", "audio/wav", "audio/x-m4a",
      "audio/mp4; codecs=mp4a",
    ];
    const baseType = file.type.split(";")[0].trim();
    if (!allowedTypes.includes(baseType) && !file.type.startsWith("audio/")) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid file type. Audio files only." }),
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

    // Determine extension
    const extMap: Record<string, string> = {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "m4a",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-m4a": "m4a",
    };
    const ext = extMap[baseType] ?? "webm";
    const timestamp = Date.now();

    // Path: voice/{conversationId}/{userId}_{timestamp}.ext
    // or:   voice/{userId}/{timestamp}.ext if no conversationId
    const folder = `voice/${conversationId.trim()}`;
    const storagePath = `${folder}/${user.id}_${timestamp}.${ext}`;

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;

    const fileBuffer = await file.arrayBuffer();
    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": file.type || "audio/webm",
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[upload-voice] Bunny upload failed:", uploadRes.status, errText);
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
        mimeType: file.type || baseType || "audio/webm",
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
    console.error("[upload-voice] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
