import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";
import { validateImageUploadBytes } from "../_shared/media-upload-sniffing.ts";

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

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

async function providerErrorMeta(res: Response): Promise<{ status: number; bodyLength: number }> {
  const text = await res.text().catch(() => "");
  return { status: res.status, bodyLength: text.length };
}

function safeUnexpectedError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name || "Error" };
  }
  return { name: typeof error };
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
    const fileValue = formData.get("file");
    const file = isUploadFile(fileValue) ? fileValue : null;
    // Legacy compatibility only. Draft-safe photo replace keeps the currently
    // published asset intact until final publish_photo_set / finalize_onboarding.
    const oldPath = formData.get("old_path") as string | null;
    const rawContext = formData.get("context");
    const context =
      rawContext === "onboarding" || rawContext === "profile_studio" || rawContext === "chat"
        ? rawContext
        : null;
    const rawMatchId = formData.get("match_id");
    const matchId =
      typeof rawMatchId === "string" && rawMatchId.trim().length > 0
        ? rawMatchId.trim()
        : null;
    const safeReplacedPath =
      typeof oldPath === "string" && oldPath.startsWith(`photos/${user.id}/`)
        ? oldPath
        : null;

    if (!file) {
      return json({ success: false, error: "No file provided" });
    }

    if (file.size <= 0) {
      return json({ success: false, error: "Empty image file." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return json({ success: false, error: "File too large. Maximum 10MB." });
    }

    if (context === "chat" && !matchId) {
      return json({ success: false, error: "match_id is required for chat uploads" });
    }

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const storageHostname = "storage.bunnycdn.com";
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (context === "chat" && matchId) {
      const { data: match, error: matchError } = await adminSupabase
        .from("matches")
        .select("id, profile_id_1, profile_id_2")
        .eq("id", matchId)
        .maybeSingle();

      if (matchError || !match || (match.profile_id_1 !== user.id && match.profile_id_2 !== user.id)) {
        return json({ success: false, error: "Forbidden" });
      }
    }

    const fileBuffer = await file.arrayBuffer();
    const mediaValidation = validateImageUploadBytes(fileBuffer, file.type);
    if (!mediaValidation.ok) {
      return json({ success: false, error: "Invalid file type. Use JPEG, PNG, WebP, HEIC, or HEIF." });
    }

    const sniffedMedia = mediaValidation.media;
    const ext = sniffedMedia.extension;
    const uniqueId = crypto.randomUUID();
    const storagePath = `photos/${user.id}/${uniqueId}.${ext}`;

    const uploadRes = await fetch(
      `https://${storageHostname}/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": sniffedMedia.mimeType,
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      console.error("[upload-image] Bunny upload failed:", await providerErrorMeta(uploadRes));
      return json({ success: false, error: "Upload to CDN failed" });
    }

    // ── Media lifecycle registration / draft session tracking ────────────────
    // Profile-photo callers keep the draft-safe session flow; chat callers now
    // register chat_image assets without touching profile-photo semantics.
    let sessionId: string | null = null;
    if (context === "onboarding" || context === "profile_studio") {
      try {
        const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
          "create_media_session",
          {
            p_user_id: user.id,
            p_media_type: "photo",
            p_provider_id: storagePath,
            p_provider_meta: {
              storageZone,
              fileType: sniffedMedia.mimeType,
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
          mimeType: sniffedMedia.mimeType,
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
    } else if (context === "chat" && matchId) {
      try {
        const lifecycle = await registerMediaAsset(adminSupabase, {
          provider: PROVIDERS.BUNNY_STORAGE,
          mediaFamily: MEDIA_FAMILIES.CHAT_IMAGE,
          ownerUserId: user.id,
          providerPath: storagePath,
          mimeType: sniffedMedia.mimeType,
          bytes: file.size,
          legacyTable: "matches",
          legacyId: matchId,
          status: "uploading",
        });

        if (!lifecycle.success) {
          console.error(
            `[upload-image] chat media asset registration failed userId=${user.id} matchId=${matchId} path=${storagePath} err=${lifecycle.error}`,
          );
        }
      } catch (e) {
        console.error("[upload-image] chat lifecycle tracking error:", e);
      }
    }

    return json({ success: true, path: storagePath, sessionId });

  } catch (err) {
    console.error("[upload-image] Unexpected error:", safeUnexpectedError(err));
    return json({ success: false, error: "Upload failed" });
  }
});
