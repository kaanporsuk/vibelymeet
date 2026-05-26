import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  authenticateAdminRequest,
} from "../_shared/adminAuth.ts";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";
import {
  MEDIA_FAMILIES,
  PROVIDERS,
  REF_TYPES,
} from "../_shared/media-lifecycle.ts";
import { captureReceiptTransition } from "../_shared/media-upload-telemetry.ts";
import { validateImageUploadBytes } from "../_shared/media-upload-sniffing.ts";
import {
  createImagePlaceholderMetadata,
  mediaPlaceholderResponse,
  readImagePlaceholderMetadata,
  type MediaPlaceholderMetadata,
} from "../_shared/media-placeholders.ts";

const UPLOAD_EVENT_COVER_ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-client-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req, { allowedHeaders: UPLOAD_EVENT_COVER_ALLOWED_HEADERS }),
      "Content-Type": "application/json",
    },
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

function expectedCurrentCoverAssetId(formData: FormData): { provided: boolean; value: string | null } {
  const raw = optionalFormString(formData, "expected_current_cover_asset_id");
  if (!raw) return { provided: false, value: null };
  if (raw === "__none__") return { provided: true, value: null };
  return { provided: true, value: raw };
}

type CurrentEventCover = {
  assetId: string | null;
  referenceId: string | null;
};
type AdminSupabaseClient = SupabaseClient<any, "public", any>;

async function updateMediaAssetPlaceholder(
  adminSupabase: AdminSupabaseClient,
  assetId: string | null,
  placeholder: MediaPlaceholderMetadata | null,
): Promise<void> {
  if (!assetId || !placeholder) return;
  const { error } = await adminSupabase
    .from("media_assets")
    .update({
      placeholder_kind: placeholder.placeholder_kind,
      placeholder_hash: placeholder.placeholder_hash,
      dominant_color: placeholder.dominant_color,
      placeholder_updated_at: new Date().toISOString(),
    })
    .eq("id", assetId);
  if (error) {
    console.error(`[upload-event-cover] media asset placeholder update failed assetId=${assetId} err=${error.message}`);
  }
}

type ReplaceEventCoverResult =
  | { success: true; referenceId: string | null; releasedRefs: number }
  | { success: false; error: string; code?: string | null; currentCoverAssetId?: string | null };

function parseReplaceEventCoverResult(data: unknown): ReplaceEventCoverResult {
  const result = isRecord(data) ? data : {};
  if (result.success === true) {
    return {
      success: true,
      referenceId: typeof result.reference_id === "string" ? result.reference_id : null,
      releasedRefs: typeof result.released_refs === "number" ? result.released_refs : 0,
    };
  }
  return {
    success: false,
    error: typeof result.error === "string" ? result.error : "event_cover_reference_replace_failed",
    code: typeof result.code === "string" ? result.code : null,
    currentCoverAssetId: typeof result.current_cover_asset_id === "string" ? result.current_cover_asset_id : null,
  };
}

async function fetchCurrentEventCover(
  adminSupabase: AdminSupabaseClient,
  eventId: string,
): Promise<CurrentEventCover> {
  const { data, error } = await adminSupabase
    .from("media_references")
    .select("asset_id, created_at, id")
    .eq("ref_type", REF_TYPES.EVENT_COVER)
    .eq("ref_table", "events")
    .eq("ref_id", eventId)
    .eq("ref_key", "cover_image")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[upload-event-cover] current cover lookup failed eventId=${eventId} err=${error.message}`);
    throw new Error("current_cover_lookup_failed");
  }
  return {
    assetId: typeof data?.asset_id === "string" ? data.asset_id : null,
    referenceId: typeof data?.id === "string" ? data.id : null,
  };
}

function staleCoverResponse(req: Request, currentCover: CurrentEventCover): Response {
  return json(
    req,
    {
      success: false,
      error: "stale_cover_update",
      code: "stale_cover_update",
      currentCoverAssetId: currentCover.assetId,
    },
    409,
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req, { allowedHeaders: UPLOAD_EVENT_COVER_ALLOWED_HEADERS });
  }
  if (isBrowserOriginRejected(req)) {
    return json(req, { success: false, error: "origin_not_allowed" }, 403);
  }
  if (req.method !== "POST") {
    return json(req, { success: false, error: "method_not_allowed" }, 405);
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) return auth.response;
    const { user, adminClient: adminSupabase } = auth.context;

    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = isUploadFile(fileValue) ? fileValue : null;
    const eventId = optionalFormString(formData, "event_id");
    const staleCoverExpectation = eventId
      ? expectedCurrentCoverAssetId(formData)
      : { provided: false, value: null };

    if (!file) {
      return json(req, { success: false, error: "No file provided" });
    }

    if (file.size <= 0) {
      return json(req, { success: false, error: "Empty image file." });
    }

    if (file.size > 20 * 1024 * 1024) {
      return json(req, { success: false, error: "File too large. Maximum 20MB." });
    }

    const clientRequest = clientRequestIdForUpload(req, formData);
    if (!clientRequest.ok) {
      return json(req, { success: false, error: clientRequest.error }, 400);
    }

    if (eventId) {
      const { data: eventRow, error: eventError } = await adminSupabase
        .from("events")
        .select("id")
        .eq("id", eventId)
        .maybeSingle();

      if (eventError) {
        console.error(`[upload-event-cover] event lookup failed eventId=${eventId} err=${eventError.message}`);
        return json(req, { success: false, error: "Event lookup failed" });
      }
      if (!eventRow) {
        return json(req, { success: false, error: "Event not found" });
      }

      if (!staleCoverExpectation.provided) {
        return json(req, { success: false, error: "expected_current_cover_asset_id_required" }, 400);
      }
    }

    const fileBuffer = await file.arrayBuffer();
    const mediaValidation = validateImageUploadBytes(fileBuffer, file.type);
    if (!mediaValidation.ok) {
      return json(req, { success: false, error: "Invalid file type. Use JPEG, PNG, WebP, HEIC, or HEIF." });
    }

    const sniffedMedia = mediaValidation.media;
    const contentSha256 = await sha256Hex(fileBuffer);
    const clientPlaceholderMetadata = readImagePlaceholderMetadata(formData);
    const serverPlaceholderMetadata = await createImagePlaceholderMetadata(fileBuffer);
    const placeholderMetadata = serverPlaceholderMetadata ?? clientPlaceholderMetadata;
    const clientRequestId = clientRequest.clientRequestId;
    const mediaFamily = MEDIA_FAMILIES.EVENT_COVER;
    const scopeKey = eventId ? `event:${eventId}` : `admin:${user.id}:event-cover`;
    const requestPathToken = await stableUploadToken([
      user.id,
      mediaFamily,
      scopeKey,
      clientRequestId,
      contentSha256,
    ]);
    const folder = eventId ? `events/${eventId}` : "events/covers";
    const storagePath = `${folder}/req-${requestPathToken}.${sniffedMedia.extension}`;
    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const baseReceiptMetadata: Record<string, unknown> = {
      context: "event_cover",
      storage_zone: storageZone,
      mime_type: sniffedMedia.mimeType,
      bytes: file.size,
      ...(placeholderMetadata ? { placeholder: placeholderMetadata } : {}),
      ...(eventId ? { event_id: eventId } : {}),
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
      console.error(
        `[upload-event-cover] reserve_media_upload failed userId=${user.id} eventId=${eventId ?? "none"} path=${storagePath} err=${reserveError.message}`,
      );
      return json(req, { success: false, error: "Upload reservation failed" });
    }

    const reserve = reserveData as Record<string, unknown> | null;
    if (!reserve?.success) {
      const error = typeof reserve?.error === "string" ? reserve.error : "Upload reservation failed";
      const code = typeof reserve?.code === "string" ? reserve.code : null;
      return json(req, { success: false, error, code: code ?? undefined }, code?.includes("conflict") ? 409 : 200);
    }

    const receiptId = typeof reserve.receipt_id === "string" ? reserve.receipt_id : null;
    const reservedStatus = typeof reserve.status === "string" ? reserve.status : "reserved";
    const reservedPath = typeof reserve.provider_path === "string" ? reserve.provider_path : storagePath;
    const uploadPath = reservedPath;
    const reservedAssetId = typeof reserve.asset_id === "string" ? reserve.asset_id : null;
    const reserveMetadata = isRecord(reserve.metadata) ? reserve.metadata : {};
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
      source: "upload-event-cover.reserve",
    });

    let currentCover: CurrentEventCover | null = null;
    const getCurrentCover = async () => {
      if (!eventId) return { assetId: null, referenceId: null };
      currentCover ??= await fetchCurrentEventCover(adminSupabase, eventId);
      return currentCover;
    };

    if ((reservedStatus === "uploaded" || reservedStatus === "attached") && reservedPath) {
      if (!eventId) {
        await updateMediaAssetPlaceholder(adminSupabase, reservedAssetId, placeholderMetadata);
        return json(req, {
          success: true,
          path: reservedPath,
          url: bunnyCdnUrl(reservedPath),
          assetId: reservedAssetId,
          contentSha256,
          receiptId,
          sessionId: null,
          placeholder: mediaPlaceholderResponse(placeholderMetadata),
          referenceId: typeof reserveMetadata.reference_id === "string" ? reserveMetadata.reference_id : null,
        });
      }

      if (!reservedAssetId) {
        return json(req, { success: false, error: "Upload lifecycle registration failed" });
      }

      const current = await getCurrentCover();
      const reservedAssetIsCurrent = current.assetId === reservedAssetId;
      if (current.assetId !== staleCoverExpectation.value && !reservedAssetIsCurrent) {
        return staleCoverResponse(req, current);
      }

      if (reservedStatus === "attached") {
        if (reservedAssetIsCurrent) {
          await updateMediaAssetPlaceholder(adminSupabase, reservedAssetId, placeholderMetadata);
          return json(req, {
            success: true,
            path: reservedPath,
            url: bunnyCdnUrl(reservedPath),
            assetId: reservedAssetId,
            contentSha256,
            receiptId,
            sessionId: null,
            placeholder: mediaPlaceholderResponse(placeholderMetadata),
            referenceId: typeof reserveMetadata.reference_id === "string" ? reserveMetadata.reference_id : current.referenceId,
          });
        }

        return staleCoverResponse(req, current);
      }

      if (reservedStatus === "uploaded" && reservedAssetIsCurrent) {
        if (receiptId) {
          const { data: repairData, error: receiptRepairError } = await adminSupabase.rpc(
            "complete_storage_media_upload",
            {
              p_receipt_id: receiptId,
              p_owner_user_id: user.id,
              p_media_family: mediaFamily,
              p_provider: PROVIDERS.BUNNY_STORAGE,
              p_provider_path: reservedPath,
              p_provider_object_id: null,
              p_mime_type: sniffedMedia.mimeType,
              p_bytes: file.size,
              p_content_sha256: contentSha256,
              p_legacy_table: "events",
              p_legacy_id: eventId,
              p_receipt_status: "attached",
              p_metadata: {
                ...reserveMetadata,
                uploaded_at: typeof reserveMetadata.uploaded_at === "string"
                  ? reserveMetadata.uploaded_at
                  : new Date().toISOString(),
              },
              p_reference_id: current.referenceId,
              p_last_error: null,
            },
          );
          const repair = isRecord(repairData) ? repairData : {};
          if (receiptRepairError || repair.success !== true) {
            console.error(
              `[upload-event-cover] receipt attached repair failed path=${reservedPath} err=${receiptRepairError?.message ?? repair.error}`,
            );
          } else {
            void captureReceiptTransition({
              ownerUserId: user.id,
              mediaFamily,
              clientRequestId,
              receiptId,
              assetId: reservedAssetId,
              provider: PROVIDERS.BUNNY_STORAGE,
              providerPath: reservedPath,
              statusFrom: typeof repair.status_from === "string" ? repair.status_from : reservedStatus,
              statusTo: typeof repair.status_to === "string" ? repair.status_to : "attached",
              contentSha256,
              source: "upload-event-cover.attached_repair",
            });
          }
        }

        await updateMediaAssetPlaceholder(adminSupabase, reservedAssetId, placeholderMetadata);
        return json(req, {
          success: true,
          path: reservedPath,
          url: bunnyCdnUrl(reservedPath),
          assetId: reservedAssetId,
          contentSha256,
          receiptId,
          sessionId: null,
          placeholder: mediaPlaceholderResponse(placeholderMetadata),
          referenceId: current.referenceId,
        });
      }
    }

    if (eventId) {
      const current = await getCurrentCover();
      const reservedAssetIsCurrent = !!reservedAssetId && current.assetId === reservedAssetId;
      if (current.assetId !== staleCoverExpectation.value && !reservedAssetIsCurrent) {
        return staleCoverResponse(req, current);
      }
    }

    let assetId = reservedStatus === "uploaded" && eventId ? reservedAssetId : null;
    if (!assetId) {
      const uploadRes = await fetch(
        `https://storage.bunnycdn.com/${storageZone}/${uploadPath}`,
        {
          method: "PUT",
          headers: {
            "AccessKey": apiKey,
            "Content-Type": sniffedMedia.mimeType,
            "Checksum": contentSha256.toUpperCase(),
          },
          body: fileBuffer,
        },
      );

      if (!uploadRes.ok) {
        console.error("[upload-event-cover] Bunny upload failed:", await providerErrorMeta(uploadRes));
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
            source: "upload-event-cover.provider_failed",
          });
        }
        return json(req, { success: false, error: "Upload to CDN failed" });
      }

      if (receiptId) {
        const { data: completionData, error: completionError } = await adminSupabase.rpc(
          "complete_storage_media_upload",
          {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_media_family: mediaFamily,
            p_provider: PROVIDERS.BUNNY_STORAGE,
            p_provider_path: uploadPath,
            p_provider_object_id: null,
            p_mime_type: sniffedMedia.mimeType,
            p_bytes: file.size,
            p_content_sha256: contentSha256,
            p_legacy_table: "events",
            p_legacy_id: eventId ?? null,
            p_receipt_status: "uploaded",
            p_metadata: {
              ...baseReceiptMetadata,
              uploaded_at: new Date().toISOString(),
            },
            p_reference_id: null,
            p_last_error: null,
          },
        );
        const completion = isRecord(completionData) ? completionData : {};
        if (completionError || completion.success !== true) {
          const lastError = completionError?.message ||
            (typeof completion.error === "string" ? completion.error : "asset_register_failed");
          console.error(`[upload-event-cover] media asset registration failed path=${uploadPath} err=${lastError}`);
          const { data: failedData } = await adminSupabase.rpc("mark_media_upload_receipt_failed", {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_last_error: lastError,
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
            source: "upload-event-cover.lifecycle_failed",
          });
          return json(req, { success: false, error: "Upload lifecycle registration failed" });
        }

        assetId = typeof completion.asset_id === "string" ? completion.asset_id : null;
        await updateMediaAssetPlaceholder(adminSupabase, assetId, placeholderMetadata);
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
          source: "upload-event-cover.uploaded",
        });
      }

      if (!assetId) {
        const lastError = "asset_register_failed";
        console.error(`[upload-event-cover] media asset registration failed path=${uploadPath} err=${lastError}`);
        if (receiptId) {
          await adminSupabase.rpc("mark_media_upload_receipt_failed", {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_last_error: lastError,
            p_metadata: { completion_failed_at: new Date().toISOString() },
          });
        }
        return json(req, { success: false, error: "Upload lifecycle registration failed" });
      }
    }

    let referenceId: string | null = null;
    let receiptStatus: "uploaded" | "attached" = "uploaded";
    if (eventId) {
      const { data: replaceData, error: replaceError } = await adminSupabase.rpc("replace_event_cover_media_reference", {
        p_event_id: eventId,
        p_asset_id: assetId,
        p_expected_current_asset_id: staleCoverExpectation.value,
      });

      if (replaceError) {
        console.error(
          `[upload-event-cover] media reference replace failed assetId=${assetId} eventId=${eventId} err=${replaceError.message}`,
        );
        if (receiptId) {
          await adminSupabase.rpc("complete_storage_media_upload", {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_media_family: mediaFamily,
            p_provider: PROVIDERS.BUNNY_STORAGE,
            p_provider_path: uploadPath,
            p_provider_object_id: null,
            p_mime_type: sniffedMedia.mimeType,
            p_bytes: file.size,
            p_content_sha256: contentSha256,
            p_legacy_table: "events",
            p_legacy_id: eventId,
            p_receipt_status: "uploaded",
            p_metadata: { ...baseReceiptMetadata, uploaded_at: new Date().toISOString() },
            p_reference_id: null,
            p_last_error: replaceError.message,
          });
        }
        return json(req, { success: false, error: "Upload lifecycle registration failed" });
      }

      const refResult = parseReplaceEventCoverResult(replaceData);
      if (!refResult.success) {
        if (receiptId) {
          await adminSupabase.rpc("complete_storage_media_upload", {
            p_receipt_id: receiptId,
            p_owner_user_id: user.id,
            p_media_family: mediaFamily,
            p_provider: PROVIDERS.BUNNY_STORAGE,
            p_provider_path: uploadPath,
            p_provider_object_id: null,
            p_mime_type: sniffedMedia.mimeType,
            p_bytes: file.size,
            p_content_sha256: contentSha256,
            p_legacy_table: "events",
            p_legacy_id: eventId,
            p_receipt_status: "uploaded",
            p_metadata: { ...baseReceiptMetadata, uploaded_at: new Date().toISOString() },
            p_reference_id: null,
            p_last_error: refResult.error,
          });
        }
        return json(
          req,
          {
            success: false,
            error: refResult.error,
            code: refResult.code ?? undefined,
            currentCoverAssetId: refResult.currentCoverAssetId ?? undefined,
          },
          refResult.code === "stale_cover_update" ? 409 : 200,
        );
      }

      referenceId = refResult.referenceId;
      receiptStatus = "attached";
    }

    if (receiptId) {
      const { data: completionData, error: receiptUpdateError } = await adminSupabase.rpc(
        "complete_storage_media_upload",
        {
          p_receipt_id: receiptId,
          p_owner_user_id: user.id,
          p_media_family: mediaFamily,
          p_provider: PROVIDERS.BUNNY_STORAGE,
          p_provider_path: uploadPath,
          p_provider_object_id: null,
          p_mime_type: sniffedMedia.mimeType,
          p_bytes: file.size,
          p_content_sha256: contentSha256,
          p_legacy_table: "events",
          p_legacy_id: eventId ?? null,
          p_receipt_status: receiptStatus,
          p_metadata: {
            ...baseReceiptMetadata,
            uploaded_at: new Date().toISOString(),
          },
          p_reference_id: referenceId,
          p_last_error: null,
        },
      );
      const completion = isRecord(completionData) ? completionData : {};
      if (receiptUpdateError || completion.success !== true) {
        console.error(
          `[upload-event-cover] receipt completion failed path=${uploadPath} err=${receiptUpdateError?.message ?? completion.error}`,
        );
        return json(req, { success: false, error: "Upload receipt completion failed" });
      }
      void captureReceiptTransition({
        ownerUserId: user.id,
        mediaFamily,
        clientRequestId,
        receiptId,
        assetId,
        provider: PROVIDERS.BUNNY_STORAGE,
        providerPath: uploadPath,
        statusFrom: typeof completion.status_from === "string" ? completion.status_from : reservedStatus,
        statusTo: typeof completion.status_to === "string" ? completion.status_to : receiptStatus,
        contentSha256,
        source: "upload-event-cover.completed",
      });
    }

    await updateMediaAssetPlaceholder(adminSupabase, assetId, placeholderMetadata);

    return json(req, {
      success: true,
      path: uploadPath,
      url: bunnyCdnUrl(uploadPath),
      assetId,
      contentSha256,
      referenceId,
      receiptId,
      sessionId: null,
      placeholder: mediaPlaceholderResponse(placeholderMetadata),
    });
  } catch (err) {
    console.error("[upload-event-cover] Unexpected error:", safeUnexpectedError(err));
    return json(req, { success: false, error: "Upload failed" }, 500);
  }
});
