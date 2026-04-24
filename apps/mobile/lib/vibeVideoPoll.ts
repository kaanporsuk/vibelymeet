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

  vibeVideoDiagVerbose('poll.start', { expectedVideoId, maxAttempts, intervalMs });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await sleep(intervalMs, signal);
    } catch {
      vibeVideoDiagVerbose('poll.aborted_signal', { expectedVideoId, attempt });
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
      vibeVideoDiagVerbose('poll.profile_error', {
        userId: user.id,
        expectedVideoId,
        attempt,
        message: error.message,
      });
      continue;
    }

    // Empty / null / non-string / whitespace-only → treat as cleared (matches delete + RPC clears).
    const rowUid = typeof data?.bunny_video_uid === 'string' ? data.bunny_video_uid.trim() : '';
    const rawStatus =
      typeof data?.bunny_video_status === 'string' ? data.bunny_video_status.trim() : null;
    vibeVideoDiagVerbose('poll.tick', {
      userId: user.id,
      expectedVideoId,
      attempt,
      rowUid: rowUid || null,
      rawStatus,
    });
    if (!rowUid) {
      vibeVideoDiagVerbose('poll.uid_removed_or_empty', {
        userId: user.id,
        expectedVideoId,
        attempt,
        rawStatus,
      });
      vibeVideoDiagVerbose('poll.terminal', {
        expectedVideoId,
        result: 'superseded',
        reason: 'profile_bunny_video_uid_cleared',
        attempt,
      });
      return 'superseded';
    }
    if (rowUid !== expectedVideoId) {
      vibeVideoDiagVerbose('poll.terminal', { expectedVideoId, result: 'superseded', rowUid, attempt });
      return 'superseded';
    }

    const st = normalizeBunnyVideoStatus(data?.bunny_video_status as string | null | undefined);
    if (st === 'ready') {
      vibeVideoDiagVerbose('poll.terminal', { expectedVideoId, result: 'ready', attempt });
      return 'ready';
    }
    if (st === 'failed') {
      vibeVideoDiagVerbose('poll.terminal', { expectedVideoId, result: 'failed', attempt });
      return 'failed';
    }
  }

  vibeVideoDiagVerbose('poll.timeout', { expectedVideoId, maxAttempts });
  return 'timeout';
}
