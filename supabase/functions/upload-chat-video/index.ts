import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const matchId = formData.get("match_id") as string | null;

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

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;

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

    const cdnHostname = Deno.env.get("BUNNY_CDN_HOSTNAME")!;
    const videoUrl = `https://${cdnHostname}/${storagePath}`;

    return new Response(
      JSON.stringify({ success: true, url: videoUrl }),
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
