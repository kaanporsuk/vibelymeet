/**
 * Abortable polling for profile vibe video processing — survives background gaps; caller handles AppState refetch.
 */

import { supabase } from '@/lib/supabase';
import { normalizeBunnyVideoStatus } from '@/lib/vibeVideoStatus';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

export type VibePollTerminal = 'ready' | 'failed' | 'timeout' | 'superseded' | 'aborted';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      signal?.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Poll until status is terminal for `expectedVideoId`, user superseded the video, or abort/timeout.
 */
export async function pollVibeVideoUntilTerminal(options: {
  expectedVideoId: string;
  maxAttempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}): Promise<VibePollTerminal> {
  const { expectedVideoId, maxAttempts = 30, intervalMs = 5000, signal } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await sleep(intervalMs, signal);
    } catch {
      return 'aborted';
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      vibeVideoDiagVerbose('poll.skip_no_user', { attempt });
      continue;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('bunny_video_uid, bunny_video_status')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[VibeVideo] poll profile error:', error.message);
      continue;
    }

    const rowUid = typeof data?.bunny_video_uid === 'string' ? data.bunny_video_uid.trim() : '';
    if (rowUid && rowUid !== expectedVideoId) {
      vibeVideoDiagVerbose('poll.superseded', { expectedVideoId, rowUid, attempt });
      return 'superseded';
    }

    const st = normalizeBunnyVideoStatus(data?.bunny_video_status as string | null | undefined);
    if (st === 'ready') return 'ready';
    if (st === 'failed') return 'failed';
  }

  return 'timeout';
}
