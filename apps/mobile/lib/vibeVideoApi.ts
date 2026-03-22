/**
 * Vibe video: create-video-upload (get tus credentials), tus upload to Bunny, delete-vibe-video.
 * Same backend contract as web. Profiles: bunny_video_uid, bunny_video_status (none | uploading | processing | ready | failed).
 */

import * as tus from 'tus-js-client';
import { supabase } from '@/lib/supabase';
import { persistStreamCdnHostnameFromEdge } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose, vibeVideoDiagProdHint } from '@/lib/vibeVideoDiagnostics';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export type VibeVideoStatus = 'none' | 'uploading' | 'processing' | 'ready' | 'failed';

export type CreateVideoUploadCredentials = {
  videoId: string;
  libraryId: number;
  expirationTime: number;
  signature: string;
  cdnHostname: string | undefined;
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

export async function getCreateVideoUploadCredentials(): Promise<CreateVideoUploadCredentials> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const url = `${SUPABASE_URL}/functions/v1/create-video-upload`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    vibeVideoDiagVerbose('create-upload.network', { message: e instanceof Error ? e.message : String(e) });
    throw new Error('Network error while starting upload. Check your connection and try again.');
  }

  const { ok: jsonOk, data, rawText } = await readJsonBody(res);

  if (!jsonOk || !isRecord(data)) {
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

  return {
    videoId,
    libraryId,
    expirationTime,
    signature,
    cdnHostname,
  };
}

/**
 * Upload video file (local URI) to Bunny via tus using credentials from create-video-upload.
 */
export function uploadVibeVideoToBunny(
  videoUri: string,
  credentials: CreateVideoUploadCredentials,
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  return (async () => {
    let blob: Blob;
    try {
      const response = await fetch(videoUri);
      blob = await response.blob();
    } catch (e) {
      vibeVideoDiagVerbose('tus.read_file_failed', { message: e instanceof Error ? e.message : String(e) });
      throw new Error('Could not read the video file. Try choosing the clip again.');
    }

    const mimeType = blob.type || 'video/mp4';

    return new Promise<void>((resolve, reject) => {
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
        onError: (err) => {
          const msg = err?.message ?? String(err);
          if (/expired|401|403|signature/i.test(msg)) {
            vibeVideoDiagVerbose('tus.auth_or_expiry', { message: msg });
            reject(new Error('Upload session expired. Please try uploading again.'));
            return;
          }
          vibeVideoDiagVerbose('tus.error', { message: msg });
          reject(err instanceof Error ? err : new Error('Upload failed. Please try again.'));
        },
        onProgress: onProgress ? (bytesUploaded, bytesTotal) => onProgress(bytesUploaded, bytesTotal) : undefined,
        onSuccess: () => resolve(),
      });

      const signal = options?.signal;
      if (signal) {
        const onAbort = () => {
          try {
            upload.abort(true);
          } catch {
            /* ignore */
          }
          reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      upload.start();
    });
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

  const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
  if (error) throw error;
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
