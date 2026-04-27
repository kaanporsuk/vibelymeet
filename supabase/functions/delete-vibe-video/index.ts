import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logVibeVideo } from "../_shared/vibe-video-logs.ts";

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
  if (req.method !== "POST") {
    logVibeVideo("warn", "delete_vibe_video_rejected", {
      reason: "method_not_allowed",
      method: req.method,
    });
    return json({ success: false, error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  try {
    logVibeVideo("info", "delete_vibe_video_requested", { method: req.method });
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logVibeVideo("warn", "delete_vibe_video_rejected", { reason: "auth_header_missing" });
      return json({ success: false, error: "No authorization header", code: "auth_header_missing" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logVibeVideo("warn", "delete_vibe_video_rejected", { reason: "unauthorized" });
      return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);
    }
    logVibeVideo("info", "delete_vibe_video_auth_resolved", { user_id: user.id });

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
      logVibeVideo("info", "delete_vibe_video_noop_no_profile_video", { user_id: user.id });
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
      logVibeVideo("error", "delete_vibe_video_profile_clear_failed", {
        user_id: user.id,
        video_guid: videoId,
        error_code: lifecycleError.code ?? "lifecycle_clear_failed",
      });
      return json(
        { success: false, error: "Failed to delete vibe video", code: "lifecycle_clear_failed" },
        500,
      );
    }

    const lr = lifecycleResult as Record<string, unknown> | null;
    const referencesReleased =
      typeof lr?.references_released === "number" ? lr.references_released : null;
    if (lr?.success !== true) {
      logVibeVideo("error", "delete_vibe_video_profile_clear_rejected", {
        user_id: user.id,
        video_guid: videoId,
        error_code: typeof lr?.error === "string" ? lr.error : "lifecycle_clear_failed",
      });
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
      logVibeVideo("error", "delete_vibe_video_deferred_remote_delete_job_update_failed", {
        user_id: user.id,
        video_guid: videoId,
        error_code: sessionError.code ?? "session_cleanup_error",
      });
    }

    logVibeVideo("info", "delete_vibe_video_profile_clear_succeeded", {
      user_id: user.id,
      video_guid: videoId,
      had_video_to_delete: true,
      references_released: referencesReleased,
    });
    logVibeVideo("info", "delete_vibe_video_deferred_remote_delete_job_created", {
      user_id: user.id,
      video_guid: videoId,
      references_released: referencesReleased,
      delete_deferred_to_worker: true,
    });
    logVibeVideo("warn", "delete_vibe_video_remote_delete_deferred_orphan_risk", {
      user_id: user.id,
      video_guid: videoId,
      possible_bunny_orphan: true,
      delete_deferred_to_worker: true,
    });

    return json(
      {
        success: true,
        hadVideoToDelete: true,
        dbProfileCleared: true,
        bunnyRemoteDeleteOk: null,
        bunnyRemoteDeleteHttpStatus: null,
        possibleBunnyOrphan: true,
        deleteDeferredToWorker: true,
        remoteDeleteState: "deferred_to_media_delete_worker",
      },
      200,
    );
  } catch (err) {
    logVibeVideo("error", "delete_vibe_video_unexpected_error", {
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
