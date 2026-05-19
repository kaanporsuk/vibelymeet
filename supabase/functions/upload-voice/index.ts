import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { bunnyCdnUrl } from "../_shared/bunny-media.ts";
import { MEDIA_FAMILIES, PROVIDERS, registerMediaAsset } from "../_shared/media-lifecycle.ts";
import { validateVoiceUploadBytes } from "../_shared/media-upload-sniffing.ts";

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
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ success: false, error: "Unauthorized" });
    }

    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = isUploadFile(fileValue) ? fileValue : null;
    const conversationId = optionalFormString(formData, "conversation_id");

    if (!file) {
      return json({ success: false, error: "No file provided" });
    }

    if (file.size <= 0) {
      return json({ success: false, error: "Empty audio file." });
    }

    if (file.size > 10 * 1024 * 1024) {
      return json({ success: false, error: "File too large. Maximum 10MB." });
    }

    if (!conversationId) {
      return json({ success: false, error: "conversation_id is required" });
    }

    const clientRequest = clientRequestIdForUpload(req, formData);
    if (!clientRequest.ok) {
      return json({ success: false, error: clientRequest.error }, 400);
    }

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: match, error: matchError } = await adminSupabase
      .from("matches")
      .select("id, profile_id_1, profile_id_2")
      .eq("id", conversationId)
      .maybeSingle();

    if (matchError || !match || (match.profile_id_1 !== user.id && match.profile_id_2 !== user.id)) {
      return json({ success: false, error: "Forbidden" });
    }

    const fileBuffer = await file.arrayBuffer();
    const mediaValidation = validateVoiceUploadBytes(fileBuffer, file.type);
    if (!mediaValidation.ok) {
      return json({ success: false, error: "Invalid file type. Audio files only." });
    }

    const sniffedMedia = mediaValidation.media;
    const contentSha256 = await sha256Hex(fileBuffer);
    const clientRequestId = clientRequest.clientRequestId;
    const mediaFamily = MEDIA_FAMILIES.VOICE_MESSAGE;
    const scopeKey = `match:${conversationId}`;
    const requestPathToken = await stableUploadToken([
      user.id,
      mediaFamily,
      scopeKey,
      clientRequestId,
      contentSha256,
    ]);
    const storagePath = `voice/${conversationId}/req-${requestPathToken}.${sniffedMedia.extension}`;
    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
    const baseReceiptMetadata: Record<string, unknown> = {
      match_id: conversationId,
      storage_zone: storageZone,
      mime_type: sniffedMedia.mimeType,
      bytes: file.size,
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
        `[upload-voice] reserve_media_upload failed userId=${user.id} matchId=${conversationId} path=${storagePath} err=${reserveError.message}`,
      );
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
        url: bunnyCdnUrl(reservedPath),
        assetId: typeof reserve.asset_id === "string" ? reserve.asset_id : null,
        receiptId,
        uploadedAt: typeof reserveMetadata.uploaded_at === "string" ? reserveMetadata.uploaded_at : null,
      });
    }

    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
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
      console.error("[upload-voice] Bunny upload failed:", await providerErrorMeta(uploadRes));
      if (receiptId) {
        await adminSupabase
          .from("media_upload_receipts")
          .update({ status: "failed", last_error: `provider_upload_failed:${uploadRes.status}` })
          .eq("id", receiptId);
      }
      return json({ success: false, error: "Upload to CDN failed" });
    }

    const audioUrl = bunnyCdnUrl(storagePath);
    const lifecycle = await registerMediaAsset(adminSupabase, {
      provider: PROVIDERS.BUNNY_STORAGE,
      mediaFamily,
      ownerUserId: user.id,
      providerPath: storagePath,
      mimeType: sniffedMedia.mimeType,
      bytes: file.size,
      contentSha256,
      legacyTable: "matches",
      legacyId: conversationId,
      status: "uploaded",
    });

    if (!lifecycle.success) {
      const lastError = lifecycle.error ?? "asset_register_failed";
      console.error(
        `[upload-voice] voice asset registration failed userId=${user.id} matchId=${conversationId} path=${storagePath} err=${lastError}`,
      );
      if (receiptId) {
        await adminSupabase
          .from("media_upload_receipts")
          .update({ status: "failed", last_error: lastError })
          .eq("id", receiptId);
      }
      return json({ success: false, error: "Upload lifecycle registration failed" });
    }

    if (receiptId) {
      const { error: receiptUpdateError } = await adminSupabase
        .from("media_upload_receipts")
        .update({
          status: "uploaded",
          asset_id: lifecycle.assetId ?? null,
          provider_path: storagePath,
          metadata: {
            ...baseReceiptMetadata,
            uploaded_at: new Date().toISOString(),
          },
          last_error: null,
        })
        .eq("id", receiptId);

      if (receiptUpdateError) {
        console.error(
          `[upload-voice] receipt completion failed userId=${user.id} matchId=${conversationId} path=${storagePath} err=${receiptUpdateError.message}`,
        );
        return json({ success: false, error: "Upload receipt completion failed" });
      }
    }

    return json({
      success: true,
      path: storagePath,
      url: audioUrl,
      assetId: lifecycle.assetId ?? null,
      receiptId,
    });
  } catch (err) {
    console.error("[upload-voice] Unexpected error:", safeUnexpectedError(err));
    return json({ success: false, error: "Upload failed" });
  }
});
