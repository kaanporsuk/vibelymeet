/**
 * Vibe video: create-video-upload (get tus credentials), tus upload to Bunny, delete-vibe-video.
 * Same backend contract as web. Profiles: bunny_video_uid, bunny_video_status (none | uploading | processing | ready | failed).
 */

import * as tus from 'tus-js-client';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export type VibeVideoStatus = 'none' | 'uploading' | 'processing' | 'ready' | 'failed';

export async function getCreateVideoUploadCredentials(): Promise<{
  videoId: string;
  libraryId: number;
  expirationTime: number;
  signature: string;
  cdnHostname: string;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-video-upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? 'Failed to get upload credentials');
  return {
    videoId: data.videoId,
    libraryId: data.libraryId,
    expirationTime: data.expirationTime,
    signature: data.signature,
    cdnHostname: data.cdnHostname,
  };
}

/**
 * Upload video file (local URI) to Bunny via tus using credentials from create-video-upload.
 * In RN we need to get a Blob from the file URI (fetch works for file:// in many RN environments).
 */
export async function uploadVibeVideoToBunny(
  videoUri: string,
  credentials: Awaited<ReturnType<typeof getCreateVideoUploadCredentials>>,
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void
): Promise<void> {
  const response = await fetch(videoUri);
  const blob = await response.blob();
  const mimeType = blob.type || 'video/mp4';

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: 'https://video.bunnycdn.com/tusupload',
      retryDelays: [0, 3000, 5000, 10000],
      chunkSize: 2 * 1024 * 1024,
      headers: {
        AuthorizationSignature: credentials.signature,
        AuthorizationExpire: String(credentials.expirationTime),
        VideoId: credentials.videoId,
        LibraryId: String(credentials.libraryId),
      },
      metadata: {
        filetype: mimeType,
        title: `vibe-video-${Date.now()}`,
      },
      onError: reject,
      onProgress: onProgress ? (bytesUploaded, bytesTotal) => onProgress(bytesUploaded, bytesTotal) : undefined,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

/**
 * After a successful tus upload, persist Bunny video id + processing status on the profile
 * (same as web `VibeStudioModal` handleUpload). Required for playback + webhooks.
 */
export async function saveVibeVideoToProfile(
  videoId: string,
  options?: { vibeCaption?: string | null }
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const payload: Record<string, unknown> = {
    bunny_video_uid: videoId,
    bunny_video_status: 'processing',
  };
  if (options && 'vibeCaption' in options) {
    payload.vibe_caption = options.vibeCaption ?? null;
  }

  const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
  if (error) throw error;
}

export async function deleteVibeVideo(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-vibe-video`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const data = await res.json();
  if (!data.success && data.error && !data.message?.includes('No video')) throw new Error(data.error);
}
