import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";
import { validateImageUploadBytes } from "../_shared/media-upload-sniffing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-request-id",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hexFromBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return hexFromBytes(new Uint8Array(digest));
}

async function stableUploadToken(parts: readonly string[]): Promise<string> {
  const encoded = new TextEncoder().encode(parts.join("\u001f"));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return hexFromBytes(new Uint8Array(digest)).slice(0, 16);
}

function optionalFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type ClientRequestIdResult =
  | { ok: true; clientRequestId: string }
  | { ok: false; error: "client_request_id_conflict" | "client_request_id_invalid" };

function clientRequestIdForUpload(req: Request, formData: FormData): ClientRequestIdResult {
  const fromForm = optionalFormString(formData, "client_request_id");
  const fromHeader = req.headers.get("x-client-request-id")?.trim() || null;
  if (fromForm && fromHeader && fromForm !== fromHeader) {
    return { ok: false, error: "client_request_id_conflict" };
  }
  const candidate = fromForm ?? fromHeader;
  if (!candidate) return { ok: true, clientRequestId: crypto.randomUUID() };
  if (candidate.length > 128) return { ok: false, error: "client_request_id_invalid" };
  return { ok: true, clientRequestId: candidate };
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
    const matchId = optionalFormString(formData, "match_id");
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
    const contentSha256 = await sha256Hex(fileBuffer);
    const clientRequest = clientRequestIdForUpload(req, formData);
    if (!clientRequest.ok) {
      return json({ success: false, error: clientRequest.error }, 400);
    }
    const clientRequestId = clientRequest.clientRequestId;
    const mediaFamily = context === "chat" ? MEDIA_FAMILIES.CHAT_IMAGE : MEDIA_FAMILIES.PROFILE_PHOTO;
    const scopeKey = context === "chat" && matchId
      ? `match:${matchId}`
      : `profile:${user.id}:${context ?? "legacy"}`;
    const requestPathToken = await stableUploadToken([
      user.id,
      mediaFamily,
      scopeKey,
      clientRequestId,
      contentSha256,
    ]);
    const storagePath = `photos/${user.id}/req-${requestPathToken}.${ext}`;
    const baseReceiptMetadata: Record<string, unknown> = {
      context: context ?? "legacy",
      storage_zone: storageZone,
      mime_type: sniffedMedia.mimeType,
      bytes: file.size,
      ...(matchId ? { match_id: matchId } : {}),
      ...(safeReplacedPath ? { replaces_storage_path: safeReplacedPath } : {}),
    };

    const { data: reserveData, error: reserveError } = await adminSupabase.rpc("reserve_media_upload", {
      p_owner_user_id: user.id,
      p_media_family: mediaFamily,
      p_scope_key: scopeKey,
      p_client_request_id: clientRequestId,
      p_content_sha256: contentSha256,
      p_provider: PROVIDERS.BUNNY_STORAGE,
      p_provider_path: storagePath,
      p_provider_object_id: null,
      p_metadata: baseReceiptMetadata,
    });

    if (reserveError) {
      console.error(`[upload-image] reserve_media_upload failed userId=${user.id} path=${storagePath} err=${reserveError.message}`);
      return json({ success: false, error: "Upload reservation failed" });
    }

    const reserve = reserveData as Record<string, unknown> | null;
    if (!reserve?.success) {
      const error = typeof reserve?.error === "string" ? reserve.error : "Upload reservation failed";
      const code = typeof reserve?.code === "string" ? reserve.code : null;
      return json({ success: false, error, code: code ?? undefined }, code?.includes("conflict") ? 409 : 200);
    }

    const receiptId = typeof reserve.receipt_id === "string" ? reserve.receipt_id : null;
    const reservedStatus = typeof reserve.status === "string" ? reserve.status : "reserved";
    const reservedPath = typeof reserve.provider_path === "string" ? reserve.provider_path : storagePath;
    const reserveMetadata = isRecord(reserve.metadata) ? reserve.metadata : {};
    if ((reservedStatus === "uploaded" || reservedStatus === "attached") && reservedPath) {
      return json({
        success: true,
        path: reservedPath,
        sessionId: typeof reserveMetadata.session_id === "string" ? reserveMetadata.session_id : null,
      });
    }

    const uploadRes = await fetch(
      `https://${storageHostname}/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": sniffedMedia.mimeType,
          "Checksum": contentSha256.toUpperCase(),
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      console.error("[upload-image] Bunny upload failed:", await providerErrorMeta(uploadRes));
      if (receiptId) {
        await adminSupabase
          .from("media_upload_receipts")
          .update({ status: "failed", last_error: `provider_upload_failed:${uploadRes.status}` })
          .eq("id", receiptId);
      }
      return json({ success: false, error: "Upload to CDN failed" });
    }

    // ── Media lifecycle registration / draft session tracking ────────────────
    // Profile-photo callers keep the draft-safe session flow; chat callers now
    // register chat_image assets without touching profile-photo semantics.
    let sessionId: string | null = null;
    let assetId: string | null = null;
    let lifecycleErrorMessage: string | null = null;
    if (context === "onboarding" || context === "profile_studio") {
      try {
        const { data: existingSession, error: existingSessionError } = await adminSupabase
          .from("draft_media_sessions")
          .select("id")
          .eq("user_id", user.id)
          .eq("media_type", "photo")
          .eq("provider_id", storagePath)
          .eq("storage_path", storagePath)
          .eq("context", context)
          .in("status", ["created", "ready"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSessionError) {
          console.error(
            `[upload-image] existing session lookup failed userId=${user.id} path=${storagePath} err=${existingSessionError.message}`,
          );
        }

        if (typeof existingSession?.id === "string") {
          sessionId = existingSession.id;
          await adminSupabase
            .from("draft_media_sessions")
            .update({ status: "ready" })
            .eq("id", sessionId);
        } else {
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
                contentSha256,
                clientRequestId,
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
              sessionId = typeof sr.session_id === "string" ? sr.session_id : null;
              if (sessionId) {
                // Advance session directly to 'ready' since Bunny upload is complete
                await adminSupabase
                  .from("draft_media_sessions")
                  .update({ status: "ready" })
                  .eq("id", sessionId);
              } else {
                console.error(`[upload-image] session RPC returned no session_id userId=${user.id} path=${storagePath}`);
              }
            } else {
              console.error(`[upload-image] session RPC failed userId=${user.id} error=${sr?.error}`);
            }
          }
        }

        const lifecycle = await registerMediaAsset(adminSupabase, {
          provider: PROVIDERS.BUNNY_STORAGE,
          mediaFamily: MEDIA_FAMILIES.PROFILE_PHOTO,
          ownerUserId: user.id,
          providerPath: storagePath,
          mimeType: sniffedMedia.mimeType,
          bytes: file.size,
          contentSha256,
          legacyTable: sessionId ? "draft_media_sessions" : "profiles",
          legacyId: sessionId ?? `${user.id}:draft:${storagePath}`,
          status: "uploaded",
        });

        if (!lifecycle.success) {
          lifecycleErrorMessage = lifecycle.error ?? "asset_register_failed";
          console.error(`[upload-image] media asset registration failed userId=${user.id} path=${storagePath} err=${lifecycle.error}`);
        } else {
          assetId = lifecycle.assetId ?? null;
        }
      } catch (e) {
        lifecycleErrorMessage = e instanceof Error ? e.message : "asset_register_exception";
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
          contentSha256,
          legacyTable: "matches",
          legacyId: matchId,
          status: "uploaded",
        });

        if (!lifecycle.success) {
          lifecycleErrorMessage = lifecycle.error ?? "asset_register_failed";
          console.error(
            `[upload-image] chat media asset registration failed userId=${user.id} matchId=${matchId} path=${storagePath} err=${lifecycle.error}`,
          );
        } else {
          assetId = lifecycle.assetId ?? null;
        }
      } catch (e) {
        lifecycleErrorMessage = e instanceof Error ? e.message : "asset_register_exception";
        console.error("[upload-image] chat lifecycle tracking error:", e);
      }
    }

    if (lifecycleErrorMessage) {
      if (receiptId) {
        await adminSupabase
          .from("media_upload_receipts")
          .update({ status: "failed", last_error: lifecycleErrorMessage })
          .eq("id", receiptId);
      }
      return json({ success: false, error: "Upload lifecycle registration failed" });
    }

    if (receiptId) {
      const receiptMetadata = {
        ...baseReceiptMetadata,
        ...(sessionId ? { session_id: sessionId } : {}),
      };
      const { error: receiptUpdateError } = await adminSupabase
        .from("media_upload_receipts")
        .update({
          status: "uploaded",
          asset_id: assetId,
          provider_path: storagePath,
          metadata: receiptMetadata,
          last_error: null,
        })
        .eq("id", receiptId);

      if (receiptUpdateError) {
        console.error(`[upload-image] receipt completion failed userId=${user.id} path=${storagePath} err=${receiptUpdateError.message}`);
        return json({ success: false, error: "Upload receipt completion failed" });
      }
    }

    return json({ success: true, path: storagePath, sessionId });

  } catch (err) {
    console.error("[upload-image] Unexpected error:", safeUnexpectedError(err));
    return json({ success: false, error: "Upload failed" });
  }
});
