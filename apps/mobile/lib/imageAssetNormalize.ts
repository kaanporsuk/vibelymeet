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
  width?: number | null;
  height?: number | null;
};

/** Result of HEIC→JPEG normalization; call `cleanup` after upload completes. */
export type PreparedProfilePhotoAsset = NormalizedImageAsset & {
  cleanup?: () => void;
};

export type PreparedImageDerivativeAsset = {
  kind: 'thumb' | 'hero';
  uri: string;
  mimeType: 'image/jpeg';
  fileName: string;
  cleanup: () => void;
};

const PROFILE_JPEG_QUALITY = 0.88;
const PROFILE_PHOTO_MAX_EDGE = 2048;
const IMAGE_DERIVATIVE_QUALITY = 0.84;

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

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Picks a stable filename segment for multipart (Edge Function uses File.type for validation).
 */
export function normalizeImageAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
}): NormalizedImageAsset {
  const uri = asset.uri?.trim() ?? '';
  const rawMime = (asset.mimeType ?? '').trim().toLowerCase();
  const inferred = inferMimeFromUri(uri);
  let mime = rawMime || inferred || 'application/octet-stream';

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
    mime = inferred && allowed.has(inferred) ? inferred : 'application/octet-stream';
  }

  const inferredExt = extFromUri(uri);
  const ext =
    mime === 'image/png' ? 'png' :
    mime === 'image/webp' ? 'webp' :
    mime === 'image/heic' || mime === 'image/heif' ? 'heic' :
    mime === 'application/octet-stream' && inferredExt && MIME_BY_EXT[inferredExt] ? inferredExt :
    mime === 'application/octet-stream' ? 'bin' :
    'jpg';

  let fileName = asset.fileName?.trim();
  if (!fileName) {
    fileName = `photo-${Date.now()}.${ext}`;
  } else if (!/\.[a-z0-9]+$/i.test(fileName)) {
    fileName = `${fileName}.${ext}`;
  }

  return {
    uri,
    mimeType: mime,
    fileName,
    width: finitePositiveNumber(asset.width),
    height: finitePositiveNumber(asset.height),
  };
}

export function normalizePickerAssetForUpload(
  asset: Pick<ExpoImagePickerAsset, 'uri' | 'mimeType' | 'fileName' | 'width' | 'height'>,
): NormalizedImageAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  return normalizeImageAssetForUpload({
    uri,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
  });
}

export function normalizeDocumentAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
}): NormalizedImageAsset | null {
  const uri = asset.uri?.trim();
  if (!uri) return null;
  const rawMime = (asset.mimeType ?? '').trim().toLowerCase();
  if (rawMime && !rawMime.startsWith('image/')) return null;
  return normalizeImageAssetForUpload({
    uri,
    mimeType: rawMime || undefined,
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

function derivativeJpgFileNameFromNormalized(asset: NormalizedImageAsset, kind: PreparedImageDerivativeAsset['kind']): string {
  const raw = asset.fileName.trim();
  const base = raw.replace(/\.[^.]+$/i, '') || `photo-${Date.now()}`;
  const safe = base.replace(/[^\w.-]+/g, '_') || 'photo';
  return `${safe}-${kind}.jpg`;
}

function resizeActionsForProfilePhoto(asset: NormalizedImageAsset): Parameters<typeof manipulateAsync>[1] {
  const width = finitePositiveNumber(asset.width);
  const height = finitePositiveNumber(asset.height);

  if (width && height) {
    if (Math.max(width, height) <= PROFILE_PHOTO_MAX_EDGE) return [];
    return width >= height
      ? [{ resize: { width: PROFILE_PHOTO_MAX_EDGE } }]
      : [{ resize: { height: PROFILE_PHOTO_MAX_EDGE } }];
  }

  return [{ resize: { width: PROFILE_PHOTO_MAX_EDGE } }];
}

function resizeActionsForMaxEdge(asset: NormalizedImageAsset, maxEdge: number): Parameters<typeof manipulateAsync>[1] {
  const width = finitePositiveNumber(asset.width);
  const height = finitePositiveNumber(asset.height);
  if (!width || !height) return [{ resize: { width: maxEdge } }];
  if (Math.max(width, height) <= maxEdge) return [];
  return width >= height ? [{ resize: { width: maxEdge } }] : [{ resize: { height: maxEdge } }];
}

export async function prepareImageDerivativeAssetsForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<PreparedImageDerivativeAsset[]> {
  const normalized = normalizeImageAssetForUpload(asset);
  const specs: Array<{ kind: PreparedImageDerivativeAsset['kind']; maxEdge: number; compress: number }> = [
    { kind: 'thumb', maxEdge: 420, compress: 0.78 },
    { kind: 'hero', maxEdge: 1400, compress: IMAGE_DERIVATIVE_QUALITY },
  ];
  const derivatives: PreparedImageDerivativeAsset[] = [];
  for (const spec of specs) {
    try {
      const manipulated = await manipulateAsync(
        normalized.uri,
        resizeActionsForMaxEdge(normalized, spec.maxEdge),
        { compress: spec.compress, format: SaveFormat.JPEG },
      );
      const outUri = manipulated.uri;
      derivatives.push({
        kind: spec.kind,
        uri: outUri,
        mimeType: 'image/jpeg',
        fileName: derivativeJpgFileNameFromNormalized(normalized, spec.kind),
        cleanup: () => {
          void FileSystem.deleteAsync(outUri, { idempotent: true }).catch(() => {});
        },
      });
    } catch {
      // Derivatives are acceleration-only; the caller must still upload the canonical image.
    }
  }
  if (derivatives.length === specs.length) return derivatives;
  for (const derivative of derivatives) derivative.cleanup();
  return [];
}

/**
 * Ensures profile-photo uploads are browser-safe rasters: HEIC/HEIF (by MIME or extension) is
 * re-encoded to JPEG; JPEG/PNG/WebP are unchanged.
 */
export async function prepareProfilePhotoAssetForUpload(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<PreparedProfilePhotoAsset> {
  const normalized = normalizeImageAssetForUpload(asset);
  if (!isHeicOrHeifNormalized(normalized)) {
    return normalized;
  }

  const manipulated = await manipulateAsync(
    normalized.uri,
    resizeActionsForProfilePhoto(normalized),
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
    width: finitePositiveNumber(manipulated.width) ?? normalized.width,
    height: finitePositiveNumber(manipulated.height) ?? normalized.height,
    cleanup,
  };
}
