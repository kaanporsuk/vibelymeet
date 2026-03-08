const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function uploadImageToBunny(
  file: File,
  accessToken: string,
  oldPath?: string | null
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  if (oldPath) {
    formData.append("old_path", oldPath);
  }

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

  const data = await res.json();

  if (!data.success) {
    throw new Error(data.error || "Image upload failed");
  }

  return data.path; // Returns "photos/{userId}/{timestamp}.jpg"
}
