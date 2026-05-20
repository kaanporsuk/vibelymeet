import { supabase } from "@/integrations/supabase/client";
import { clientRequestIdForUploadFile } from "@/services/imageUploadService";
import { uploadImageWithMediaSdk } from "@/lib/mediaSdk/webStorageUploads";

/**
 * Check if a URL is a blob URL (local) vs a storage URL
 */
export const isBlobUrl = (url: string): boolean => {
  return url.startsWith("blob:");
};

/**
 * Convert local blob URLs to storage URLs by uploading files via Bunny CDN
 */
export const persistPhotos = async (
  photos: string[],
  files: (File | null)[],
  userId: string,
): Promise<string[]> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const persistedUrls: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const file = files[i];

    if (isBlobUrl(photo) && file) {
      // Upload via Bunny edge function
      try {
        const clientRequestId = clientRequestIdForUploadFile(file, `profile-studio:${userId}:${i}`);
        const { path: newPath } = await uploadImageWithMediaSdk({
          file,
          accessToken: session.access_token,
          context: "profile_studio",
          clientRequestId,
        });
        persistedUrls.push(newPath);
      } catch (err) {
        console.error("[persistPhotos] Upload failed for slot", i, ":", err);
        throw err;
      }
    } else if (!isBlobUrl(photo)) {
      // Already a storage path or URL, keep it
      persistedUrls.push(photo);
    }
  }

  return persistedUrls;
};
