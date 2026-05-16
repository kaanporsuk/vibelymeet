/**
 * One-off JPEG thumbnail for chat Vibe Clip upload (parity with web canvas path).
 * Uses expo-video frame grab + expo-image-manipulator save — no expo-av.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer, type VideoPlayerStatus } from 'expo-video';
import {
  safeExpoSharedObjectAsync,
  safeExpoSharedObjectCall,
  safeExpoSharedObjectRead,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';

const READY_WAIT_MS = 22_000;
/** Match web `createWebVideoThumbnail` ~0.5s probe; fall back for very short clips. */
const THUMB_TIMES_SEC = [0.5, 0.12, 0];
type SharedObjectSubscription = { remove?: () => void } | null | undefined;

function waitForReadyOrError(player: VideoPlayer): Promise<void> {
  return new Promise((resolve, reject) => {
    const initialStatus = safeExpoSharedObjectRead<VideoPlayerStatus>(
      () => player.status,
      'error',
      'chat.thumbnail.status',
    );
    if (initialStatus === 'readyToPlay') {
      resolve();
      return;
    }
    if (initialStatus === 'error') {
      reject(new Error('video_player_error'));
      return;
    }

    let settled = false;
    let sub: SharedObjectSubscription = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      safeRemoveExpoSharedObjectSubscription(sub, 'chat.thumbnail.statusListener.remove');
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      finish(new Error('video_ready_timeout'));
    }, READY_WAIT_MS);

    sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (e) => {
        if (e.status === 'readyToPlay') {
          finish();
        }
        if (e.status === 'error') {
          finish(new Error('video_player_error'));
        }
      }),
      {
        label: 'chat.thumbnail.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    if (!sub) finish(new Error('video_listener_unavailable'));
  });
}

/**
 * @returns Local file URI of a JPEG suitable for `upload-chat-video` `thumbnail` field, or null on failure.
 */
export async function generateChatVibeClipThumbnailFile(videoUri: string): Promise<string | null> {
  const trimmed = videoUri?.trim();
  if (!trimmed) return null;

  const player = safeExpoSharedObjectCall(() => createVideoPlayer(trimmed), {
    label: 'chat.thumbnail.createPlayer',
    fallback: null,
    swallowAll: true,
  });
  if (!player) return null;
  try {
    await waitForReadyOrError(player);

    const thumbs = await safeExpoSharedObjectAsync(
      () => player.generateThumbnailsAsync(THUMB_TIMES_SEC, {
        maxWidth: 720,
        maxHeight: 1280,
      }),
      {
        label: 'chat.thumbnail.generate',
        fallback: null,
        swallowAll: true,
      },
    );

    if (!thumbs?.length) return null;

    const rawThumb = thumbs[0]!;
    for (let i = 1; i < thumbs.length; i++) {
      safeExpoSharedObjectCall(() => thumbs[i]?.release(), {
        label: 'chat.thumbnail.releaseExtra',
        swallowAll: true,
      });
    }
    try {
      const context = ImageManipulator.manipulate(rawThumb);
      try {
        const image = await context.renderAsync();
        try {
          const result = await image.saveAsync({
            format: SaveFormat.JPEG,
            compress: 0.82,
          });
          return result.uri || null;
        } finally {
          safeExpoSharedObjectCall(() => image.release(), {
            label: 'chat.thumbnail.image.release',
            swallowAll: true,
          });
        }
      } finally {
        safeExpoSharedObjectCall(() => context.release(), {
          label: 'chat.thumbnail.context.release',
          swallowAll: true,
        });
      }
    } finally {
      safeExpoSharedObjectCall(() => rawThumb.release(), {
        label: 'chat.thumbnail.releasePrimary',
        swallowAll: true,
      });
    }
  } catch {
    return null;
  } finally {
    safeExpoSharedObjectCall(() => player.release(), {
      label: 'chat.thumbnail.player.release',
      swallowAll: true,
    });
  }
}
