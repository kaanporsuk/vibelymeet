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

    const { data: lifecycleResult, error: lifecycleError } = await adminSupabase.rpc(
      "clear_profile_vibe_video",
      {
        p_user_id: user.id,
        p_clear_caption: true,
        p_released_by: "user_action",
      },
    );

    if (lifecycleError) {
      console.error(
        `[delete-vibe-video] lifecycle clear failed userId=${user.id} videoId=${videoId} err=${lifecycleError.message}`,
      );
      return json(
        { success: false, error: "Failed to delete vibe video", code: "lifecycle_clear_failed" },
        500,
      );
    }

    const lr = lifecycleResult as Record<string, unknown> | null;
    if (lr?.success !== true) {
      console.error(
        `[delete-vibe-video] lifecycle clear rejected userId=${user.id} videoId=${videoId} error=${lr?.error}`,
      );
      return json(
        { success: false, error: "Failed to delete vibe video", code: "lifecycle_clear_failed" },
        500,
      );
    }

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
      `[delete-vibe-video] db_cleared userId=${user.id} hadVideoToDelete=true deleteDeferredToWorker=true`,
    );

    return json(
      {
        success: true,
        hadVideoToDelete: true,
        dbProfileCleared: true,
        bunnyRemoteDeleteOk: null,
        bunnyRemoteDeleteHttpStatus: null,
        possibleBunnyOrphan: false,
        deleteDeferredToWorker: true,
      },
      200,
    );
  } catch (err) {
    console.error("[delete-vibe-video] Unexpected error:", err);
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
