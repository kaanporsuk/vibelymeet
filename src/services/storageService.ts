import { supabase } from "@/integrations/supabase/client";

const BUCKET_NAME = "profile-photos";

export interface UploadResult {
  url: string;
  path: string;
}

/**
 * Get a signed URL for a photo (1 hour expiration)
 */
export const getSignedPhotoUrl = async (path: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, 3600); // 1 hour expiration

  if (error) {
    console.error("Signed URL error:", error);
    return null;
  }

  return data.signedUrl;
};

/**
 * Upload a photo to Supabase storage
 */
export const uploadPhoto = async (
  file: File,
  userId: string,
  index: number
): Promise<UploadResult> => {
  // Generate unique filename
  const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const fileName = `${userId}/${Date.now()}_${index}.${fileExt}`;

  // Upload to Supabase storage
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (error) {
    console.error("Upload error:", error);
    throw new Error(`Failed to upload photo: ${error.message}`);
  }

  // Get signed URL (bucket is now private)
  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(data.path, 3600); // 1 hour expiration

  if (signedError) {
    console.error("Signed URL error:", signedError);
    throw new Error(`Failed to get signed URL: ${signedError.message}`);
  }

  return {
    url: signedData.signedUrl,
    path: data.path,
  };
};

/**
 * Upload multiple photos
 */
export const uploadPhotos = async (
  files: (File | null)[],
  userId: string
): Promise<string[]> => {
  const uploadPromises = files
    .map((file, index) => {
      if (!file) return null;
      return uploadPhoto(file, userId, index);
    })
    .filter(Boolean);

  const results = await Promise.all(uploadPromises as Promise<UploadResult>[]);
  return results.map((r) => r.url);
};

/**
 * Delete a photo from storage
 */
export const deletePhoto = async (photoUrl: string): Promise<void> => {
  // Extract path from URL
  const urlParts = photoUrl.split(`${BUCKET_NAME}/`);
  if (urlParts.length < 2) return;

  const path = urlParts[1];

  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

  if (error) {
    console.error("Delete error:", error);
    throw new Error(`Failed to delete photo: ${error.message}`);
  }
};

/**
 * Check if a URL is a blob URL (local) vs a storage URL
 */
export const isBlobUrl = (url: string): boolean => {
  return url.startsWith("blob:");
};

/**
 * Convert local blob URLs to storage URLs by uploading files
 */
export const persistPhotos = async (
  photos: string[],
  files: (File | null)[],
  userId: string
): Promise<string[]> => {
  const persistedUrls: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const file = files[i];

    if (isBlobUrl(photo) && file) {
      // Upload the file and get storage URL
      const result = await uploadPhoto(file, userId, i);
      persistedUrls.push(result.url);
    } else if (!isBlobUrl(photo)) {
      // Already a storage URL, keep it
      persistedUrls.push(photo);
    }
  }

  return persistedUrls;
};
