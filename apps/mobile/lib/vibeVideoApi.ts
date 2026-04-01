/**
 * Vibe video: create-video-upload (get tus credentials), tus upload to Bunny, delete-vibe-video.
 * Same backend contract as web. Profiles: bunny_video_uid, bunny_video_status (none | uploading | processing | ready | failed).
 */

import * as tus from 'tus-js-client';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { getVibeVideoPlaybackUrl, persistStreamCdnHostnameFromEdge } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose, vibeVideoDiagProdHint } from '@/lib/vibeVideoDiagnostics';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const TUS_CHUNK_SIZE = 5 * 1024 * 1024;

function getProjectRefFromSupabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const first = host.split('.')[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

export type VibeVideoUploadSource = 'camera' | 'library' | 'drawer' | 'unknown';

export type VibeVideoStatus = 'none' | 'uploading' | 'processing' | 'ready' | 'failed';

export type CreateVideoUploadCredentials = {
  videoId: string;
  libraryId: number;
  expirationTime: number;
  signature: string;
  cdnHostname: string | undefined;
  sessionId: string | null;
};

async function readJsonBody(res: Response): Promise<{ ok: boolean; data: unknown; rawText: string }> {
  const rawText = await res.text();
  if (!rawText.trim()) {
    return { ok: false, data: null, rawText: '' };
  }
  try {
    return { ok: true, data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    vibeVideoDiagVerbose('edge.non_json', {
      status: res.status,
      snippet: rawText.slice(0, 200),
    });
    return { ok: false, data: null, rawText };
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function pickString(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function pickNumber(r: Record<string, unknown>, key: string): number | undefined {
  const v = r[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function extensionFromFileUri(fileUri: string): string {
  const pathOnly = fileUri.split('?')[0].split('#')[0];
  const lastSeg = pathOnly.split('/').pop() ?? '';
  const dot = lastSeg.lastIndexOf('.');
  if (dot < 0 || dot === lastSeg.length - 1) return '';
  return lastSeg.slice(dot + 1).toLowerCase();
}

function mimeFromExtension(extension: string): string {
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  return 'video/mp4';
}

async function resolveStableUploadUri(
  videoUri: string,
  uploadSource: VibeVideoUploadSource,
): Promise<{ fileUri: string; copiedToCache: boolean }> {
  const trimmed = videoUri.trim();
  if (!trimmed) {
    throw new Error('Empty video URI');
  }

  vibeVideoDiagVerbose('upload.prepare.start', {
    source: uploadSource,
    uriScheme: trimmed.includes(':') ? trimmed.split(':')[0] : 'path',
  });

  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) {
    vibeVideoDiagVerbose('upload.prepare.no_cache_dir', {});
    return { fileUri: trimmed, copiedToCache: false };
  }

  const extGuess = /\.mov$/i.test(trimmed) ? 'mov' : 'mp4';
  const dest = `${cacheRoot}vibe-tus-${Date.now()}.${extGuess}`;

  try {
    await FileSystem.copyAsync({ from: trimmed, to: dest });
    vibeVideoDiagVerbose('upload.prepare.copied', { destTail: dest.slice(-40) });
    return { fileUri: dest, copiedToCache: true };
  } catch (e) {
    vibeVideoDiagVerbose('upload.prepare.copy_failed', {
      message: e instanceof Error ? e.message : String(e),
      fallbackUri: true,
    });
    return { fileUri: trimmed, copiedToCache: false };
  }
}

async function deleteLocalFileQuiet(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* ignore */
  }
}

export async function getCreateVideoUploadCredentials(
  options?: { context?: 'onboarding' | 'profile_studio' },
): Promise<CreateVideoUploadCredentials> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const url = `${SUPABASE_URL}/functions/v1/create-video-upload`;
  const projectRef = getProjectRefFromSupabaseUrl(SUPABASE_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ context: options?.context ?? 'profile_studio' }),
    });
  } catch (e) {
    vibeVideoDiagVerbose('create-upload.network', { message: e instanceof Error ? e.message : String(e) });
    throw new Error('Network error while starting upload. Check your connection and try again.');
  }

  const { ok: jsonOk, data, rawText } = await readJsonBody(res);

  if (!jsonOk || !isRecord(data)) {
    vibeVideoDiagVerbose('create-upload.invalid_payload_shape', {
      status: res.status,
      projectRef,
    });
    throw new Error(
      res.ok
        ? 'Invalid response from video service. Please try again.'
        : `Video service error (${res.status}). Please try again.`,
    );
  }

  const success = data.success === true;
  const errMsg = pickString(data, 'error') ?? pickString(data, 'message');

  if (!res.ok) {
    vibeVideoDiagVerbose('create-upload.http_error', { status: res.status, success, error: errMsg, rawSnippet: rawText.slice(0, 300) });
    throw new Error(errMsg ?? `Video service error (${res.status}). Please try again.`);
  }

  if (!success) {
    vibeVideoDiagVerbose('create-upload.success_false', { error: errMsg, rawSnippet: rawText.slice(0, 300) });
    throw new Error(errMsg ?? 'Could not start video upload. Please try again.');
  }

  const videoId = pickString(data, 'videoId');
  const signature = pickString(data, 'signature');
  const libraryId = pickNumber(data, 'libraryId');
  const expirationTime = pickNumber(data, 'expirationTime');
  const cdnHostname = pickString(data, 'cdnHostname');

  if (!videoId) {
    vibeVideoDiagVerbose('create-upload.missing_videoId', { keys: Object.keys(data) });
    throw new Error('Video service returned an incomplete response. Please try again.');
  }
  if (!signature) {
    vibeVideoDiagVerbose('create-upload.missing_signature', { videoId });
    throw new Error('Video service returned an incomplete response. Please try again.');
  }
  if (libraryId == null) {
    vibeVideoDiagVerbose('create-upload.missing_libraryId', { videoId });
    throw new Error('Video service returned an incomplete response. Please try again.');
  }
  if (expirationTime == null) {
    vibeVideoDiagVerbose('create-upload.missing_expirationTime', { videoId });
    throw new Error('Video service returned an incomplete response. Please try again.');
  }

  if (cdnHostname) {
    await persistStreamCdnHostnameFromEdge(cdnHostname);
  } else {
    vibeVideoDiagVerbose('create-upload.missing_cdnHostname', {
      videoId,
      hint: 'Playback may still work if EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME is set.',
    });
  }

  vibeVideoDiagVerbose('create-upload.ok', {
    videoId,
    libraryId,
    hasCdnHostname: !!cdnHostname,
    projectRef,
  });

  const sessionId = pickString(data, 'sessionId') ?? null;

  return {
    videoId,
    libraryId,
    expirationTime,
    signature,
    cdnHostname,
    sessionId,
  };
}

/**
 * Upload video file (local URI) to Bunny via tus using credentials from create-video-upload.
 * Reads the full file as Base64 via expo-file-system, converts to Blob, then TUS upload.
 */
export function uploadVibeVideoToBunny(
  videoUri: string,
  credentials: CreateVideoUploadCredentials,
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void,
  options?: { signal?: AbortSignal; uploadSource?: VibeVideoUploadSource },
): Promise<void> {
  return (async () => {
    const uploadSource = options?.uploadSource ?? 'unknown';
    const signal = options?.signal;
    if (signal?.aborted) {
      throw Object.assign(new Error('Upload cancelled'), { name: 'AbortError' });
    }

    const { fileUri, copiedToCache } = await resolveStableUploadUri(videoUri, uploadSource);

    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists || fileInfo.isDirectory) {
      throw new Error(`Video file does not exist at path: ${fileUri}`);
    }
    const fileSize = fileInfo.size;
    if (!fileSize || fileSize === 0) {
      throw new Error('Video file is empty or size could not be determined');
    }

    const extension = extensionFromFileUri(fileUri);
    const mimeType = mimeFromExtension(extension);
    const fileName =
      fileUri.split('/').pop()?.split('?')[0] ?? `vibe-video.${extension || 'mp4'}`;

    vibeVideoDiagVerbose('upload.file.validated', {
      uri: fileUri,
      extension,
      mimeType,
      sizeBytes: fileSize,
      sizeMB: (fileSize / (1024 * 1024)).toFixed(2),
    });

    // Read entire file as base64 via expo-file-system (reliable native read)
    vibeVideoDiagVerbose('upload.read_file.start', { uri: fileUri, sizeBytes: fileSize });
    let blob: Blob;
    try {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      vibeVideoDiagVerbose('upload.read_file.base64_ok', {
        base64Length: base64.length,
        expectedRatio: (base64.length / fileSize).toFixed(2),
      });
      // Convert base64 → blob via data URI (standard RN-compatible approach)
      const response = await fetch(`data:${mimeType};base64,${base64}`);
      blob = await response.blob();
      vibeVideoDiagVerbose('upload.read_file.blob_ok', {
        blobSize: blob.size,
        blobType: blob.type,
        matchesFileSize: blob.size === fileSize,
      });
      if (blob.size === 0) {
        throw new Error('Blob conversion produced empty result');
      }
      // Sanity check: blob size should approximately equal file size
      // (data URI decode should be exact, but log a warning if off)
      if (Math.abs(blob.size - fileSize) > 1024) {
        vibeVideoDiagVerbose('upload.read_file.size_mismatch_warning', {
          blobSize: blob.size,
          fileSize,
          diff: blob.size - fileSize,
        });
      }
    } catch (e) {
      vibeVideoDiagVerbose('upload.read_file.failed', {
        message: e instanceof Error ? e.message : String(e),
      });
      throw new Error('Failed to read video file for upload');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(blob, {
          endpoint: 'https://video.bunnycdn.com/tusupload',
          retryDelays: [0, 3000, 5000, 10000],
          chunkSize: TUS_CHUNK_SIZE,
          headers: {
            AuthorizationSignature: credentials.signature,
            AuthorizationExpire: String(credentials.expirationTime),
            VideoId: credentials.videoId,
            LibraryId: String(credentials.libraryId),
          },
          metadata: {
            filetype: mimeType,
            title: fileName,
          },
          onError: (error: unknown) => {
            const err = error as { message?: string; originalResponse?: { getStatus?: () => number } };
            const msg = err?.message ?? String(error);
            const status = err?.originalResponse?.getStatus?.();
            vibeVideoDiagVerbose('upload.tus.error', { message: msg, status });
            if (/expired|401|403|signature/i.test(msg)) {
              reject(new Error('Upload session expired. Please try uploading again.'));
              return;
            }
            reject(error instanceof Error ? error : new Error('Upload failed. Please try again.'));
          },
          onProgress: (bytesUploaded: number, bytesTotal: number) => {
            const pct = bytesTotal > 0 ? bytesUploaded / bytesTotal : 0;
            vibeVideoDiagVerbose('upload.tus.progress', {
              bytesUploaded,
              bytesTotal,
              pct: (pct * 100).toFixed(1),
            });
            onProgress?.(bytesUploaded, bytesTotal);
          },
          onSuccess: () => {
            vibeVideoDiagVerbose('upload.tus.success', { videoId: credentials.videoId });
            const playUrl = getVibeVideoPlaybackUrl(credentials.videoId);
            vibeVideoDiagVerbose('tus.complete', {
              videoId: credentials.videoId,
              playableUrlReady: !!playUrl,
            });
            resolve();
          },
          onShouldRetry: (err: unknown, retryAttempt: number, _options: unknown) => {
            const e = err as { originalResponse?: { getStatus?: () => number } };
            const status = e?.originalResponse?.getStatus?.();
            if (status !== undefined && status >= 400 && status < 500) return false;
            return retryAttempt < 3;
          },
        });

        if (signal) {
          const onAbort = () => {
            try {
              void upload.abort(true);
            } catch {
              /* ignore */
            }
            reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }

        vibeVideoDiagVerbose('tus.client_start', { videoId: credentials.videoId });
        upload.start();
      });
    } catch (e) {
      if (copiedToCache) await deleteLocalFileQuiet(fileUri);
      throw e;
    }

    if (copiedToCache) await deleteLocalFileQuiet(fileUri);
  })();
}

export async function saveVibeVideoToProfile(
  videoId: string,
  options?: { vibeCaption?: string | null },
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

  const projectRef = getProjectRefFromSupabaseUrl(SUPABASE_URL);
  vibeVideoDiagVerbose('profile.vibe_video_save.start', {
    userId: user.id,
    videoId,
    projectRef,
  });

  let { data: updatedRows, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', user.id)
    .select('id');

  if (error) {
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id)
      .select('id');
    if (retry.error) throw retry.error;
    updatedRows = retry.data;
  }

  const matched = Array.isArray(updatedRows) ? updatedRows.length : 0;
  if (matched !== 1) {
    vibeVideoDiagProdHint(
      'profile.vibe_video_save.zero_or_multi_match',
      `userId=${user.id} videoId=${videoId} matched=${matched} projectRef=${projectRef ?? 'unknown'}`,
    );
    throw new Error('Profile update did not affect exactly one row. Please retry.');
  }
  vibeVideoDiagVerbose('profile.vibe_video_saved', {
    userId: user.id,
    videoId,
    bunny_video_status: 'processing',
    matched,
    projectRef,
  });
}

export class DeleteVibeVideoError extends Error {
  constructor(
    message: string,
    readonly code: 'network' | 'server' | 'parse' | 'rejected',
  ) {
    super(message);
    this.name = 'DeleteVibeVideoError';
  }
}

/**
 * Calls delete-vibe-video edge. Throws DeleteVibeVideoError on hard failures.
 * "No video" style responses are treated as success (idempotent delete).
 */
export async function deleteVibeVideo(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new DeleteVibeVideoError('Not authenticated', 'rejected');

  const url = `${SUPABASE_URL}/functions/v1/delete-vibe-video`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch (e) {
    vibeVideoDiagProdHint('delete-vibe-video.network', e instanceof Error ? e.message : String(e));
    throw new DeleteVibeVideoError('Network error while deleting video. Try again.', 'network');
  }

  const { ok: jsonOk, data, rawText } = await readJsonBody(res);

  if (!jsonOk || data === null) {
    vibeVideoDiagProdHint('delete-vibe-video.parse', `status=${res.status}`);
    throw new DeleteVibeVideoError('Invalid response from server. Try again.', 'parse');
  }

  if (!isRecord(data)) {
    throw new DeleteVibeVideoError('Invalid response from server. Try again.', 'parse');
  }

  const success = data.success === true;
  const errMsg = pickString(data, 'error');
  const messageStr = typeof data.message === 'string' ? data.message : '';

  if (!res.ok) {
    vibeVideoDiagProdHint('delete-vibe-video.http', `${res.status} ${errMsg ?? ''}`);
    throw new DeleteVibeVideoError(errMsg ?? `Could not delete video (${res.status}).`, 'server');
  }

  if (!success) {
    const benign = messageStr.includes('No video') || messageStr.toLowerCase().includes('no video');
    if (benign) {
      vibeVideoDiagVerbose('delete-vibe-video.idempotent_no_video', { message: messageStr });
      return;
    }
    vibeVideoDiagProdHint('delete-vibe-video.edge_failure', errMsg ?? rawText.slice(0, 120));
    throw new DeleteVibeVideoError(errMsg ?? 'Could not delete video.', 'server');
  }

  if (data.hadVideoToDelete === true && data.bunnyRemoteDeleteOk === false) {
    vibeVideoDiagProdHint(
      'delete-vibe-video.profile_cleared_bunny_orphan_risk',
      `bunnyHttp=${String(data.bunnyRemoteDeleteHttpStatus ?? 'n/a')}`,
    );
  }
}
