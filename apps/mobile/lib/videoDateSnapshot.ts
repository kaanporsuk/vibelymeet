import { supabase } from '@/lib/supabase';
import {
  normalizeVideoDateSnapshot,
  normalizeVideoDateSnapshotInvokeError,
  VIDEO_DATE_SNAPSHOT_FUNCTION_NAME,
  type VideoDateSnapshot,
} from '@clientShared/matching/videoDateSnapshot';

export async function fetchVideoDateSnapshot(
  sessionId: string,
  options: { includeToken?: boolean } = {},
): Promise<VideoDateSnapshot> {
  if (!sessionId) {
    return { ok: false, error: 'missing_session_id', retryable: false };
  }
  try {
    const { data, error } = await supabase.functions.invoke(VIDEO_DATE_SNAPSHOT_FUNCTION_NAME, {
      body: { session_id: sessionId, include_token: options.includeToken === true },
    });
    if (error) {
      return await normalizeVideoDateSnapshotInvokeError(error);
    }
    return normalizeVideoDateSnapshot(data);
  } catch {
    return { ok: false, error: 'snapshot_function_failed', retryable: true };
  }
}
