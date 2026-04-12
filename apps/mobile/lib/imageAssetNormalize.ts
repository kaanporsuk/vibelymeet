/**
 * Normalize expo image-picker / document assets before multipart upload.
 * Avoids defaulting unknown types to JPEG when the bytes are HEIC/PNG/etc.
 *
 * Profile photos: `prepareProfilePhotoAssetForUpload` re-encodes HEIC/HEIF to JPEG for web-safe storage
 * (see `proofSelfiePrepareUpload` pattern); other rasters pass through unchanged.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset as ExpoImagePickerAsset } from 'expo-image-picker';

export type NormalizedImageAsset = {
  uri: string;
  mimeType: string;
  fileName: string;
};

/** Result of HEIC→JPEG normalization; call `cleanup` after upload completes. */
export type PreparedProfilePhotoAsset = NormalizedImageAsset & {
  cleanup?: () => void;
};

const PROFILE_JPEG_QUALITY = 0.88;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function extFromUri(uri: string): string | null {
  const q = uri.split('?')[0] ?? uri;
  const i = q.lastIndexOf('.');
  if (i < 0 || i >= q.length - 1) return null;
  return q.slice(i + 1).toLowerCase().trim();
}

function extFromFileName(fileName: string): string | null {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return extFromUri(base);
}

function inferMimeFromUri(uri: string): string | undefined {
  const ext = extFromUri(uri);
  if (!ext) return undefined;
  return MIME_BY_EXT[ext];
}

/**
 * Picks a stable filename segment for multipart (Edge Function uses File.type for validation).
 */
export function normalizeImageAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}): NormalizedImageAsset {
  const uri = asset.uri?.trim() ?? '';
  const rawMime = (asset.mimeType ?? '').trim().toLowerCase();
  const inferred = inferMimeFromUri(uri);
  let mime = rawMime || inferred || 'image/jpeg';

  if (mime === 'image/jpg') mime = 'image/jpeg';

  const allowed = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ]);
  if (!allowed.has(mime)) {
    mime = inferred && allowed.has(inferred) ? inferred : 'image/jpeg';
  }

  const ext =
    mime === 'image/png' ? 'png' :
    mime === 'image/webp' ? 'webp' :
    mime === 'image/heic' || mime === 'image/heif' ? 'heic' :
    'jpg';

  let fileName = asset.fileName?.trim();
  if (!fileName) {
    fileName = `photo-${Date.now()}.${ext}`;
  } else if (!/\.[a-z0-9]+$/i.test(fileName)) {
    fileName = `${fileName}.${ext}`;
  }

  return { uri, mimeType: mime, fileName };
}

export function normalizePickerAssetForUpload(
  asset: Pick<ExpoImagePickerAsset, 'uri' | 'mimeType' | 'fileName'>,
): NormalizedImageAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  return normalizeImageAssetForUpload({
    uri,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
  });
}

export function normalizeDocumentAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
}): NormalizedImageAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  const rawMime = (asset.mimeType ?? 'image/jpeg').trim().toLowerCase();
  if (!rawMime.startsWith('image/')) return null;
  return normalizeImageAssetForUpload({
    uri,
    mimeType: rawMime,
    fileName: asset.name,
  });
}

function isHeicOrHeifNormalized(asset: NormalizedImageAsset): boolean {
  const mime = asset.mimeType.toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  const extName = extFromFileName(asset.fileName);
  const extUri = extFromUri(asset.uri);
  return extName === 'heic' || extName === 'heif' || extUri === 'heic' || extUri === 'heif';
}

function jpgFileNameFromNormalized(asset: NormalizedImageAsset): string {
  const raw = asset.fileName.trim();
  const base = raw.replace(/\.[^.]+$/i, '') || `photo-${Date.now()}`;
  const safe = base.replace(/[^\w.-]+/g, '_') || 'photo';
  return `${safe}.jpg`;
}

/**
 * Ensures profile-photo uploads are browser-safe rasters: HEIC/HEIF (by MIME or extension) is
 * re-encoded to JPEG; JPEG/PNG/WebP are unchanged.
 */
export async function prepareProfilePhotoAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<PreparedProfilePhotoAsset> {
  const normalized = normalizeImageAssetForUpload(asset);
  if (!isHeicOrHeifNormalized(normalized)) {
    return normalized;
  }

  const manipulated = await manipulateAsync(
    normalized.uri,
    [],
    { compress: PROFILE_JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  const outUri = manipulated.uri;
  const fileName = jpgFileNameFromNormalized(normalized);

  const cleanup = () => {
    void FileSystem.deleteAsync(outUri, { idempotent: true }).catch(() => {});
  };

  return {
    uri: outUri,
    mimeType: 'image/jpeg',
    fileName,
    cleanup,
  };
}
