/**
 * Chat media upload: upload-voice and upload-chat-video Edge Functions.
 * Same contract as web (voiceUploadService, chatVideoUploadService).
 * After upload, voice and Vibe Clip rows are persisted only via `send-message`
 * (`invokePublishVoiceMessage`, `invokePublishVibeClip`), not client `messages.insert`.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { generateChatVibeClipThumbnailFile } from '@/lib/chatVibeClipThumbnail';
import { getCachedAccessToken } from '@/lib/nativeAuthSession';
import {
  VIBE_CLIP_MAX_UPLOAD_BYTES,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
  vibeClipMultipartFitsEdgeLimit,
} from '../../../shared/chat/vibeClipCaptureCopy';

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

function normalizedVideoMimeType(mimeType: string | null | undefined, videoUri: string): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'video/m4v') return 'video/x-m4v';
  if (['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'].includes(normalized)) {
    return normalized;
  }

  const ext = extensionFromUri(videoUri);
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4') return 'video/mp4';
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

export async function uploadChatVideoMessage(
  videoUri: string,
  matchId: string,
  mimeType?: string | null,
  aspectRatio?: number | null
): Promise<{
  videoUrl: string;
  thumbnailUrl: string | null;
  posterSource: 'uploaded_thumbnail' | 'first_frame';
  aspectRatio: number | null;
}> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  let videoSizeBytes = 0;
  try {
    const info = await FileSystem.getInfoAsync(videoUri);
    if (info.exists && !info.isDirectory && typeof info.size === 'number') {
      if (info.size <= 0) throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
      if (info.size > VIBE_CLIP_MAX_UPLOAD_BYTES) throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());
      videoSizeBytes = info.size;
    }
  } catch (error) {
    if (error instanceof Error && (error.message === VIBE_CLIP_UPLOAD_EMPTY_FILE || error.message === VIBE_CLIP_UPLOAD_TOO_LARGE())) {
      throw error;
    }
  }

  let tempThumbUri: string | null = null;
  try {
    tempThumbUri = await generateChatVibeClipThumbnailFile(videoUri);
  } catch {
    tempThumbUri = null;
  }

  const formData = new FormData();
  formData.append('match_id', matchId);
  if (typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    formData.append('aspect_ratio', String(aspectRatio));
  }
  const uploadMimeType = normalizedVideoMimeType(mimeType, videoUri);
  const ext =
    uploadMimeType.includes('quicktime') || uploadMimeType.includes('mov') ? 'mov'
    : uploadMimeType.includes('x-m4v') || uploadMimeType.includes('m4v') ? 'm4v'
    : uploadMimeType.includes('webm') ? 'webm'
    : uploadMimeType === GENERIC_UPLOAD_MIME_TYPE ? (extensionFromUri(videoUri) ?? 'bin')
    : 'mp4';
  formData.append(
    'file',
    {
      uri: videoUri,
      type: uploadMimeType,
      name: `chat-video.${ext}`,
    } as unknown as Blob
  );
  if (tempThumbUri && videoSizeBytes > 0) {
    const thumbInfo = await FileSystem.getInfoAsync(tempThumbUri);
    const thumbSize =
      thumbInfo.exists && !thumbInfo.isDirectory && typeof thumbInfo.size === 'number' ? thumbInfo.size : 0;
    if (thumbSize > 0 && vibeClipMultipartFitsEdgeLimit(videoSizeBytes, thumbSize)) {
      formData.append(
        'thumbnail',
        {
          uri: tempThumbUri,
          type: 'image/jpeg',
          name: 'chat-video-thumb.jpg',
        } as unknown as Blob
      );
    }
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/upload-chat-video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } finally {
    if (tempThumbUri) {
      void FileSystem.deleteAsync(tempThumbUri, { idempotent: true }).catch(() => {});
    }
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(errorText || `Upload failed with status ${res.status}`);
  }

  const data = await res.json() as {
    success?: boolean;
    path?: string;
    url?: string;
    thumbnail_path?: string | null;
    thumbnail_url?: string | null;
    poster_source?: 'uploaded_thumbnail' | 'first_frame';
    aspect_ratio?: number | null;
    error?: string;
  };
  const videoRef = typeof data.path === 'string' && data.path ? data.path : data.url;
  if (!data.success || !videoRef) throw new Error(data.error ?? 'Video upload failed');
  return {
    videoUrl: videoRef,
    thumbnailUrl:
      typeof data.thumbnail_path === 'string' && data.thumbnail_path
        ? data.thumbnail_path
        : typeof data.thumbnail_url === 'string' && data.thumbnail_url
          ? data.thumbnail_url
          : null,
    posterSource: data.poster_source === 'uploaded_thumbnail' ? 'uploaded_thumbnail' : 'first_frame',
    aspectRatio:
      typeof data.aspect_ratio === 'number' && Number.isFinite(data.aspect_ratio) && data.aspect_ratio > 0
        ? data.aspect_ratio
        : null,
  };
}

export async function uploadChatImageMessage(
  imageUri: string,
  mimeType: string | null | undefined,
  matchId: string,
): Promise<string> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const formData = new FormData();
  formData.append('context', 'chat');
  formData.append('match_id', matchId);
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
    headers: { Authorization: `Bearer ${accessToken}` },
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
