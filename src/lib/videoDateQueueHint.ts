import { supabase } from "@/integrations/supabase/client";
import {
  normalizeVideoDateQueueHint,
  type VideoDateQueueHint,
} from "@clientShared/matching/videoDatePublicApi";

export type { VideoDateQueueHint };

export async function fetchVideoDateQueueHint(
  eventId: string,
  viewerProfileId: string,
): Promise<VideoDateQueueHint> {
  if (!eventId || !viewerProfileId) {
    return normalizeVideoDateQueueHint({ ok: false, queued: false, reason: "missing_args" });
  }

  const { data, error } = await supabase.rpc("get_video_date_queue_hint_v1" as never, {
    p_event_id: eventId,
    p_user_id: viewerProfileId,
  } as never);
  if (error) {
    return normalizeVideoDateQueueHint({ ok: false, queued: false, reason: error.code || "rpc_error" });
  }

  return normalizeVideoDateQueueHint(data);
}
