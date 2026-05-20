import { createMediaClientRequestId } from "@clientShared/media-sdk";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type UploadImageContext = "onboarding" | "profile_studio" | "chat";

export type UploadImageToBunnyResult = {
  path: string;
  sessionId: string | null;
  url?: string | null;
  assetId?: string | null;
  contentSha256?: string | null;
  receiptId?: string | null;
};

const uploadClientRequestIds = new WeakMap<File, Map<string, string>>();

export function newUploadClientRequestId(): string {
  return createMediaClientRequestId();
}

export function clientRequestIdForUploadFile(file: File, scope: string): string {
  let scopedIds = uploadClientRequestIds.get(file);
  if (!scopedIds) {
    scopedIds = new Map();
    uploadClientRequestIds.set(file, scopedIds);
  }

  const stableScope = scope.trim() || "default";
  const existing = scopedIds.get(stableScope);
  if (existing) return existing;

  const next = newUploadClientRequestId();
  scopedIds.set(stableScope, next);
  return next;
}

/**
 * @deprecated Use uploadImageWithMediaSdk so durable queueing, reconciliation,
 * and receipt telemetry remain active. This remains as the SDK delegate.
 */
export async function uploadImageToBunny(
  file: File,
  accessToken: string,
  context?: UploadImageContext,
  matchId?: string,
  clientRequestId?: string,
): Promise<UploadImageToBunnyResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (context) {
    formData.append("context", context);
  }
  if (context === "chat" && matchId) {
    formData.append("match_id", matchId);
  }
  const stableClientRequestId = clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append("client_request_id", stableClientRequestId);
  }

  let data: {
    success?: boolean;
    path?: string;
    url?: string | null;
    assetId?: string | null;
    contentSha256?: string | null;
    receiptId?: string | null;
    sessionId?: string | null;
    error?: string;
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/upload-image`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(stableClientRequestId ? { "x-client-request-id": stableClientRequestId } : {}),
          // Note: do NOT set Content-Type here — browser sets it with boundary for FormData
        },
        body: formData,
      }
    );

    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[uploadImageToBunny] Non-JSON response:", text.slice(0, 200));
      throw new Error("Upload service unavailable. Please try again.");
    }
  } catch (fetchErr) {
    if (fetchErr instanceof Error && fetchErr.message.includes("unavailable")) throw fetchErr;
    throw new Error("Network error during upload. Check your connection.");
  }

  if (!data.success) {
    throw new Error(data.error || "Image upload failed");
  }

  if (!data.path) {
    throw new Error("Image upload failed");
  }

  return {
    path: data.path,
    sessionId: data.sessionId ?? null,
    url: data.url ?? null,
    assetId: data.assetId ?? null,
    contentSha256: data.contentSha256 ?? null,
    receiptId: data.receiptId ?? null,
  };
}
