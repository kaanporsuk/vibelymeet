import { supabase } from "@/integrations/supabase/client";

const BUCKET_NAME = "vibe-videos";

export interface VideoUploadResult {
  /**
   * Storage path (e.g. "userId/123_vibe.webm")
   */
  path: string;
}

/**
 * Extract a storage path from either:
 * - a raw path ("userId/...")
 * - a public URL containing "/storage/v1/object/public/vibe-videos/<path>"
 * - a signed URL containing "/storage/v1/object/sign/vibe-videos/<path>?..."
 */
export const extractVibeVideoPath = (storedValue: string): string => {
  // If it's already a plain path, return as-is.
  if (!storedValue.startsWith("http")) return storedValue;

  const markers = [
    `/storage/v1/object/public/${BUCKET_NAME}/`,
    `/storage/v1/object/sign/${BUCKET_NAME}/`,
    `/${BUCKET_NAME}/`,
  ];

  for (const marker of markers) {
    const idx = storedValue.indexOf(marker);
    if (idx !== -1) {
      const after = storedValue.slice(idx + marker.length);
      return after.split("?")[0];
    }
  }

  // Fall back: return original (caller will likely fail gracefully)
  return storedValue;
};

/**
 * Get a signed URL for a video (1 hour expiration)
 */
export const getSignedVideoUrl = async (pathOrStoredValue: string): Promise<string | null> => {
  const path = extractVibeVideoPath(pathOrStoredValue);

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, 3600);

  if (error) {
    console.error("Signed video URL error:", error);
    return null;
  }

  return data.signedUrl;
};

/**
 * Upload a video to Supabase storage
 * NOTE: We intentionally return the *path* (not a public URL) because this bucket
 * is private in this project. Playback should use signed URLs.
 */
export const uploadVideo = async (file: File | Blob, userId: string): Promise<VideoUploadResult> => {
  // Determine file extension
  let fileExt = "webm";
  if (file instanceof File) {
    fileExt = file.name.split(".").pop()?.toLowerCase() || "webm";
  } else if (file.type) {
    const mimeExt = file.type.split("/")[1];
    if (mimeExt) fileExt = mimeExt.split(";")[0];
  }

  const fileName = `${userId}/${Date.now()}_vibe.${fileExt}`;

  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(fileName, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "video/webm",
  });

  if (error) {
    console.error("Video upload error:", error);
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  return { path: data.path };
};

/**
 * Delete a video from storage.
 * Accepts either a stored path or a URL.
 */
export const deleteVideo = async (pathOrUrl: string): Promise<void> => {
  const path = extractVibeVideoPath(pathOrUrl);
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

  if (error) {
    console.error("Video delete error:", error);
    throw new Error(`Failed to delete video: ${error.message}`);
  }
};

/**
 * Convert blob URL to File by fetching it
 */
export const blobUrlToFile = async (
  blobUrl: string,
  filename: string = "video.webm"
): Promise<File> => {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "video/webm" });
};
