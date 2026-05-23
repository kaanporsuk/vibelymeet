import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import { MEDIA_FAMILIES, PROVIDERS } from "../_shared/media-lifecycle.ts";
import { captureReceiptTransition } from "../_shared/media-upload-telemetry.ts";
import { validateImageUploadBytes } from "../_shared/media-upload-sniffing.ts";
import {
  createImagePlaceholderMetadata,
  mediaPlaceholderResponse,
  readImagePlaceholderMetadata,
  type MediaPlaceholderMetadata,
} from "../_shared/media-placeholders.ts";

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
  // 128-bit deterministic token keeps new Bunny object paths collision-resistant;
  // media_upload_receipts remains the canonical idempotency authority.
  return hexFromBytes(new Uint8Array(digest)).slice(0, 32);
}

function optionalFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type ImageDerivativeKind = "thumb" | "hero";
type ImageDerivativeUpload = {
  kind: ImageDerivativeKind;
  buffer: ArrayBuffer;
  mimeType: string;
  extension: string;
  path: string;
};
type MediaAssetPresentationClient = {
  from(table: "media_assets"): {
    update(values: Record<string, unknown>): {
      eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

async function readDerivativeFile(formData: FormData, key: string, kind: ImageDerivativeKind) {
  const value = formData.get(key);
  if (!isUploadFile(value) || value.size <= 0 || value.size > 2 * 1024 * 1024) return null;
  const buffer = await value.arrayBuffer();
  const validation = validateImageUploadBytes(buffer, value.type);
  if (!validation.ok) return null;
  return {
    kind,
    buffer,
    mimeType: validation.media.mimeType,
    extension: validation.media.extension,
  };
}

async function readDerivativeSet(formData: FormData) {
  const [thumb, hero] = await Promise.all([
    readDerivativeFile(formData, "derivative_thumb", "thumb"),
    readDerivativeFile(formData, "derivative_hero", "hero"),
  ]);
  return thumb && hero ? { thumb, hero } : null;
}

function derivativePathForOriginal(originalPath: string, kind: ImageDerivativeKind, extension: string): string {
  if (/@orig\.[a-z0-9]+$/i.test(originalPath)) {
    return originalPath.replace(/@orig\.[a-z0-9]+$/i, `@${kind}.${extension}`);
  }
  return originalPath.replace(/\.([a-z0-9]+)$/i, `@${kind}.${extension}`);
}

async function updateMediaAssetPresentation(
  adminSupabase: MediaAssetPresentationClient,
  assetId: string | null,
  params: {
    derivatives?: Record<string, string>;
    placeholder?: MediaPlaceholderMetadata | null;
  },
): Promise<void> {
  if (!assetId) return;
  const update: Record<string, unknown> = {};
  const thumb = typeof params.derivatives?.thumb === "string" && params.derivatives.thumb.trim()
    ? params.derivatives.thumb.trim()
    : null;
  const hero = typeof params.derivatives?.hero === "string" && params.derivatives.hero.trim()
    ? params.derivatives.hero.trim()
    : null;
  if (thumb) update.derivative_thumb_path = thumb;
  if (hero) update.derivative_hero_path = hero;
  if (params.placeholder) {
    update.placeholder_kind = params.placeholder.placeholder_kind;
    update.placeholder_hash = params.placeholder.placeholder_hash;
    update.dominant_color = params.placeholder.dominant_color;
    update.placeholder_updated_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await adminSupabase
    .from("media_assets")
    .update(update)
    .eq("id", assetId);
  if (error) {
    console.error(`[upload-image] media asset presentation update failed assetId=${assetId} err=${error.message}`);
  }
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
    const derivativeSet = await readDerivativeSet(formData);
    const clientPlaceholderMetadata = readImagePlaceholderMetadata(formData);
    const serverPlaceholderMetadata = await createImagePlaceholderMetadata(fileBuffer);
    const placeholderMetadata = serverPlaceholderMetadata ?? clientPlaceholderMetadata;
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
    const storagePath = context === "chat" && matchId
      ? `photos/match-${matchId}/${user.id}/req-${requestPathToken}.${ext}`
      : `photos/${user.id}/req-${requestPathToken}.${ext}`;
    const derivatives: Record<string, string> = {};
    const derivativeUploads: ImageDerivativeUpload[] = derivativeSet
      ? [
        {
          ...derivativeSet.thumb,
          path: derivativePathForOriginal(storagePath, "thumb", derivativeSet.thumb.extension),
        },
        {
          ...derivativeSet.hero,
          path: derivativePathForOriginal(storagePath, "hero", derivativeSet.hero.extension),
        },
      ]
      : [];
    const baseReceiptMetadata: Record<string, unknown> = {
      context: context ?? "legacy",
      storage_zone: storageZone,
      mime_type: sniffedMedia.mimeType,
      bytes: file.size,
      ...(placeholderMetadata ? { placeholder: placeholderMetadata } : {}),
      ...(derivativeUploads.length ? { derivative_targets: derivativeUploads.map((item) => item.kind) } : {}),
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
    const uploadPath = reservedPath;
    let reservedAssetId = typeof reserve.asset_id === "string" ? reserve.asset_id : null;
    const reserveMetadata = isRecord(reserve.metadata) ? reserve.metadata : {};
    let reservedSessionId = typeof reserveMetadata.session_id === "string" ? reserveMetadata.session_id : null;
    void captureReceiptTransition({
      ownerUserId: user.id,
      mediaFamily,
      clientRequestId,
      receiptId,
      assetId: reservedAssetId,
      provider: PROVIDERS.BUNNY_STORAGE,
      providerPath: reservedPath,
      statusTo: reservedStatus,
      contentSha256,
      source: "upload-image.reserve",
    });
    if ((reservedStatus === "uploaded" || reservedStatus === "attached") && reservedPath) {
      if (mediaFamily === MEDIA_FAMILIES.PROFILE_PHOTO && receiptId && !reservedSessionId) {
        const metadata = {
          ...baseReceiptMetadata,
          uploaded_at: new Date().toISOString(),
        };
        const { data: repairData, error: repairError } = await adminSupabase.rpc(
          "complete_profile_photo_media_upload",
          {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_context: context ?? "profile_studio",
            p_provider: PROVIDERS.BUNNY_STORAGE,
            p_provider_path: reservedPath,
            p_mime_type: sniffedMedia.mimeType,
            p_bytes: file.size,
            p_content_sha256: contentSha256,
            p_metadata: metadata,
          },
        );
        if (repairError) {
          console.error(`[upload-image] receipt/session repair failed userId=${user.id} path=${reservedPath} err=${repairError.message}`);
        } else {
          const repaired = isRecord(repairData) ? repairData : {};
          reservedSessionId = typeof repaired.session_id === "string" ? repaired.session_id : reservedSessionId;
          reservedAssetId = typeof repaired.asset_id === "string" ? repaired.asset_id : reservedAssetId;
          await updateMediaAssetPresentation(adminSupabase, reservedAssetId, {
            derivatives: isRecord(reserveMetadata.derivatives) ? reserveMetadata.derivatives as Record<string, string> : undefined,
            placeholder: placeholderMetadata,
          });
          void captureReceiptTransition({
            ownerUserId: user.id,
            mediaFamily,
            clientRequestId,
            receiptId,
            assetId: reservedAssetId,
            provider: PROVIDERS.BUNNY_STORAGE,
            providerPath: reservedPath,
            statusFrom: typeof repaired.status_from === "string" ? repaired.status_from : reservedStatus,
            statusTo: typeof repaired.status_to === "string" ? repaired.status_to : reservedStatus,
            contentSha256,
            source: "upload-image.profile_receipt_repair",
          });
        }
      }
      await updateMediaAssetPresentation(adminSupabase, reservedAssetId, {
        derivatives: isRecord(reserveMetadata.derivatives) ? reserveMetadata.derivatives as Record<string, string> : undefined,
        placeholder: placeholderMetadata,
      });
      return json({
        success: true,
        path: reservedPath,
        url: bunnyCdnUrl(reservedPath),
        assetId: reservedAssetId,
        contentSha256,
        receiptId,
        sessionId: reservedSessionId,
        placeholder: mediaPlaceholderResponse(placeholderMetadata),
        derivatives: isRecord(reserveMetadata.derivatives) ? reserveMetadata.derivatives : undefined,
      });
    }

    const uploadRes = await fetch(
      `https://${storageHostname}/${storageZone}/${uploadPath}`,
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
        const { data: failedData } = await adminSupabase.rpc("mark_media_upload_receipt_failed", {
          p_receipt_id: receiptId,
          p_owner_user_id: user.id,
          p_last_error: `provider_upload_failed:${uploadRes.status}`,
          p_metadata: { provider_status: uploadRes.status },
        });
        const failed = isRecord(failedData) ? failedData : {};
        void captureReceiptTransition({
          ownerUserId: user.id,
          mediaFamily,
          clientRequestId,
          receiptId,
          provider: PROVIDERS.BUNNY_STORAGE,
          providerPath: uploadPath,
          statusFrom: typeof failed.status_from === "string" ? failed.status_from : reservedStatus,
          statusTo: "failed",
          contentSha256,
          source: "upload-image.provider_failed",
        });
      }
      return json({ success: false, error: "Upload to CDN failed" });
    }

    for (const derivative of derivativeUploads) {
      try {
        const derivativeRes = await fetch(
          `https://${storageHostname}/${storageZone}/${derivative.path}`,
          {
            method: "PUT",
            headers: {
              "AccessKey": apiKey,
              "Content-Type": derivative.mimeType,
            },
            body: derivative.buffer,
          },
        );
        if (!derivativeRes.ok) {
          console.error("[upload-image] Bunny derivative upload failed:", await providerErrorMeta(derivativeRes));
          continue;
        }
        derivatives[derivative.kind] = derivative.path;
      } catch (error) {
        console.error("[upload-image] Bunny derivative upload error:", safeUnexpectedError(error));
      }
    }

    let sessionId: string | null = null;
    let assetId: string | null = null;
    const completionMetadata = {
      ...baseReceiptMetadata,
      ...(Object.keys(derivatives).length ? { derivatives } : {}),
      uploaded_at: new Date().toISOString(),
    };
    if (receiptId) {
      const completionCall = mediaFamily === MEDIA_FAMILIES.PROFILE_PHOTO
        ? adminSupabase.rpc("complete_profile_photo_media_upload", {
          p_receipt_id: receiptId,
          p_owner_user_id: user.id,
          p_context: context ?? "profile_studio",
          p_provider: PROVIDERS.BUNNY_STORAGE,
          p_provider_path: uploadPath,
          p_mime_type: sniffedMedia.mimeType,
          p_bytes: file.size,
          p_content_sha256: contentSha256,
          p_metadata: completionMetadata,
        })
        : adminSupabase.rpc("complete_storage_media_upload", {
          p_receipt_id: receiptId,
          p_owner_user_id: user.id,
          p_media_family: mediaFamily,
          p_provider: PROVIDERS.BUNNY_STORAGE,
          p_provider_path: uploadPath,
          p_provider_object_id: null,
          p_mime_type: sniffedMedia.mimeType,
          p_bytes: file.size,
          p_content_sha256: contentSha256,
          p_legacy_table: "matches",
          p_legacy_id: matchId,
          p_receipt_status: "uploaded",
          p_metadata: completionMetadata,
          p_reference_id: null,
          p_last_error: null,
        });

      const { data: completionData, error: completionError } = await completionCall;
      const completion = isRecord(completionData) ? completionData : {};
      if (completionError || completion.success !== true) {
        const lifecycleErrorMessage =
          completionError?.message ||
          (typeof completion.error === "string" ? completion.error : "asset_register_failed");
        console.error(`[upload-image] receipt completion failed userId=${user.id} path=${uploadPath} err=${lifecycleErrorMessage}`);
        const { data: failedData } = await adminSupabase.rpc("mark_media_upload_receipt_failed", {
          p_receipt_id: receiptId,
          p_owner_user_id: user.id,
          p_last_error: lifecycleErrorMessage,
          p_metadata: { completion_failed_at: new Date().toISOString() },
        });
        const failed = isRecord(failedData) ? failedData : {};
        void captureReceiptTransition({
          ownerUserId: user.id,
          mediaFamily,
          clientRequestId,
          receiptId,
          provider: PROVIDERS.BUNNY_STORAGE,
          providerPath: uploadPath,
          statusFrom: typeof failed.status_from === "string" ? failed.status_from : reservedStatus,
          statusTo: "failed",
          contentSha256,
          source: "upload-image.lifecycle_failed",
        });
        return json({ success: false, error: "Upload receipt completion failed" });
      }

      assetId = typeof completion.asset_id === "string" ? completion.asset_id : null;
      sessionId = typeof completion.session_id === "string" ? completion.session_id : null;
      await updateMediaAssetPresentation(adminSupabase, assetId, {
        derivatives,
        placeholder: placeholderMetadata,
      });
      void captureReceiptTransition({
        ownerUserId: user.id,
        mediaFamily,
        clientRequestId,
        receiptId,
        assetId,
        provider: PROVIDERS.BUNNY_STORAGE,
        providerPath: uploadPath,
        statusFrom: typeof completion.status_from === "string" ? completion.status_from : reservedStatus,
        statusTo: typeof completion.status_to === "string" ? completion.status_to : "uploaded",
        contentSha256,
        source: "upload-image.completed",
      });
    }

    return json({
      success: true,
      path: uploadPath,
      url: bunnyCdnUrl(uploadPath),
      assetId,
      contentSha256,
      receiptId,
      sessionId,
      placeholder: mediaPlaceholderResponse(placeholderMetadata),
      derivatives: Object.keys(derivatives).length ? derivatives : undefined,
    });

  } catch (err) {
    console.error("[upload-image] Unexpected error:", safeUnexpectedError(err));
    return json({ success: false, error: "Upload failed" });
  }
});
