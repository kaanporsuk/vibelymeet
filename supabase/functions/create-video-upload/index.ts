import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
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
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");

    if (!libraryId || !apiKey || !cdnHostname) {
      console.error(
        `[create-video-upload] missing_bunny_secret userId=${user.id} projectRef=${projectRef} hasLibraryId=${!!libraryId} hasApiKey=${!!apiKey} hasCdnHostname=${!!cdnHostname}`,
      );
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
      console.error(
        `[create-video-upload] profile lookup failed userId=${user.id} projectRef=${projectRef} err=${profileReadError.message}`,
      );
      return json(
        { success: false, error: "Failed to read profile state", code: "profile_lookup_failed" },
        500,
      );
    }

    if (!profileRow) {
      console.error(
        `[create-video-upload] profile_missing userId=${user.id} projectRef=${projectRef}`,
      );
      return json(
        { success: false, error: "Profile is missing for current user", code: "profile_missing" },
        409,
      );
    }

    if (profileRow.name == null || profileRow.age == null || profileRow.gender == null) {
      console.error(
        `[create-video-upload] profile_incomplete userId=${user.id} projectRef=${projectRef} hasName=${profileRow.name != null} hasAge=${profileRow.age != null} hasGender=${profileRow.gender != null}`,
      );
      return json(
        {
          success: false,
          error: "Profile is incomplete for video upload",
          code: "profile_incomplete",
        },
        409,
      );
    }

    // ── Parse optional context from request body ─────────────────────────────
    let uploadContext: "onboarding" | "profile_studio" = "profile_studio";
    try {
      const body = await req.json();
      if (body?.context === "onboarding") uploadContext = "onboarding";
    } catch {
      // No body or non-JSON — default to profile_studio
    }

    // ── Delete existing Bunny video if replacing ─────────────────────────────
    const existingVideoId = profileRow.bunny_video_uid;

    if (existingVideoId) {
      try {
        const deleteResponse = await fetch(
          `https://video.bunnycdn.com/library/${libraryId}/videos/${existingVideoId}`,
          {
            method: "DELETE",
            headers: { "AccessKey": apiKey },
          },
        );
        console.log(
          `[create-video-upload] replaced old video userId=${user.id} oldVideoId=${existingVideoId} bunnyStatus=${deleteResponse.status}`,
        );

        await adminSupabase
          .from("profiles")
          .update({ bunny_video_uid: null, bunny_video_status: "none" })
          .eq("id", user.id);
      } catch (deleteErr) {
        console.error("[create-video-upload] Old video delete failed:", deleteErr);
      }
    }

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
      console.error(
        "[create-video-upload] Bunny create failed:",
        JSON.stringify({
          httpStatus: createResponse.status,
          bodySnippet: errorText.slice(0, 500),
        }),
      );
      return json(
        { success: false, error: "Failed to create video on Bunny", code: "bunny_create_failed" },
        502,
      );
    }

    const { guid: videoId } = await createResponse.json();
    console.log(
      `[create-video-upload] created bunny video userId=${user.id} videoId=${videoId} libraryId=${libraryId} projectRef=${projectRef}`,
    );

    // ── TUS signature ────────────────────────────────────────────────────────
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // ── Create draft media session (server-owned upload tracking) ────────────
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
      console.error(
        `[create-video-upload] session creation failed userId=${user.id} videoId=${videoId} err=${sessionError.message}`,
      );
      // Non-fatal: continue without session tracking for backward compatibility
    }

    const sessionId = (sessionResult as Record<string, unknown>)?.session_id ?? null;
    const replacedSessionId = (sessionResult as Record<string, unknown>)?.replaced_session_id ?? null;
    const replacedProviderId = (sessionResult as Record<string, unknown>)?.replaced_provider_id ?? null;

    if (replacedProviderId && replacedProviderId !== existingVideoId) {
      // There was a session-tracked video that wasn't the one in profiles.
      // Attempt cleanup of the orphaned Bunny asset.
      try {
        await fetch(
          `https://video.bunnycdn.com/library/${libraryId}/videos/${replacedProviderId}`,
          { method: "DELETE", headers: { "AccessKey": apiKey } },
        );
        console.log(
          `[create-video-upload] cleaned orphan session video userId=${user.id} orphanVideoId=${replacedProviderId}`,
        );
      } catch {
        console.error(
          `[create-video-upload] orphan cleanup failed userId=${user.id} orphanVideoId=${replacedProviderId}`,
        );
      }
    }

    console.log(
      `[create-video-upload] session created userId=${user.id} sessionId=${sessionId} replacedSessionId=${replacedSessionId} context=${uploadContext}`,
    );

    // ── Update profile (backward compat: clients still read profiles columns) ─
    const { data: updatedRows, error: profileUpdateError } = await adminSupabase
      .from("profiles")
      .update({ bunny_video_uid: videoId, bunny_video_status: "uploading" })
      .eq("id", user.id)
      .select("id");
    if (profileUpdateError) {
      console.error(
        `[create-video-upload] profile update failed userId=${user.id} videoId=${videoId} projectRef=${projectRef} err=${profileUpdateError.message}`,
      );
      return json(
        { success: false, error: "Failed to persist upload state", code: "profile_update_failed" },
        500,
      );
    }
    const matchedRows = updatedRows?.length ?? 0;
    console.log(
      `[create-video-upload] profile update outcome userId=${user.id} videoId=${videoId} matchedRows=${matchedRows} projectRef=${projectRef}`,
    );
    if (matchedRows !== 1) {
      console.error(
        `[create-video-upload] unexpected matchedRows userId=${user.id} videoId=${videoId} matchedRows=${matchedRows} projectRef=${projectRef}`,
      );
      return json(
        { success: false, error: "Profile row mismatch while starting upload", code: "profile_row_mismatch" },
        500,
      );
    }

    return json(
      {
        success: true,
        videoId,
        libraryId,
        expirationTime,
        signature,
        cdnHostname,
        sessionId,
      },
      200,
    );
  } catch (err) {
    console.error("[create-video-upload] Unexpected error:", err);
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
