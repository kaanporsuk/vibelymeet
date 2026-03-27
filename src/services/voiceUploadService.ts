const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function uploadVoiceToBunny(
  blob: Blob,
  accessToken: string,
  conversationId?: string
): Promise<string> {
  const formData = new FormData();

  // Determine correct MIME type
  const mimeType = blob.type || "audio/webm";
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a")
    ? "m4a"
    : mimeType.includes("ogg")
    ? "ogg"
    : "webm";

  formData.append("file", blob, `voice.${ext}`);
  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-voice`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    }
  );

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("Upload service unavailable. Please try again.");
  }

  if (!data.success) {
    throw new Error(data.error || "Voice upload failed");
  }

  // Return the full CDN URL — pass to send-message (message_kind: voice), not client messages.insert
  return data.url;
}
