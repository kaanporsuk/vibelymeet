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

function cachePrefix(): string | null {
  const root = FileSystem.cacheDirectory;
  if (!root) return null;
  return `${root}chat-outbox-`;
}

export function isChatOutboxCacheUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (!trimmed) return false;
  const prefix = cachePrefix();
  if (!prefix) return false;
  return trimmed.startsWith(prefix);
}

export async function cleanupOutboxCacheUri(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  const trimmed = uri.trim();
  if (!trimmed || !isChatOutboxCacheUri(trimmed)) return;
  try {
    await FileSystem.deleteAsync(trimmed, { idempotent: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function extFromUri(uri: string | null | undefined): string | null {
  const trimmed = uri?.trim();
  if (!trimmed) return null;
  const clean = trimmed.split(/[?#]/)[0] ?? trimmed;
  const last = clean.split('/').pop() ?? clean;
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot >= last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || null;
}

export function mimeForPayload(kind: 'image' | 'video', mime?: string | null, source?: string | null): string | undefined {
  const normalized = mime?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (kind === 'image') {
    if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(normalized)) {
      return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
    }
    const ext = extFromUri(source);
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'heic') return 'image/heic';
    if (ext === 'heif') return 'image/heif';
    return undefined;
  }

  if (['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/m4v', 'video/webm'].includes(normalized)) {
    return normalized === 'video/m4v' ? 'video/x-m4v' : normalized;
  }
  const ext = extFromUri(source);
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4') return 'video/mp4';
  return undefined;
}

export function extForPayload(kind: 'image' | 'voice' | 'video', mime?: string | null, source?: string | null): string {
  if (kind === 'voice') return 'm4a';
  if (kind === 'video') {
    const normalized = mimeForPayload('video', mime, source);
    if (normalized?.includes('quicktime') || normalized?.includes('mov')) return 'mov';
    if (normalized?.includes('x-m4v') || normalized?.includes('m4v')) return 'm4v';
    if (normalized?.includes('webm')) return 'webm';
    if (normalized?.includes('mp4')) return 'mp4';
    const ext = extFromUri(source);
    if (ext === 'mov' || ext === 'm4v' || ext === 'webm' || ext === 'mp4') return ext;
    return 'bin';
  }
  const normalized = mimeForPayload('image', mime, source);
  if (normalized?.includes('png')) return 'png';
  if (normalized?.includes('webp')) return 'webp';
  if (normalized?.includes('heic') || normalized?.includes('heif')) return 'heic';
  const ext = extFromUri(source);
  if (ext === 'png' || ext === 'webp' || ext === 'heic' || ext === 'heif') return ext === 'heif' ? 'heic' : ext;
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  return 'bin';
}
