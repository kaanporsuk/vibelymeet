/**
 * Chat media upload: upload-voice and upload-chat-video Edge Functions.
 * Same contract as web (voiceUploadService, chatVideoUploadService).
 * Returns CDN URL to store in messages.audio_url or messages.video_url.
 */

import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export async function uploadVoiceMessage(audioUri: string, matchId: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

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
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(errorText || `Upload failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !data.url) throw new Error(data.error ?? 'Voice upload failed');
  return data.url;
}

export async function uploadChatVideoMessage(
  videoUri: string,
  matchId: string,
  mimeType: string = 'video/mp4'
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const formData = new FormData();
  formData.append('match_id', matchId);
  const ext = mimeType.includes('quicktime') || mimeType.includes('x-m4v') ? 'mov' : 'mp4';
  formData.append(
    'file',
    {
      uri: videoUri,
      type: mimeType || 'video/mp4',
      name: `chat-video.${ext}`,
    } as unknown as Blob
  );

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-chat-video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(errorText || `Upload failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !data.url) throw new Error(data.error ?? 'Video upload failed');
  return data.url;
}
