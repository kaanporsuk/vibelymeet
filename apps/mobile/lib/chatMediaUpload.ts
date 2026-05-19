/**
 * Chat image and voice upload helpers.
 * Chat Vibe Clips upload through Bunny Stream TUS via `chatVibeClipStreamUpload`.
 */

import { getCachedAccessToken } from '@/lib/nativeAuthSession';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const GENERIC_UPLOAD_MIME_TYPE = 'application/octet-stream';

function extensionFromUri(uri: string): string | null {
  const clean = uri.trim().split(/[?#]/)[0] ?? uri;
  const last = clean.split('/').pop() ?? clean;
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot >= last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || null;
}

function normalizedImageMimeType(mimeType: string | null | undefined, imageUri: string): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(normalized)) {
    return normalized;
  }

  const ext = extensionFromUri(imageUri);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return GENERIC_UPLOAD_MIME_TYPE;
}

export async function uploadVoiceMessage(audioUri: string, matchId: string): Promise<string> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const formData = new FormData();
  formData.append('conversation_id', matchId);
  formData.append(
    'file',
    {
      uri: audioUri,
      type: 'audio/m4a',
      name: 'voice.m4a',
    } as unknown as Blob
  );

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-voice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(errorText || `Upload failed with status ${res.status}`);
  }

  const data = await res.json();
  const mediaRef = typeof data.path === 'string' && data.path ? data.path : data.url;
  if (!data.success || !mediaRef) throw new Error(data.error ?? 'Voice upload failed');
  return mediaRef;
}

export async function uploadChatImageMessage(
  imageUri: string,
  mimeType: string | null | undefined,
  matchId: string,
  clientRequestId?: string,
): Promise<string> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const formData = new FormData();
  formData.append('context', 'chat');
  formData.append('match_id', matchId);
  const stableClientRequestId = clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append('client_request_id', stableClientRequestId);
  }
  const uploadMimeType = normalizedImageMimeType(mimeType, imageUri);
  const ext =
    uploadMimeType.includes('png') ? 'png' :
    uploadMimeType.includes('webp') ? 'webp' :
    uploadMimeType.includes('heic') || uploadMimeType.includes('heif') ? 'heic' :
    uploadMimeType === GENERIC_UPLOAD_MIME_TYPE ? (extensionFromUri(imageUri) ?? 'bin') :
    'jpg';
  formData.append(
    'file',
    {
      uri: imageUri,
      type: uploadMimeType,
      name: `chat-image.${ext}`,
    } as unknown as Blob
  );

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(stableClientRequestId ? { 'x-client-request-id': stableClientRequestId } : {}),
    },
    body: formData,
  });

  const text = await res.text().catch(() => '');
  let data: { success?: boolean; path?: string; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Image upload failed');
  }
  if (!res.ok || !data.success || !data.path) {
    throw new Error(data.error || `Upload failed with status ${res.status}`);
  }
  return data.path;
}
