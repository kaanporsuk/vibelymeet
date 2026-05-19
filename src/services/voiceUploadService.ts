const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type UploadVoiceResponse = {
  success?: boolean;
  error?: string;
  path?: string;
  url?: string;
  assetId?: string | null;
};

export async function uploadVoiceToBunny(
  blob: Blob,
  accessToken: string,
  conversationId: string,
  clientRequestId?: string,
): Promise<string> {
  const formData = new FormData();

  // Determine correct MIME type
  const mimeType = blob.type || "application/octet-stream";
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a")
    ? "m4a"
    : mimeType.includes("aac")
    ? "aac"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
    ? "mp3"
    : mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("webm")
    ? "webm"
    : "bin";

  formData.append("file", blob, `voice.${ext}`);
  formData.append("conversation_id", conversationId);
  const stableClientRequestId = clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append("client_request_id", stableClientRequestId);
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-voice`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(stableClientRequestId ? { "x-client-request-id": stableClientRequestId } : {}),
      },
      body: formData,
    }
  );

  let data: UploadVoiceResponse;
  try {
    data = await res.json() as UploadVoiceResponse;
  } catch {
    throw new Error("Upload service unavailable. Please try again.");
  }

  if (!data.success) {
    throw new Error(data.error || "Voice upload failed");
  }

  const mediaRef = data.path || data.url;
  if (!mediaRef) {
    throw new Error("Voice upload failed");
  }

  return mediaRef;
}
