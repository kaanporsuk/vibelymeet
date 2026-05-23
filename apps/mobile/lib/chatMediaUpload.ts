/**
 * Chat image and voice upload helpers.
 * Chat Vibe Clips upload through Bunny Stream TUS via `chatVibeClipStreamUpload`.
 */

import { getCachedAccessToken } from '@/lib/nativeAuthSession';
import {
  prepareImageDerivativeAssetsForUpload,
  prepareProfilePhotoAssetForUpload,
  type PreparedImageDerivativeAsset,
} from '@/lib/imageAssetNormalize';
import { rememberImageDerivatives } from '@/lib/imageUrl';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const GENERIC_UPLOAD_MIME_TYPE = 'application/octet-stream';

export type UploadChatStorageResult = {
  path: string;
  url: string | null;
  assetId: string | null;
  contentSha256: string | null;
  receiptId: string | null;
  sessionId: string | null;
  derivatives?: { thumb?: string; display?: string; hero?: string } | null;
};

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

function derivativeFormField(kind: PreparedImageDerivativeAsset['kind']): 'derivative_thumb' | 'derivative_display' | 'derivative_hero' {
  if (kind === 'thumb') return 'derivative_thumb';
  if (kind === 'display') return 'derivative_display';
  return 'derivative_hero';
}

/**
 * @deprecated Use uploadVoiceWithMediaSdk so durable queueing, reconciliation,
 * and receipt telemetry remain active. This remains as the SDK delegate.
 */
export async function uploadVoiceMessage(
  audioUri: string,
  matchId: string,
  clientRequestId?: string,
): Promise<UploadChatStorageResult> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const formData = new FormData();
  formData.append('conversation_id', matchId);
  const stableClientRequestId = clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append('client_request_id', stableClientRequestId);
  }
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(stableClientRequestId ? { 'x-client-request-id': stableClientRequestId } : {}),
    },
    body: formData,
  });

  const text = await res.text().catch(() => '');
  let data: {
    success?: boolean;
    path?: string;
    url?: string | null;
    assetId?: string | null;
    contentSha256?: string | null;
    receiptId?: string | null;
    sessionId?: string | null;
    error?: string;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || 'Voice upload failed');
  }
  const mediaRef = typeof data.path === 'string' && data.path ? data.path : data.url;
  if (!res.ok || !data.success || !mediaRef) {
    throw new Error(data.error || `Upload failed with status ${res.status}`);
  }
  return {
    path: mediaRef,
    url: data.url ?? null,
    assetId: data.assetId ?? null,
    contentSha256: data.contentSha256 ?? null,
    receiptId: data.receiptId ?? null,
    sessionId: data.sessionId ?? null,
  };
}

/**
 * @deprecated Use uploadChatImageWithMediaSdk so durable queueing,
 * reconciliation, and receipt telemetry remain active. This remains as the SDK
 * delegate.
 */
export async function uploadChatImageMessage(
  imageUri: string,
  mimeType: string | null | undefined,
  matchId: string,
  clientRequestId?: string,
): Promise<UploadChatStorageResult> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[chatMediaUpload] EXPO_PUBLIC_SUPABASE_URL is not set.');
  }

  const stableClientRequestId = clientRequestId?.trim();
  const normalizedMimeType = normalizedImageMimeType(mimeType, imageUri);
  const ext =
    normalizedMimeType.includes('png') ? 'png' :
    normalizedMimeType.includes('webp') ? 'webp' :
    normalizedMimeType.includes('heic') || normalizedMimeType.includes('heif') ? 'heic' :
    normalizedMimeType === GENERIC_UPLOAD_MIME_TYPE ? (extensionFromUri(imageUri) ?? 'bin') :
    'jpg';
  const prepared = await prepareProfilePhotoAssetForUpload({
    uri: imageUri,
    mimeType: normalizedMimeType,
    fileName: `chat-image.${ext}`,
  });
  let derivatives: PreparedImageDerivativeAsset[] = [];
  let res: Response;
  try {
    derivatives = await prepareImageDerivativeAssetsForUpload(prepared).catch(() => []);
    const formData = new FormData();
    formData.append('context', 'chat');
    formData.append('match_id', matchId);
    if (stableClientRequestId) {
      formData.append('client_request_id', stableClientRequestId);
    }
    formData.append(
      'file',
      {
        uri: prepared.uri,
        type: prepared.mimeType,
        name: prepared.fileName,
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

    res = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(stableClientRequestId ? { 'x-client-request-id': stableClientRequestId } : {}),
      },
      body: formData,
    });
  } finally {
    for (const derivative of derivatives) derivative.cleanup();
    prepared.cleanup?.();
  }

  const text = await res.text().catch(() => '');
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
    throw new Error('Image upload failed');
  }
  if (!res.ok || !data.success || !data.path) {
    throw new Error(data.error || `Upload failed with status ${res.status}`);
  }
  rememberImageDerivatives(data.path, data.derivatives);

  return {
    path: data.path,
    url: data.url ?? null,
    assetId: data.assetId ?? null,
    contentSha256: data.contentSha256 ?? null,
    receiptId: data.receiptId ?? null,
    sessionId: data.sessionId ?? null,
    derivatives: data.derivatives ?? null,
  };
}
