const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function uploadEventCoverToBunny(
  file: File,
  accessToken: string,
  eventId?: string
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  if (eventId) {
    formData.append("event_id", eventId);
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-event-cover`,
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
    throw new Error(data.error || "Event cover upload failed");
  }

  return data.url;
}
