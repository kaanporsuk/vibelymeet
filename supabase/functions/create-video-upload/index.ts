import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
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

function getProjectRef(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

async function cleanupCreatedVideo(
  libraryId: string,
  apiKey: string,
  videoId: string,
  userId: string,
  projectRef: string,
  reason: string,
) {
  try {
    const deleteResponse = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
      {
        method: "DELETE",
        headers: { "AccessKey": apiKey },
      },
    );

    logVibeVideo("warn", "create_video_upload_cleanup_created_video", {
      user_id: userId,
      video_guid: videoId,
      reason,
      bunny_status: deleteResponse.status,
      project_ref: projectRef,
    });
  } catch (cleanupErr) {
    logVibeVideo("error", "create_video_upload_cleanup_failed", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      error_code: cleanupErr instanceof Error ? cleanupErr.name : "unknown",
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    logVibeVideo("warn", "create_video_upload_rejected", {
      reason: "method_not_allowed",
      method: req.method,
    });
    return json({ success: false, error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  try {
    const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
    logVibeVideo("info", "create_video_upload_request_received", {
      project_ref: projectRef,
      method: req.method,
    });
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logVibeVideo("warn", "create_video_upload_rejected", {
        project_ref: projectRef,
        reason: "auth_header_missing",
      });
      return json({ success: false, error: "No authorization header", code: "auth_header_missing" }, 401);
    }

    // Parse body once (before auth, since body stream is single-consume)
    let uploadContext: "onboarding" | "profile_studio" = "profile_studio";
    try {
      const body = await req.json();
      if (body?.context === "onboarding") uploadContext = "onboarding";
    } catch {
      // No body or non-JSON — default to profile_studio
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logVibeVideo("warn", "create_video_upload_rejected", {
        project_ref: projectRef,
        reason: "unauthorized",
      });
      return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);
    }
    logVibeVideo("info", "create_video_upload_auth_resolved", {
      project_ref: projectRef,
      user_id: user.id,
      upload_context: uploadContext,
    });

    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = Deno.env.get("BUNNY_STREAM_API_KEY");
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");

    if (!libraryId || !apiKey || !cdnHostname) {
      logVibeVideo("error", "create_video_upload_missing_bunny_config", {
        user_id: user.id,
        project_ref: projectRef,
        has_library_id: !!libraryId,
        has_api_key: !!apiKey,
        has_cdn_hostname: !!cdnHostname,
      });
      return json(
        { success: false, error: "Bunny credentials not configured", code: "missing_bunny_secret" },
        503,
      );
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Profile gate ─────────────────────────────────────────────────────────
    const { data: profileRow, error: profileReadError } = await adminSupabase
      .from("profiles")
      .select("id,name,age,gender,bunny_video_uid")
      .eq("id", user.id)
      .maybeSingle();
    if (profileReadError) {
      logVibeVideo("error", "create_video_upload_profile_lookup_failed", {
        user_id: user.id,
        project_ref: projectRef,
        error_code: profileReadError.code ?? "profile_lookup_failed",
      });
      return json(
        { success: false, error: "Failed to read profile state", code: "profile_lookup_failed" },
        500,
      );
    }

    if (!profileRow) {
      logVibeVideo("warn", "create_video_upload_profile_missing", {
        user_id: user.id,
        project_ref: projectRef,
      });
      return json(
        { success: false, error: "Profile is missing for current user", code: "profile_missing" },
        409,
      );
    }

    if (profileRow.name == null || profileRow.age == null || profileRow.gender == null) {
      logVibeVideo("warn", "create_video_upload_profile_incomplete", {
        user_id: user.id,
        project_ref: projectRef,
        has_name: profileRow.name != null,
        has_age: profileRow.age != null,
        has_gender: profileRow.gender != null,
      });
      return json(
        {
          success: false,
          error: "Profile is incomplete for video upload",
          code: "profile_incomplete",
        },
        409,
      );
    }

    const existingVideoId = profileRow.bunny_video_uid;

    // ── Create new Bunny Stream video ────────────────────────────────────────
    const createResponse = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos`,
      {
        method: "POST",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: `vibe-${user.id}-${Date.now()}` }),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logVibeVideo("error", "create_video_upload_bunny_create_failed", {
        user_id: user.id,
        project_ref: projectRef,
        http_status: createResponse.status,
        error_code: "bunny_create_failed",
        body_snippet_length: errorText.length,
      });
      return json(
        { success: false, error: "Failed to create video on Bunny", code: "bunny_create_failed" },
        502,
      );
    }

    const { guid: videoId } = await createResponse.json();
    logVibeVideo("info", "create_video_upload_bunny_video_created", {
      user_id: user.id,
      video_guid: videoId,
      library_id: libraryId,
      project_ref: projectRef,
    });

    // ── TUS signature ────────────────────────────────────────────────────────
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // ── Create draft media session (server-owned upload tracking) ────────────
    // Uses adminSupabase (service_role) — the RPC is granted to service_role
    // only.  Edge Function authenticates the user; the RPC trusts the caller.
    const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
      "create_media_session",
      {
        p_user_id: user.id,
        p_media_type: "vibe_video",
        p_provider_id: videoId,
        p_provider_meta: { libraryId, expirationTime, signature, cdnHostname },
        p_context: uploadContext,
      },
    );

    if (sessionError) {
      logVibeVideo("error", "create_video_upload_media_session_create_failed", {
        user_id: user.id,
        video_guid: videoId,
        error_code: sessionError.code ?? "session_creation_failed",
      });
      await cleanupCreatedVideo(libraryId, apiKey, videoId, user.id, projectRef, "session_creation_failed");
      return json(
        { success: false, error: "Failed to create durable upload session", code: "media_session_create_failed" },
        500,
      );
    }

    const sr = sessionResult as Record<string, unknown> | null;
    const sessionId = sr?.session_id ?? null;
    const replacedSessionId = sr?.replaced_session_id ?? null;
    const replacedProviderId = sr?.replaced_provider_id ?? null;

    if (sr?.success !== true) {
      logVibeVideo("error", "create_video_upload_media_session_create_rejected", {
        user_id: user.id,
        video_guid: videoId,
        error_code: typeof sr?.error === "string" ? sr.error : "session_rpc_failed",
      });
      await cleanupCreatedVideo(libraryId, apiKey, videoId, user.id, projectRef, "session_rpc_failed");
      return json(
        { success: false, error: "Failed to create durable upload session", code: "media_session_create_failed" },
        500,
      );
    }

    if (replacedProviderId && replacedProviderId !== existingVideoId) {
      logVibeVideo("warn", "create_video_upload_old_video_cleanup_deferred", {
        user_id: user.id,
        video_guid: String(replacedProviderId),
        reason: "replaced_provider_not_profile_uid",
      });
    }

    logVibeVideo("info", "create_video_upload_media_session_created", {
      user_id: user.id,
      video_guid: videoId,
      media_session_id: typeof sessionId === "string" ? sessionId : null,
      replaced_media_session_id: typeof replacedSessionId === "string" ? replacedSessionId : null,
      upload_context: uploadContext,
    });

    const { data: lifecycleResult, error: lifecycleError } = await adminSupabase.rpc(
      "activate_profile_vibe_video",
      {
        p_user_id: user.id,
        p_video_id: videoId,
        p_video_status: "uploading",
      },
    );

    if (lifecycleError) {
      logVibeVideo("error", "create_video_upload_profile_uid_write_failed", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: typeof sessionId === "string" ? sessionId : null,
        error_code: lifecycleError.code ?? "rpc_error",
      });
      await adminSupabase.rpc("update_media_session_status", {
        p_provider_id: videoId,
        p_new_status: "failed",
        p_error_detail: "profile_update_failed",
      });
      await cleanupCreatedVideo(libraryId, apiKey, videoId, user.id, projectRef, "rpc_error");
      return json(
        { success: false, error: "Failed to persist upload state", code: "profile_update_failed" },
        500,
      );
    }

    const lr = lifecycleResult as Record<string, unknown> | null;
    if (lr?.success !== true) {
      logVibeVideo("error", "create_video_upload_profile_uid_write_rejected", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: typeof sessionId === "string" ? sessionId : null,
        error_code: typeof lr?.error === "string" ? lr.error : "rpc_rejected",
      });
      await adminSupabase.rpc("update_media_session_status", {
        p_provider_id: videoId,
        p_new_status: "failed",
        p_error_detail: "profile_update_rejected",
      });
      await cleanupCreatedVideo(libraryId, apiKey, videoId, user.id, projectRef, "rpc_rejected");
      return json(
        { success: false, error: "Failed to persist upload state", code: "profile_update_failed" },
        500,
      );
    }

    let sessionStatus = "created";
    const { data: sessionUploadResult, error: sessionUploadError } = await adminSupabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: videoId,
        p_new_status: "uploading",
        p_error_detail: null,
      },
    );
    const sur = sessionUploadResult as Record<string, unknown> | null;
    if (sessionUploadError || sur?.success !== true) {
      logVibeVideo("warn", "create_video_upload_media_session_uploading_mark_failed_but_repairable", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: typeof sessionId === "string" ? sessionId : null,
        error_code: sessionUploadError?.code ?? (typeof sur?.error === "string" ? sur.error : "session_status_update_failed"),
        repairable_lifecycle_state: true,
      });
    } else {
      sessionStatus = "uploading";
    }

    logVibeVideo("info", "create_video_upload_profile_uid_write_succeeded", {
      user_id: user.id,
      video_guid: videoId,
      media_session_id: typeof sessionId === "string" ? sessionId : null,
      media_session_status: sessionStatus,
      replaced_existing_video: !!existingVideoId,
      project_ref: projectRef,
    });

    return json(
      {
        success: true,
        videoId,
        libraryId,
        expirationTime,
        signature,
        cdnHostname,
        sessionId,
        sessionStatus,
        repairableLifecycleState: sessionStatus !== "uploading",
      },
      200,
    );
  } catch (err) {
    logVibeVideo("error", "create_video_upload_unexpected_error", {
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
