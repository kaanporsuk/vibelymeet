import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { logVibeVideo } from "../_shared/vibe-video-logs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
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

function isValidVideoGuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function mapBunnyVideoStatus(status: unknown): "processing" | "ready" | "failed" {
  if (status === 3 || status === 4) return "ready";
  if (status === 5 || status === 8) return "failed";
  return "processing";
}

type BunnyAccessMode = "read_only" | "stream_api";

type BunnyLookupResult =
  | {
    ok: true;
    video: { status?: unknown; encodeProgress?: unknown };
    accessMode: BunnyAccessMode;
    attemptedReadKey: boolean;
    attemptedStreamApiKey: boolean;
  }
  | {
    ok: false;
    httpStatus: number | null;
    bodySnippetLength: number;
    accessMode: BunnyAccessMode | null;
    attemptedReadKey: boolean;
    attemptedStreamApiKey: boolean;
  };

async function getBunnyVideo(
  libraryId: string,
  videoId: string,
  readKey: string,
  streamApiKey: string,
): Promise<BunnyLookupResult> {
  const attempts: Array<{ key: string; mode: BunnyAccessMode }> = [];
  if (readKey) attempts.push({ key: readKey, mode: "read_only" });
  if (streamApiKey && streamApiKey !== readKey) {
    attempts.push({ key: streamApiKey, mode: "stream_api" });
  }

  let lastFailure: Extract<BunnyLookupResult, { ok: false }> = {
    ok: false,
    httpStatus: null,
    bodySnippetLength: 0,
    accessMode: null,
    attemptedReadKey: attempts.some((attempt) => attempt.mode === "read_only"),
    attemptedStreamApiKey: attempts.some((attempt) => attempt.mode === "stream_api"),
  };

  for (const attempt of attempts) {
    const response = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
      {
        method: "GET",
        headers: { AccessKey: attempt.key },
      },
    );

    if (response.ok) {
      return {
        ok: true,
        video: await response.json().catch(() => ({})) as { status?: unknown; encodeProgress?: unknown },
        accessMode: attempt.mode,
        attemptedReadKey: attempts.some((item) => item.mode === "read_only"),
        attemptedStreamApiKey: attempts.some((item) => item.mode === "stream_api"),
      };
    }

    const text = await response.text().catch(() => "");
    lastFailure = {
      ok: false,
      httpStatus: response.status,
      bodySnippetLength: text.length,
      accessMode: attempt.mode,
      attemptedReadKey: attempts.some((item) => item.mode === "read_only"),
      attemptedStreamApiKey: attempts.some((item) => item.mode === "stream_api"),
    };
  }

  return lastFailure;
}

serve(async (req) => {
  const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    logVibeVideo("warn", "sync_vibe_video_status_rejected", {
      project_ref: projectRef,
      reason: "method_not_allowed",
      method: req.method,
    });
    return json({ success: false, error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logVibeVideo("warn", "sync_vibe_video_status_rejected", {
        project_ref: projectRef,
        reason: "auth_header_missing",
      });
      return json({ success: false, error: "No authorization header", code: "auth_header_missing" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logVibeVideo("warn", "sync_vibe_video_status_rejected", {
        project_ref: projectRef,
        reason: "unauthorized",
      });
      return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id,bunny_video_uid,bunny_video_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      logVibeVideo("error", "sync_vibe_video_status_profile_lookup_failed", {
        project_ref: projectRef,
        user_id: user.id,
        error_code: profileError.code ?? "profile_lookup_failed",
      });
      return json({ success: false, error: "Failed to read profile state", code: "profile_lookup_failed" }, 500);
    }

    const currentVideoId =
      typeof profile?.bunny_video_uid === "string" ? profile.bunny_video_uid.trim() : "";
    if (!currentVideoId) {
      logVibeVideo("info", "sync_vibe_video_status_no_current_video", {
        project_ref: projectRef,
        user_id: user.id,
      });
      return json({
        success: true,
        synced: false,
        reason: "no_current_video",
        videoId: null,
        mappedStatus: "none",
      });
    }

    const body = await req.json().catch(() => ({})) as { provider_object_id?: unknown; videoId?: unknown };
    const requestedVideoId =
      typeof body.provider_object_id === "string" && body.provider_object_id.trim().length > 0
        ? body.provider_object_id.trim()
        : typeof body.videoId === "string" && body.videoId.trim().length > 0
        ? body.videoId.trim()
        : currentVideoId;

    if (!isValidVideoGuid(requestedVideoId)) {
      logVibeVideo("warn", "sync_vibe_video_status_rejected", {
        project_ref: projectRef,
        user_id: user.id,
        reason: "invalid_video_guid",
      });
      return json({ success: false, error: "Invalid video id", code: "invalid_video_guid" }, 400);
    }

    if (requestedVideoId !== currentVideoId) {
      logVibeVideo("warn", "sync_vibe_video_status_rejected", {
        project_ref: projectRef,
        user_id: user.id,
        video_guid: requestedVideoId,
        reason: "video_not_current",
      });
      return json({ success: false, error: "Video is no longer current", code: "video_not_current" }, 409);
    }

    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID")?.trim() ?? "";
    const readKey = Deno.env.get("BUNNY_WEBHOOK_SIGNING_KEY")?.trim() ?? "";
    const streamApiKey = Deno.env.get("BUNNY_STREAM_API_KEY")?.trim() ?? "";

    if (!libraryId || (!readKey && !streamApiKey)) {
      logVibeVideo("error", "sync_vibe_video_status_missing_bunny_config", {
        project_ref: projectRef,
        user_id: user.id,
        has_library_id: !!libraryId,
        has_read_key: !!readKey,
        has_stream_api_key: !!streamApiKey,
      });
      return json({ success: false, error: "Bunny credentials not configured", code: "missing_bunny_secret" }, 503);
    }

    const bunnyLookup = await getBunnyVideo(libraryId, requestedVideoId, readKey, streamApiKey);
    if (!bunnyLookup.ok) {
      logVibeVideo("error", "sync_vibe_video_status_bunny_lookup_failed", {
        project_ref: projectRef,
        user_id: user.id,
        video_guid: requestedVideoId,
        http_status: bunnyLookup.httpStatus,
        access_mode: bunnyLookup.accessMode,
        attempted_read_key: bunnyLookup.attemptedReadKey,
        attempted_stream_api_key: bunnyLookup.attemptedStreamApiKey,
        body_snippet_length: bunnyLookup.bodySnippetLength,
      });
      return json({ success: false, error: "Failed to read Bunny video status", code: "bunny_lookup_failed" }, 502);
    }

    const bunnyVideo = bunnyLookup.video;
    const bunnyStatus = typeof bunnyVideo.status === "number" ? bunnyVideo.status : null;
    const mappedStatus = mapBunnyVideoStatus(bunnyStatus);

    logVibeVideo("info", "sync_vibe_video_status_bunny_status_mapped", {
      project_ref: projectRef,
      user_id: user.id,
      video_guid: requestedVideoId,
      bunny_status: bunnyStatus,
      mapped_status: mappedStatus,
      encode_progress: typeof bunnyVideo.encodeProgress === "number" ? bunnyVideo.encodeProgress : null,
      access_mode: bunnyLookup.accessMode,
      attempted_read_key: bunnyLookup.attemptedReadKey,
      attempted_stream_api_key: bunnyLookup.attemptedStreamApiKey,
    });

    const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: requestedVideoId,
        p_new_status: mappedStatus,
        p_error_detail: mappedStatus === "failed" ? `bunny_status_${bunnyStatus ?? "unknown"}` : null,
      },
    );

    const sr = sessionResult as Record<string, unknown> | null;
    if (sessionError || sr?.success !== true) {
      logVibeVideo("error", "sync_vibe_video_status_session_update_failed", {
        project_ref: projectRef,
        user_id: user.id,
        video_guid: requestedVideoId,
        mapped_status: mappedStatus,
        error_code: sessionError?.code ?? (typeof sr?.error === "string" ? sr.error : "session_update_failed"),
      });
      return json({ success: false, error: "Failed to update video status", code: "session_update_failed" }, 500);
    }

    const attemptPatch: Record<string, string | null> = {
      status: mappedStatus,
      error_detail: mappedStatus === "failed" ? `bunny_status_${bunnyStatus ?? "unknown"}` : null,
    };
    if (typeof sr.session_id === "string") {
      attemptPatch.draft_media_session_id = sr.session_id;
    }
    const { data: attemptRow, error: attemptUpdateError } = await adminSupabase
      .from("vibe_video_uploads")
      .update(attemptPatch)
      .eq("provider_object_id", requestedVideoId)
      .select("id,status")
      .maybeSingle();

    if (attemptUpdateError) {
      logVibeVideo("error", "sync_vibe_video_upload_attempt_update_failed", {
        project_ref: projectRef,
        user_id: user.id,
        video_guid: requestedVideoId,
        mapped_status: mappedStatus,
        media_session_id: typeof sr.session_id === "string" ? sr.session_id : null,
        error_code: attemptUpdateError.code ?? "attempt_update_failed",
      });
      return json({ success: false, error: "Failed to update upload attempt", code: "attempt_update_failed" }, 500);
    }

    logVibeVideo("info", "sync_vibe_video_status_succeeded", {
      project_ref: projectRef,
      user_id: user.id,
      video_guid: requestedVideoId,
      mapped_status: mappedStatus,
      previous_status: typeof sr.previous_status === "string" ? sr.previous_status : null,
      upload_attempt_id: typeof attemptRow?.id === "string" ? attemptRow.id : null,
    });

    return json({
      success: true,
      synced: true,
      videoId: requestedVideoId,
      uploadAttemptId: attemptRow?.id ?? null,
      bunnyStatus,
      mappedStatus,
      previousStatus: typeof sr.previous_status === "string" ? sr.previous_status : null,
      newStatus: typeof sr.new_status === "string" ? sr.new_status : mappedStatus,
    });
  } catch (err) {
    logVibeVideo("error", "sync_vibe_video_status_unexpected_error", {
      project_ref: projectRef,
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
