const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function uploadChatVideoToBunny(
  videoBlob: Blob,
  accessToken: string,
  matchId: string
): Promise<string> {
  const formData = new FormData();
  const mimeType = videoBlob.type || "video/webm";
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  formData.append("file", videoBlob, `chat-video.${ext}`);
  formData.append("match_id", matchId);

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-chat-video`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    }
  );

  let data: { success?: boolean; url?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error("Upload service unavailable. Please try again.");
  }

  if (!data.success) {
    throw new Error(data.error || "Video upload failed");
  }

  if (!data.url) {
    throw new Error("Video upload failed");
  }

  return data.url;
}
