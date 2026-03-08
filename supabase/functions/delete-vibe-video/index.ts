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

    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = Deno.env.get("BUNNY_STREAM_API_KEY");

    if (!libraryId || !apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Bunny credentials not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch current video UID
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("bunny_video_uid")
      .eq("id", user.id)
      .single();

    const videoId = profile?.bunny_video_uid;

    if (!videoId) {
      return new Response(
        JSON.stringify({ success: true, message: "No video to delete" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete from Bunny Stream library
    try {
      const deleteResponse = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
        {
          method: "DELETE",
          headers: { "AccessKey": apiKey },
        }
      );
      console.log(`[delete-vibe-video] Deleted Bunny video ${videoId}: ${deleteResponse.status}`);
    } catch (deleteErr) {
      console.error("[delete-vibe-video] Bunny delete failed:", deleteErr);
      // Continue to clear DB even if Bunny delete fails
    }

    // Clear DB fields
    await adminSupabase
      .from("profiles")
      .update({ bunny_video_uid: null, bunny_video_status: "none", vibe_caption: null })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[delete-vibe-video] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
