import { supabase } from "@/integrations/supabase/client";
import { uploadImageToBunny } from "@/services/imageUploadService";

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
  userId: string
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
        const { path: newPath } = await uploadImageToBunny(file, session.access_token);
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
