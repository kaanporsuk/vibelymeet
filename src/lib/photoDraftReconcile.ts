import { supabase } from "@/integrations/supabase/client";

/**
 * Marks draft_media_sessions rows for the given storage paths as deleted (unpublished
 * photo uploads discarded before Save). Same RPC as native `photoBatchController`.
 */
export async function markEphemeralPhotoPathsDeleted(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter((p) => typeof p === "string" && p.startsWith("photos/"));
  if (unique.length === 0) return;
  const { error } = await supabase.rpc("mark_photo_drafts_deleted", { p_paths: unique });
  if (error && import.meta.env.DEV) {
    console.warn("[markEphemeralPhotoPathsDeleted]", error.message);
  }
}
