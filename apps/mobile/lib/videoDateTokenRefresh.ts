import { supabase } from '@/lib/supabase';
import {
  normalizeVideoDateTokenRefresh,
  normalizeVideoDateTokenRefreshInvokeError,
  VIDEO_DATE_TOKEN_REFRESH_FUNCTION_NAME,
  type VideoDateTokenRefreshResult,
} from '@clientShared/matching/videoDatePublicApi';

export type { VideoDateTokenRefreshResult };

export async function refreshVideoDateToken(sessionId: string): Promise<VideoDateTokenRefreshResult> {
  if (!sessionId) {
    return { ok: false, error: 'missing_session_id', retryable: false };
  }

  try {
    const { data, error } = await supabase.functions.invoke(VIDEO_DATE_TOKEN_REFRESH_FUNCTION_NAME, {
      body: { session_id: sessionId },
    });
    if (error) {
      return await normalizeVideoDateTokenRefreshInvokeError(error);
    }
    return normalizeVideoDateTokenRefresh(data);
  } catch {
    return { ok: false, error: 'token_refresh_function_failed', retryable: true };
  }
}
