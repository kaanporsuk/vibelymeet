/**
 * Native proof-selfie upload: deterministic bytes for Supabase Storage.
 *
 * Root issue: `fetch(\`data:...;base64,...\`).blob()` often returns a **0-byte Blob** on Hermes/RN
 * even when base64 is valid — uploads then persist empty objects.
 *
 * Flow: ImagePicker URI → expo-image-manipulator (JPEG on disk) → FileSystem base64 → atob → ArrayBuffer → upload.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const LOG_PREFIX = '[proof-selfie]';

function log(stage: string, data: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.warn(LOG_PREFIX, stage, data);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const normalized = b64.replace(/\s/g, '');
  const globalAtob =
    typeof globalThis !== 'undefined' && typeof (globalThis as { atob?: (s: string) => string }).atob === 'function'
      ? (globalThis as { atob: (s: string) => string }).atob
      : undefined;
  if (!globalAtob) {
    throw new Error('atob is not available; cannot decode proof selfie');
  }
  const binaryString = globalAtob(normalized);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export type ProofSelfieUploadPayload = {
  body: ArrayBuffer;
  contentType: 'image/jpeg';
  /** Delete normalized temp file (call after upload attempt). */
  cleanup: () => void;
};

/**
 * Produces non-empty JPEG bytes for `proof-selfies` upload.
 * @param sourceUri — ImagePicker asset URI (`file://`, `ph://`, `content://`, etc.)
 */
export async function prepareProofSelfieUploadPayload(sourceUri: string): Promise<ProofSelfieUploadPayload> {
  const trimmed = sourceUri.trim();
  if (!trimmed) {
    throw new Error('Missing selfie URI');
  }

  log('source_uri', { uri: trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : '') });

  let infoBefore: FileSystem.FileInfo;
  try {
    infoBefore = await FileSystem.getInfoAsync(trimmed);
  } catch (e) {
    log('fs_getInfo_source_error', { message: e instanceof Error ? e.message : String(e) });
    throw new Error('Could not read selfie file info');
  }
  log('fs_info_source', {
    exists: infoBefore.exists,
    isDirectory: 'isDirectory' in infoBefore ? infoBefore.isDirectory : undefined,
    size: 'size' in infoBefore ? infoBefore.size : undefined,
  });

  if (!infoBefore.exists || ('isDirectory' in infoBefore && infoBefore.isDirectory)) {
    throw new Error('Selfie file not found');
  }

  /** Re-encode to a real JPEG on disk (handles ph:// / content:// / HEIC; avoids Hermes data-URI Blob bug). */
  const manipulated = await manipulateAsync(
    trimmed,
    [],
    { compress: 0.88, format: SaveFormat.JPEG },
  );

  const outUri = manipulated.uri;
  log('manipulate_done', {
    uri: outUri.slice(0, 100) + (outUri.length > 100 ? '…' : ''),
    width: manipulated.width,
    height: manipulated.height,
  });

  const infoOut = await FileSystem.getInfoAsync(outUri);
  log('fs_info_normalized', {
    exists: infoOut.exists,
    size: 'size' in infoOut ? infoOut.size : undefined,
  });

  if ('size' in infoOut && typeof infoOut.size === 'number' && infoOut.size === 0) {
    throw new Error('Normalized selfie file is 0 bytes');
  }

  const base64 = await FileSystem.readAsStringAsync(outUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  log('base64_read', { length: base64.length });

  if (!base64 || base64.length < 32) {
    throw new Error('Selfie base64 read was empty or too short');
  }

  const body = base64ToArrayBuffer(base64);
  log('payload_arraybuffer', { byteLength: body.byteLength });

  if (body.byteLength === 0) {
    throw new Error('Proof selfie payload is 0 bytes after decode');
  }

  const cleanup = () => {
    void FileSystem.deleteAsync(outUri, { idempotent: true }).catch(() => {});
  };

  return { body, contentType: 'image/jpeg', cleanup };
}
