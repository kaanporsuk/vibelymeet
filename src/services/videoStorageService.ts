import { supabase } from "@/integrations/supabase/client";

const BUCKET_NAME = "vibe-videos";

export interface VideoUploadResult {
  url: string;
  path: string;
}

/**
 * Get a signed URL for a video (1 hour expiration)
 */
export const getSignedVideoUrl = async (path: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, 3600); // 1 hour expiration

  if (error) {
    console.error("Signed video URL error:", error);
    return null;
  }

  return data.signedUrl;
};

/**
 * Get public URL for a video (if bucket is public)
 */
export const getPublicVideoUrl = (path: string): string => {
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
};

/**
 * Upload a video to Supabase storage
 */
export const uploadVideo = async (
  file: File | Blob,
  userId: string
): Promise<VideoUploadResult> => {
  // Determine file extension
  let fileExt = "webm";
  if (file instanceof File) {
    fileExt = file.name.split(".").pop()?.toLowerCase() || "webm";
  } else if (file.type) {
    // For Blob, extract from MIME type
    const mimeExt = file.type.split("/")[1];
    if (mimeExt) fileExt = mimeExt.split(";")[0];
  }

  // Generate unique filename
  const fileName = `${userId}/${Date.now()}_vibe.${fileExt}`;

  // Upload to Supabase storage
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "video/webm",
    });

  if (error) {
    console.error("Video upload error:", error);
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  // Get public URL (bucket should be public for video playback)
  const publicUrl = getPublicVideoUrl(data.path);

  return {
    url: publicUrl,
    path: data.path,
  };
};

/**
 * Delete a video from storage
 */
export const deleteVideo = async (videoUrl: string): Promise<void> => {
  const splitOn = `/${BUCKET_NAME}/`;
  const idx = videoUrl.indexOf(splitOn);
  if (idx === -1) return;

  const pathWithQuery = videoUrl.slice(idx + splitOn.length);
  const path = pathWithQuery.split("?")[0];

  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

  if (error) {
    console.error("Video delete error:", error);
    throw new Error(`Failed to delete video: ${error.message}`);
  }
};

/**
 * Check if a URL is a blob URL (local) vs a storage URL
 */
export const isVideoBlobUrl = (url: string): boolean => {
  return url.startsWith("blob:");
};

/**
 * Convert blob URL to File by fetching it
 */
export const blobUrlToFile = async (blobUrl: string, filename: string = "video.webm"): Promise<File> => {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "video/webm" });
};
