import { supabase } from "@/integrations/supabase/client";
import {
  normalizeVideoDateStartSnapshot,
  VIDEO_DATE_START_SNAPSHOT_RPC_NAME,
  type VideoDateStartSnapshot,
} from "@clientShared/matching/videoDateStartSnapshot";

export async function fetchVideoDateStartSnapshot(
  sessionId: string,
): Promise<VideoDateStartSnapshot> {
  if (!sessionId) {
    return normalizeVideoDateStartSnapshot({
      ok: false,
      error: "missing_session_id",
      retryable: false,
      terminal: false,
    });
  }

  try {
    const { data, error } = await supabase.rpc(VIDEO_DATE_START_SNAPSHOT_RPC_NAME as never, {
      p_session_id: sessionId,
    } as never);
    if (error) {
      return normalizeVideoDateStartSnapshot({
        ok: false,
        error: error.message || "start_snapshot_rpc_error",
        error_code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
        retryable: true,
        terminal: false,
      });
    }
    return normalizeVideoDateStartSnapshot(data);
  } catch (error) {
    return normalizeVideoDateStartSnapshot({
      ok: false,
      error: error instanceof Error ? error.message : "start_snapshot_rpc_error",
      retryable: true,
      terminal: false,
    });
  }
}
