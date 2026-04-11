const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type UploadImageContext = "onboarding" | "profile_studio";

export async function uploadImageToBunny(
  file: File,
  accessToken: string,
  context?: UploadImageContext,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  if (context) {
    formData.append("context", context);
  }

  let data: { success?: boolean; path?: string; error?: string };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/upload-image`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
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

  console.error("[uploadImageToBunny] Response:", JSON.stringify(data));

  if (!data.success) {
    throw new Error(data.error || "Image upload failed");
  }

  if (!data.path) {
    throw new Error("Image upload failed");
  }

  return data.path; // Returns "photos/{userId}/{timestamp}.jpg"
}
