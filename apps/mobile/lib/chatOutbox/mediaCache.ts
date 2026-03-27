import * as FileSystem from 'expo-file-system/legacy';

/**
 * Copy picker/recorder URIs into the app cache so queue retries survive process restarts
 * when the original temp URI is no longer valid.
 */
export async function copyUriToChatOutboxCache(uri: string, ext: string): Promise<string> {
  const trimmed = uri.trim();
  if (!trimmed) return uri;
  const root = FileSystem.cacheDirectory;
  if (!root) return trimmed;
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const dest = `${root}chat-outbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
  try {
    await FileSystem.copyAsync({ from: trimmed, to: dest });
    return dest;
  } catch {
    return trimmed;
  }
}

export function extForPayload(kind: 'image' | 'voice' | 'video', mime?: string): string {
  if (kind === 'voice') return 'm4a';
  if (kind === 'video') {
    if (mime?.includes('quicktime') || mime?.includes('mov')) return 'mov';
    return 'mp4';
  }
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('heic') || mime?.includes('heif')) return 'heic';
  return 'jpg';
}
