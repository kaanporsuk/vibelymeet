import { supabase } from '@/lib/supabase';
import {
  normalizeVideoDateSnapshot,
  VIDEO_DATE_SNAPSHOT_FUNCTION_NAME,
  type VideoDateSnapshot,
} from '@clientShared/matching/videoDateSnapshot';

export async function fetchVideoDateSnapshot(sessionId: string): Promise<VideoDateSnapshot> {
  if (!sessionId) {
    return { ok: false, error: 'missing_session_id', retryable: false };
  }
  const { data, error } = await supabase.functions.invoke(VIDEO_DATE_SNAPSHOT_FUNCTION_NAME, {
    body: { session_id: sessionId },
  });
  if (error) {
    return { ok: false, error: 'snapshot_function_failed', retryable: true };
  }
  return normalizeVideoDateSnapshot(data);
}
