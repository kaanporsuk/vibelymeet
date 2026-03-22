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
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");

    if (!libraryId || !apiKey || !cdnHostname) {
      console.error("[create-video-upload] missing Bunny env: libraryId/apiKey/cdnHostname");
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

    const existingVideoId = profile?.bunny_video_uid;

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
      console.error("[create-video-upload] Bunny create failed:", errorText);
      return json(
        { success: false, error: "Failed to create video on Bunny", code: "bunny_create_failed" },
        502,
      );
    }

    const { guid: videoId } = await createResponse.json();

    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    await adminSupabase
      .from("profiles")
      .update({ bunny_video_uid: videoId, bunny_video_status: "uploading" })
      .eq("id", user.id);

    return json(
      {
        success: true,
        videoId,
        libraryId,
        expirationTime,
        signature,
        cdnHostname,
      },
      200,
    );
  } catch (err) {
    console.error("[create-video-upload] Unexpected error:", err);
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
