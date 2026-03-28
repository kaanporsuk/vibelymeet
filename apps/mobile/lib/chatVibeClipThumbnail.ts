/**
 * One-off JPEG thumbnail for chat Vibe Clip upload (parity with web canvas path).
 * Uses expo-video frame grab + expo-image-manipulator save — no expo-av.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

const READY_WAIT_MS = 22_000;
/** Match web `createWebVideoThumbnail` ~0.5s probe; fall back for very short clips. */
const THUMB_TIMES_SEC = [0.5, 0.12, 0];

function waitForReadyOrError(player: VideoPlayer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (player.status === 'readyToPlay') {
      resolve();
      return;
    }
    if (player.status === 'error') {
      reject(new Error('video_player_error'));
      return;
    }
    const timeout = setTimeout(() => {
      sub.remove();
      reject(new Error('video_ready_timeout'));
    }, READY_WAIT_MS);
    const sub = player.addListener('statusChange', (e) => {
      if (e.status === 'readyToPlay') {
        clearTimeout(timeout);
        sub.remove();
        resolve();
      }
      if (e.status === 'error') {
        clearTimeout(timeout);
        sub.remove();
        reject(new Error('video_player_error'));
      }
    });
  });
}

/**
 * @returns Local file URI of a JPEG suitable for `upload-chat-video` `thumbnail` field, or null on failure.
 */
export async function generateChatVibeClipThumbnailFile(videoUri: string): Promise<string | null> {
  const trimmed = videoUri?.trim();
  if (!trimmed) return null;

  const player = createVideoPlayer(trimmed);
  try {
    await waitForReadyOrError(player);

    const thumbs = await player.generateThumbnailsAsync(THUMB_TIMES_SEC, {
      maxWidth: 720,
      maxHeight: 1280,
    });

    if (!thumbs.length) return null;

    const rawThumb = thumbs[0]!;
    for (let i = 1; i < thumbs.length; i++) {
      thumbs[i].release();
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
          image.release();
        }
      } finally {
        context.release();
      }
    } finally {
      rawThumb.release();
    }
  } catch {
    return null;
  } finally {
    player.release();
  }
}
