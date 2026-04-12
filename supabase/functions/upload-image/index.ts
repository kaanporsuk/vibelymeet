import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";

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
    // Legacy compatibility only. Draft-safe photo replace keeps the currently
    // published asset intact until final publish_photo_set / finalize_onboarding.
    const oldPath = formData.get("old_path") as string | null;
    const rawContext = formData.get("context");
    const context =
      rawContext === "onboarding" || rawContext === "profile_studio"
        ? rawContext
        : null;
    const safeReplacedPath =
      typeof oldPath === "string" && oldPath.startsWith(`photos/${user.id}/`)
        ? oldPath
        : null;

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
    const uniqueId = crypto.randomUUID();
    const storagePath = `photos/${user.id}/${uniqueId}.${ext}`;

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

    // ── Profile-photo lifecycle registration / draft session tracking ────────
    // Only explicit profile/onboarding callers participate in Sprint 2 media
    // lifecycle wiring. Chat image uploads continue to use this Edge Function
    // for raw Bunny upload only and remain untouched by profile-photo cleanup.
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let sessionId: string | null = null;
    if (context) {
      try {
        const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
          "create_media_session",
          {
            p_user_id: user.id,
            p_media_type: "photo",
            p_provider_id: storagePath,
            p_provider_meta: {
              storageZone,
              fileType: file.type,
              fileSize: file.size,
              ...(safeReplacedPath ? { replacesStoragePath: safeReplacedPath } : {}),
            },
            p_context: context,
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

        const lifecycle = await registerMediaAsset(adminSupabase, {
          provider: PROVIDERS.BUNNY_STORAGE,
          mediaFamily: MEDIA_FAMILIES.PROFILE_PHOTO,
          ownerUserId: user.id,
          providerPath: storagePath,
          mimeType: file.type,
          bytes: file.size,
          legacyTable: sessionId ? "draft_media_sessions" : "profiles",
          legacyId: sessionId ?? `${user.id}:draft:${storagePath}`,
          status: "uploading",
        });

        if (!lifecycle.success) {
          console.error(`[upload-image] media asset registration failed userId=${user.id} path=${storagePath} err=${lifecycle.error}`);
        }
      } catch (e) {
        console.error("[upload-image] session/lifecycle tracking error:", e);
      }
    }

    return json({ success: true, path: storagePath, sessionId });

  } catch (err) {
    console.error("[upload-image] Unexpected error:", err);
    return json({ success: false, error: String(err) });
  }
});
