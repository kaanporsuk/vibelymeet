import { supabase } from "@/integrations/supabase/client";
import { uploadImageWithMediaSdk } from "@/lib/mediaSdk/webStorageUploads";
import { imageMimeTypeForUpload } from "@/lib/webUploadMime";

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
  return path.trim();
}
