/**
 * Upload a profile photo via the upload-image Edge Function (same contract as web).
 * Returns the storage path (e.g. photos/{userId}/{timestamp}.jpg) to store in profiles.photos.
 */

import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export type UploadImageResult = { path: string };

export interface ImagePickerAsset {
  uri: string;
  mimeType?: string;
  fileName?: string;
}

/**
 * Upload an image from a local URI (e.g. from expo-image-picker) to Bunny via upload-image EF.
 * @param asset - { uri, mimeType?, fileName? } from picker
 * @param oldPath - optional existing path to replace (EF may delete old file)
 */
export async function uploadProfilePhoto(
  asset: ImagePickerAsset,
  oldPath?: string | null,
  context?: 'onboarding' | 'profile_studio',
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[uploadImage] EXPO_PUBLIC_SUPABASE_URL is not set. Check your .env file.');
  }

  const formData = new FormData();
  formData.append(
    'file',
    {
      uri: asset.uri,
      type: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    } as unknown as Blob
  );
  if (oldPath) {
    formData.append('old_path', oldPath);
  }
  if (context) {
    formData.append('context', context);
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: formData,
  });

  const text = await res.text();
  let data: { success?: boolean; path?: string; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Upload service unavailable. Please try again.');
  }

  if (!data.success || !data.path) {
    throw new Error(data.error ?? 'Image upload failed');
  }

  return data.path;
}
