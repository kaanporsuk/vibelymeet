import * as FileSystem from 'expo-file-system/legacy';

function safeExtFromMime(mimeType: string): string {
  const mt = mimeType.toLowerCase();
  if (mt.includes('png')) return 'png';
  if (mt.includes('webp')) return 'webp';
  if (mt.includes('heic') || mt.includes('heif')) return 'heic';
  if (mt.includes('quicktime')) return 'mov';
  if (mt.includes('m4v')) return 'm4v';
  if (mt.includes('mp4')) return 'mp4';
  if (mt.includes('m4a')) return 'm4a';
  if (mt.includes('aac')) return 'aac';
  if (mt.includes('wav')) return 'wav';
  return '';
}

function safeExtFromUri(uri: string): string {
  const pathOnly = uri.split('?')[0].split('#')[0];
  const last = pathOnly.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot === last.length - 1) return '';
  return last.slice(dot + 1).toLowerCase();
}

export async function copyChatOutboxMediaToCache(params: {
  queueItemId: string;
  kind: 'image' | 'voice' | 'video';
  uri: string;
  mimeType?: string | null;
}): Promise<{ cachedUri: string; copied: boolean }> {
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) {
    return { cachedUri: params.uri, copied: false };
  }

  const ext =
    (params.mimeType ? safeExtFromMime(params.mimeType) : '') ||
    safeExtFromUri(params.uri) ||
    (params.kind === 'voice' ? 'm4a' : params.kind === 'video' ? 'mp4' : 'jpg');

  const dest = `${cacheRoot}chat-outbox-${params.queueItemId}.${ext}`;

  try {
    // Fast-path: if already exists, reuse.
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists) return { cachedUri: dest, copied: false };

    await FileSystem.copyAsync({ from: params.uri, to: dest });
    return { cachedUri: dest, copied: true };
  } catch {
    // Fallback to original URI (best-effort). This may not survive restarts for some URI schemes.
    return { cachedUri: params.uri, copied: false };
  }
}

export async function deleteChatOutboxCachedMedia(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // ignore
  }
}

