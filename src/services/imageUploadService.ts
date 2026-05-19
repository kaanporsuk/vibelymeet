const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type UploadImageContext = "onboarding" | "profile_studio" | "chat";

export type UploadImageToBunnyResult = {
  path: string;
  sessionId: string | null;
};

const uploadClientRequestIds = new WeakMap<File, Map<string, string>>();

export function newUploadClientRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    return (ch === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
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

  let data: { success?: boolean; path?: string; sessionId?: string | null; error?: string };
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
  };
}
