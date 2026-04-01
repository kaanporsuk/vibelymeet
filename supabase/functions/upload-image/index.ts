import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
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
      return json({ success: false, error: "No authorization header" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ success: false, error: "Unauthorized" });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const oldPath = formData.get("old_path") as string | null;
    const context = (formData.get("context") as string) || "profile_studio";

    if (!file) {
      return json({ success: false, error: "No file provided" });
    }

    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png",
      "image/webp", "image/heic", "image/heif",
    ];
    if (!allowedTypes.includes(file.type)) {
      return json({ success: false, error: "Invalid file type. Use JPEG, PNG, WebP, or HEIC." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return json({ success: false, error: "File too large. Maximum 10MB." });
    }

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const storageHostname = "storage.bunnycdn.com";

    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heic",
    };
    const ext = extMap[file.type] ?? "jpg";
    const timestamp = Date.now();
    const storagePath = `photos/${user.id}/${timestamp}.${ext}`;

    const fileBuffer = await file.arrayBuffer();
    const uploadRes = await fetch(
      `https://${storageHostname}/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": file.type,
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[upload-image] Bunny upload failed:", uploadRes.status, errText);
      return json({ success: false, error: "Upload to CDN failed" });
    }

    // ── Create draft media session for this photo ────────────────────────────
    // Photos go directly to 'ready' since no transcoding step is needed.
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let sessionId: string | null = null;
    try {
      const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
        "create_media_session",
        {
          p_user_id: user.id,
          p_media_type: "photo",
          p_provider_id: storagePath,
          p_provider_meta: { storageZone, fileType: file.type, fileSize: file.size },
          p_context: context === "onboarding" ? "onboarding" : "profile_studio",
          p_storage_path: storagePath,
        },
      );

      if (sessionError) {
        console.error(`[upload-image] session creation failed userId=${user.id} path=${storagePath} err=${sessionError.message}`);
      } else {
        const sr = sessionResult as Record<string, unknown> | null;
        if (sr?.success) {
          sessionId = (sr.session_id as string) ?? null;
          // Advance session directly to 'ready' since Bunny upload is complete
          await adminSupabase
            .from("draft_media_sessions")
            .update({ status: "ready" })
            .eq("id", sessionId);
        } else {
          console.error(`[upload-image] session RPC failed userId=${user.id} error=${sr?.error}`);
        }
      }
    } catch (e) {
      console.error("[upload-image] session tracking error:", e);
    }

    // ── Mark old photo session as deleted if replacing ────────────────────────
    if (oldPath && oldPath.startsWith(`photos/${user.id}/`)) {
      // Delete from Bunny Storage
      await fetch(
        `https://${storageHostname}/${storageZone}/${oldPath}`,
        {
          method: "DELETE",
          headers: { "AccessKey": apiKey },
        }
      ).catch(err => console.warn("[upload-image] Failed to delete old file:", err));

      // Mark the old photo's session as deleted
      try {
        await adminSupabase.rpc("mark_photo_deleted", {
          p_user_id: user.id,
          p_storage_path: oldPath,
        });
      } catch (e) {
        console.error("[upload-image] old session cleanup error:", e);
      }
    }

    return json({ success: true, path: storagePath, sessionId });

  } catch (err) {
    console.error("[upload-image] Unexpected error:", err);
    return json({ success: false, error: String(err) });
  }
});
