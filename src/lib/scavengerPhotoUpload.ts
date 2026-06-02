import { supabase } from "@/integrations/supabase/client";
import { uploadImageWithMediaSdk } from "@/lib/mediaSdk/webStorageUploads";
import { imageMimeTypeForUpload } from "@/lib/webUploadMime";

function privateScavengerPhotoPath(path: string, matchId: string): string | null {
  const trimmed = path.trim();
  if (
    !trimmed ||
    /^https?:\/\//i.test(trimmed) ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("..") ||
    trimmed.includes("//")
  ) {
    return null;
  }
  const expectedPrefix = `photos/match-${matchId}/`;
  return trimmed.startsWith(expectedPrefix) ? trimmed : null;
}

export async function uploadWebScavengerPhoto(file: File, matchId: string | null | undefined): Promise<string> {
  const cleanMatchId = matchId?.trim();
  if (!cleanMatchId) throw new Error("No active conversation found.");
  const imageMimeType = imageMimeTypeForUpload(file.type, file.name);
  if (!imageMimeType || !imageMimeType.startsWith("image/")) {
    throw new Error("Please choose a JPEG, PNG, WebP, HEIC, or HEIF image.");
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Please sign in again before uploading a photo.");

  const { path } = await uploadImageWithMediaSdk({
    file,
    accessToken,
    context: "chat",
    matchId: cleanMatchId,
  });
  if (!path?.trim()) {
    throw new Error("Photo upload completed without a private media reference.");
  }
  const privatePath = privateScavengerPhotoPath(path, cleanMatchId);
  if (!privatePath) {
    throw new Error("Photo upload completed without a chat-private media reference.");
  }
  return privatePath;
}
