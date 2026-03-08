import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the user
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

    // 2. Get Bunny credentials from environment
    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = Deno.env.get("BUNNY_STREAM_API_KEY");
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");

    if (!libraryId || !apiKey || !cdnHostname) {
      return new Response(
        JSON.stringify({ success: false, error: "Bunny credentials not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch current profile to check for existing video
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("bunny_video_uid")
      .eq("id", user.id)
      .single();

    const existingVideoId = profile?.bunny_video_uid;

    // 4. Delete the old Bunny video if one exists
    if (existingVideoId) {
      try {
        const deleteResponse = await fetch(
          `https://video.bunnycdn.com/library/${libraryId}/videos/${existingVideoId}`,
          {
            method: "DELETE",
            headers: { "AccessKey": apiKey },
          }
        );
        console.log(`[create-video-upload] Deleted old video ${existingVideoId}: ${deleteResponse.status}`);

        // Clear the old UID immediately so stale references don't linger
        await adminSupabase
          .from("profiles")
          .update({ bunny_video_uid: null, bunny_video_status: "none" })
          .eq("id", user.id);
      } catch (deleteErr) {
        // Log but don't block — old video cleanup is best-effort
        console.error("[create-video-upload] Old video delete failed:", deleteErr);
      }
    }

    // 5. Create a new video object in Bunny Stream
    const createResponse = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos`,
      {
        method: "POST",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: `vibe-${user.id}-${Date.now()}` }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error("[create-video-upload] Bunny create failed:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create video on Bunny" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { guid: videoId } = await createResponse.json();

    // 6. Compute SHA256 signature for tus upload authentication
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // 7. Mark profile as uploading in DB
    await adminSupabase
      .from("profiles")
      .update({ bunny_video_uid: videoId, bunny_video_status: "uploading" })
      .eq("id", user.id);

    // 8. Return tus credentials to client
    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        libraryId,
        expirationTime,
        signature,
        cdnHostname,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[create-video-upload] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
