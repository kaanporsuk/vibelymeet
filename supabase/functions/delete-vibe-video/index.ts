import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ success: false, error: "No authorization header", code: "auth_header_missing" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);
    }

    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = Deno.env.get("BUNNY_STREAM_API_KEY");

    if (!libraryId || !apiKey) {
      console.error("[delete-vibe-video] missing BUNNY_STREAM_LIBRARY_ID or BUNNY_STREAM_API_KEY");
      return json(
        { success: false, error: "Bunny credentials not configured", code: "bunny_config_missing" },
        503,
      );
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("bunny_video_uid")
      .eq("id", user.id)
      .single();

    const videoId = profile?.bunny_video_uid;

    if (!videoId) {
      return json(
        {
          success: true,
          message: "No video to delete",
          hadVideoToDelete: false,
          dbProfileCleared: false,
          bunnyRemoteDeleteOk: null,
          bunnyRemoteDeleteHttpStatus: null,
        },
        200,
      );
    }

    let bunnyRemoteDeleteHttpStatus: number | null = null;
    let bunnyRemoteDeleteOk = false;
    try {
      const deleteResponse = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
        {
          method: "DELETE",
          headers: { "AccessKey": apiKey },
        },
      );
      bunnyRemoteDeleteHttpStatus = deleteResponse.status;
      bunnyRemoteDeleteOk = deleteResponse.ok;
      console.log(
        `[delete-vibe-video] outcome ${JSON.stringify({
          userId: user.id,
          videoId,
          bunnyRemoteDeleteHttpStatus,
          bunnyRemoteDeleteOk,
        })}`,
      );
      if (!deleteResponse.ok) {
        const errBody = await deleteResponse.text().catch(() => "");
        console.error(
          `[delete-vibe-video] Bunny DELETE non-OK body snippet: ${errBody.slice(0, 200)}`,
        );
      }
    } catch (deleteErr) {
      console.error("[delete-vibe-video] Bunny delete network/error:", deleteErr);
    }

    // ── Clear profile columns ────────────────────────────────────────────────
    await adminSupabase
      .from("profiles")
      .update({ bunny_video_uid: null, bunny_video_status: "none", vibe_caption: null })
      .eq("id", user.id);

    // ── Mark all active/published sessions for this video as deleted ─────────
    const { error: sessionError } = await adminSupabase
      .from("draft_media_sessions")
      .update({ status: "deleted" })
      .eq("user_id", user.id)
      .eq("media_type", "vibe_video")
      .eq("provider_id", videoId)
      .in("status", ["created", "uploading", "processing", "ready", "published"]);

    if (sessionError) {
      console.error(
        `[delete-vibe-video] session cleanup error userId=${user.id} videoId=${videoId} err=${sessionError.message}`,
      );
    }

    console.log(
      `[delete-vibe-video] db_cleared userId=${user.id} hadVideoToDelete=true bunnyOk=${bunnyRemoteDeleteOk}`,
    );

    return json(
      {
        success: true,
        hadVideoToDelete: true,
        dbProfileCleared: true,
        bunnyRemoteDeleteOk,
        bunnyRemoteDeleteHttpStatus,
        possibleBunnyOrphan: !bunnyRemoteDeleteOk,
      },
      200,
    );
  } catch (err) {
    console.error("[delete-vibe-video] Unexpected error:", err);
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
