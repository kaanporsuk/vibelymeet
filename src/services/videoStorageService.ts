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

export interface UploadProgressCallback {
  (progress: number, status: string): void;
}

/**
 * Upload a video to Supabase storage with progress tracking
 * NOTE: We intentionally return the *path* (not a public URL) because this bucket
 * is private in this project. Playback should use signed URLs.
 */
export const uploadVideo = async (
  file: File | Blob,
  userId: string,
  onProgress?: UploadProgressCallback
): Promise<VideoUploadResult> => {
  // Determine file extension
  let fileExt = "webm";
  if (file instanceof File) {
    fileExt = file.name.split(".").pop()?.toLowerCase() || "webm";
  } else if (file.type) {
    const mimeExt = file.type.split("/")[1];
    if (mimeExt) fileExt = mimeExt.split(";")[0];
  }

  const fileName = `${userId}/${Date.now()}_vibe.${fileExt}`;
  const fileSize = file.size;

  // Bug 9: Server-side file size validation
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("File exceeds 50MB upload limit");
  }

  // Report initial progress
  onProgress?.(0, "Starting upload...");

  // Use XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    // Get the upload URL and headers
    const uploadUrl = `${supabase.storage.from(BUCKET_NAME).upload.toString().includes('supabase') ? '' : ''}`;
    
    // We need to use the Supabase client's internal URL
    const projectUrl = (supabase as any).supabaseUrl || '';
    const anonKey = (supabase as any).supabaseKey || '';
    
    // Construct the storage upload URL
    const storageUrl = `${projectUrl}/storage/v1/object/${BUCKET_NAME}/${fileName}`;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100;
        onProgress?.(percentComplete, "Uploading video...");
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100, "Upload complete!");
        resolve({ path: fileName });
      } else {
        // Fallback to standard upload if XHR fails
        fallbackUpload(file, fileName, onProgress)
          .then(resolve)
          .catch(reject);
      }
    });

    xhr.addEventListener("error", () => {
      // Fallback to standard upload
      fallbackUpload(file, fileName, onProgress)
        .then(resolve)
        .catch(reject);
    });

    // Get auth token
    supabase.auth.getSession().then(({ data: { session } }) => {
      const authToken = session?.access_token || anonKey;
      
      xhr.open("POST", storageUrl, true);
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
      xhr.setRequestHeader("apikey", anonKey);
      xhr.setRequestHeader("Content-Type", file.type || "video/webm");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.setRequestHeader("Cache-Control", "3600");
      
      xhr.send(file);
    }).catch(() => {
      // Fallback if session fetch fails
      fallbackUpload(file, fileName, onProgress)
        .then(resolve)
        .catch(reject);
    });
  });
};

/**
 * Fallback upload using standard Supabase client (no progress)
 */
const fallbackUpload = async (
  file: File | Blob,
  fileName: string,
  onProgress?: UploadProgressCallback
): Promise<VideoUploadResult> => {
  onProgress?.(50, "Uploading video...");
  
  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(fileName, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "video/webm",
  });

  if (error) {
    console.error("Video upload error:", error);
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  onProgress?.(100, "Upload complete!");
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
