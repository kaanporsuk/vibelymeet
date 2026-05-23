/**
 * Upload a profile photo via the upload-image Edge Function (same contract as web).
 * Returns storage path + draft session id for reconciliation.
 */

import {
  prepareImageDerivativeAssetsForUpload,
  prepareProfilePhotoAssetForUpload,
  type NormalizedImageAsset,
} from '@/lib/imageAssetNormalize';
import { rememberImageDerivatives } from '@/lib/imageUrl';
import { getCachedAccessToken } from '@/lib/nativeAuthSession';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export type UploadImageResult = {
  path: string;
  sessionId: string | null;
  url?: string | null;
  assetId?: string | null;
  contentSha256?: string | null;
  receiptId?: string | null;
  derivatives?: { thumb?: string; display?: string; hero?: string } | null;
};

export interface ImagePickerAsset {
  uri: string;
  mimeType?: string;
  fileName?: string;
  width?: number | null;
  height?: number | null;
}

function derivativeFormField(kind: 'thumb' | 'display' | 'hero'): 'derivative_thumb' | 'derivative_display' | 'derivative_hero' {
  if (kind === 'thumb') return 'derivative_thumb';
  if (kind === 'display') return 'derivative_display';
  return 'derivative_hero';
}

/**
 * @deprecated Use uploadProfilePhotoWithMediaSdk so durable queueing,
 * reconciliation, and receipt telemetry remain active. This remains as the SDK
 * delegate.
 */
export async function uploadProfilePhoto(
  asset: ImagePickerAsset | NormalizedImageAsset,
  context?: 'onboarding' | 'profile_studio',
  options?: { signal?: AbortSignal; clientRequestId?: string },
): Promise<UploadImageResult> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[uploadImage] EXPO_PUBLIC_SUPABASE_URL is not set. Check your .env file.');
  }

  const prepared = await prepareProfilePhotoAssetForUpload(asset);
  const derivatives = await prepareImageDerivativeAssetsForUpload(prepared).catch(() => []);
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
    for (const derivative of derivatives) {
      formData.append(
        derivativeFormField(derivative.kind),
        {
          uri: derivative.uri,
          type: derivative.mimeType,
          name: derivative.fileName,
        } as unknown as Blob,
      );
    }
    if (context) {
      formData.append('context', context);
    }
    const stableClientRequestId = options?.clientRequestId?.trim();
    if (stableClientRequestId) {
      formData.append('client_request_id', stableClientRequestId);
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(stableClientRequestId ? { 'x-client-request-id': stableClientRequestId } : {}),
      },
      body: formData,
      signal: options?.signal,
    });

    const text = await res.text();
    let data: {
      success?: boolean;
      path?: string;
      url?: string | null;
      assetId?: string | null;
      contentSha256?: string | null;
      receiptId?: string | null;
      sessionId?: string | null;
      derivatives?: { thumb?: string; display?: string; hero?: string } | null;
      error?: string;
    };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Upload service unavailable. Please try again.');
    }

    if (!data.success || !data.path) {
      throw new Error(data.error ?? 'Image upload failed');
    }

    rememberImageDerivatives(data.path, data.derivatives);

    return {
      path: data.path,
      sessionId: data.sessionId ?? null,
      url: data.url ?? null,
      assetId: data.assetId ?? null,
      contentSha256: data.contentSha256 ?? null,
      receiptId: data.receiptId ?? null,
      derivatives: data.derivatives ?? null,
    };
  } finally {
    for (const derivative of derivatives) derivative.cleanup();
    prepared.cleanup?.();
  }
}
