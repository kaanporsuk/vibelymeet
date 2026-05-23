import { supabase } from "@/integrations/supabase/client";

/**
 * Marks unpublished profile-photo paths as discarded before Save.
 * The RPC is asset-backed; the historical name is kept for client compatibility.
 */
export async function markEphemeralPhotoPathsDeleted(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter((p) => typeof p === "string" && p.startsWith("photos/"));
  if (unique.length === 0) return;
  const { error } = await supabase.rpc("mark_photo_drafts_deleted", { p_paths: unique });
  if (error && import.meta.env.DEV) {
    console.warn("[markEphemeralPhotoPathsDeleted]", error.message);
  }
}
