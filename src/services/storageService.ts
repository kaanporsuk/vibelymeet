import { supabase } from "@/integrations/supabase/client";
import { uploadImageToBunny } from "@/services/imageUploadService";

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
  // Store raw storage paths, NOT signed URLs — signed URLs expire
  return results.map((r) => r.path);
};

/**
 * Delete a photo from storage
 */
export const deletePhoto = async (photoUrl: string): Promise<void> => {
  // Works for both public and signed URLs.
  const splitOn = `/${BUCKET_NAME}/`;
  const idx = photoUrl.indexOf(splitOn);
  if (idx === -1) return;

  const pathWithQuery = photoUrl.slice(idx + splitOn.length);
  const path = pathWithQuery.split("?")[0];

  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

  if (error) {
    console.error("Delete error:", error);
    throw new Error(`Failed to delete photo: ${error.message}`);
  }
};

/**
 * Check if a signed URL is expired or about to expire (within 5 minutes)
 */
export const isSignedUrlExpiring = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get("token");
    if (!token) return true;
    
    // JWT token - decode the middle part (payload)
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    
    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;
    if (!exp) return true;
    
    // Check if expires within 5 minutes
    const expiresAt = exp * 1000;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    return expiresAt - now < fiveMinutes;
  } catch {
    return true;
  }
};

/**
 * Extract storage path from a signed URL
 */
export const extractPathFromSignedUrl = (url: string): string | null => {
  const splitOn = `/${BUCKET_NAME}/`;
  const idx = url.indexOf(splitOn);
  if (idx === -1) return null;

  const pathWithQuery = url.slice(idx + splitOn.length);
  return pathWithQuery.split("?")[0];
};

/**
 * Refresh signed URLs that are expiring or expired
 */
export const refreshSignedUrls = async (urls: string[]): Promise<string[]> => {
  const refreshed: string[] = [];

  for (const url of urls) {
    if (isBlobUrl(url)) {
      refreshed.push(url);
      continue;
    }

    // Check if URL needs refreshing
    if (isSignedUrlExpiring(url)) {
      const path = extractPathFromSignedUrl(url);
      if (path) {
        const newUrl = await getSignedPhotoUrl(path);
        refreshed.push(newUrl || url);
      } else {
        refreshed.push(url);
      }
    } else {
      refreshed.push(url);
    }
  }

  return refreshed;
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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const persistedUrls: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const file = files[i];

    if (isBlobUrl(photo) && file) {
      // Upload via Bunny edge function
      const newPath = await uploadImageToBunny(file, session.access_token);
      persistedUrls.push(newPath);
    } else if (!isBlobUrl(photo)) {
      // Already a storage path or URL, keep it
      persistedUrls.push(photo);
    }
  }

  return persistedUrls;
};
