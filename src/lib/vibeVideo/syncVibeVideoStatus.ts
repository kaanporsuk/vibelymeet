import { supabase } from "@/integrations/supabase/client";
import { captureVibeVideoException, trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";

export type VibeVideoSyncSource =
  | "processing_poll"
  | "manual_refresh"
  | "manual_retry"
  | "visibility_active"
  | "vibe_studio_load";

type SyncVibeVideoStatusResult = {
  success?: boolean;
  synced?: boolean;
  videoId?: string | null;
  bunnyStatus?: number | null;
  mappedStatus?: string | null;
  code?: string;
  error?: string;
};

export async function syncCurrentVibeVideoStatus(
  videoId: string | null | undefined,
  source: VibeVideoSyncSource,
): Promise<SyncVibeVideoStatusResult | null> {
  const uid = typeof videoId === "string" ? videoId.trim() : "";
  if (!uid) return null;

  try {
    const { data, error } = await supabase.functions.invoke<SyncVibeVideoStatusResult>(
      "sync-vibe-video-status",
      { body: { videoId: uid } },
    );

    if (error) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.failedObserved, {
        source: "sync_vibe_video_status",
        surface: source,
        video_guid: uid,
        error_code: error.name || "sync_invoke_error",
      });
      return null;
    }

    if (data?.success === true) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingStatusChanged, {
        source: "sync_vibe_video_status",
        surface: source,
        video_guid: uid,
        status: data.mappedStatus ?? "unknown",
      });
    }

    return data ?? null;
  } catch (error) {
    captureVibeVideoException(error, {
      source: "sync_vibe_video_status",
      phase: source,
      video_guid: uid,
    });
    return null;
  }
}
