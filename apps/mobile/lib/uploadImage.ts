/**
 * Upload a profile photo via the upload-image Edge Function (same contract as web).
 * Returns storage path + draft session id for reconciliation.
 */

import { prepareProfilePhotoAssetForUpload, type NormalizedImageAsset } from '@/lib/imageAssetNormalize';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export type UploadImageResult = { path: string; sessionId: string | null };

export interface ImagePickerAsset {
  uri: string;
  mimeType?: string;
  fileName?: string;
}

/**
 * Upload an image from a local URI (e.g. from expo-image-picker) to Bunny via upload-image EF.
 * Superseded committed photos are reconciled later by final publish, not during staged upload.
 */
export async function uploadProfilePhoto(
  asset: ImagePickerAsset | NormalizedImageAsset,
  context?: 'onboarding' | 'profile_studio',
  options?: { signal?: AbortSignal },
): Promise<UploadImageResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[uploadImage] EXPO_PUBLIC_SUPABASE_URL is not set. Check your .env file.');
  }

  const prepared = await prepareProfilePhotoAssetForUpload(asset);
  try {
    const formData = new FormData();
    formData.append(
      'file',
      {
        uri: prepared.uri,
        type: prepared.mimeType ?? 'image/jpeg',
        name: prepared.fileName ?? `photo-${Date.now()}.jpg`,
      } as unknown as Blob,
    );
    if (context) {
      formData.append('context', context);
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
      signal: options?.signal,
    });

    const text = await res.text();
    let data: { success?: boolean; path?: string; sessionId?: string | null; error?: string };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Upload service unavailable. Please try again.');
    }

    if (!data.success || !data.path) {
      throw new Error(data.error ?? 'Image upload failed');
    }

    return {
      path: data.path,
      sessionId: data.sessionId ?? null,
    };
  } finally {
    prepared.cleanup?.();
  }
}
