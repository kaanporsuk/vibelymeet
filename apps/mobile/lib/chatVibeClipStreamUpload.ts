import * as tus from 'tus-js-client';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { getFreshCachedAccessToken } from '@/lib/nativeAuthSession';
import {
  VIBE_CLIP_MAX_SOURCE_BYTES,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_INVALID_TYPE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
} from '../../../shared/chat/vibeClipCaptureCopy';

const TUS_CHUNK_SIZE = 5 * 1024 * 1024;

type CreateResponse = {
  success?: boolean;
  upload_id?: string;
  video_id?: string;
  library_id?: number | string;
  tus_endpoint?: string;
  expiration_time?: number;
  signature?: string;
  mime_type?: string;
  status?: 'uploading' | 'processing' | 'ready' | 'failed';
  error?: string;
};

type CompleteResponse = {
  success?: boolean;
  status?: 'processing' | 'ready' | 'failed';
  message?: unknown;
  message_id?: string;
  provider_object_id?: string;
  error?: string;
};

export type ChatVibeClipStreamUploadResult = {
  uploadId: string;
  videoId: string;
  message: unknown;
  messageId: string;
  status: 'processing' | 'ready' | 'failed';
  playbackRef: string;
  posterRef: string;
};

export class ChatVibeClipUploadedButUnpublishedError extends Error {
  uploadId: string;
  videoId: string;
  playbackRef: string;
  posterRef: string;

  constructor(message: string, params: { uploadId: string; videoId: string; cause?: unknown }) {
    super(message);
    this.name = 'ChatVibeClipUploadedButUnpublishedError';
    this.uploadId = params.uploadId;
    this.videoId = params.videoId;
    this.playbackRef = `bunny_stream:${params.videoId}`;
    this.posterRef = `bunny_stream:${params.videoId}:thumbnail`;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

function getMessageId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

function extensionForMimeType(mimeType: string, fallbackExt: string | null): string {
  if (fallbackExt && ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mpeg', 'mpg'].includes(fallbackExt)) {
    return fallbackExt === 'mpg' ? 'mpeg' : fallbackExt;
  }
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'video/x-m4v' || mimeType === 'video/m4v') return 'm4v';
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/x-matroska') return 'mkv';
  if (mimeType === 'video/x-msvideo') return 'avi';
  if (mimeType === 'video/x-ms-wmv') return 'wmv';
  if (mimeType === 'video/x-flv') return 'flv';
  if (mimeType === 'video/mp2t') return 'ts';
  if (mimeType === 'video/mpeg') return 'mpeg';
  return 'mp4';
}

function extensionFromUri(uri: string): string {
  const clean = uri.split(/[?#]/)[0] ?? '';
  const last = clean.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot >= 0 ? last.slice(dot + 1).toLowerCase() : '';
}

function mimeFromExtension(ext: string, fallback?: string | null): string | null {
  const base = fallback?.split(';')[0]?.trim().toLowerCase();
  if (base && base !== 'application/octet-stream') return base;
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'avi') return 'video/x-msvideo';
  if (ext === 'wmv') return 'video/x-ms-wmv';
  if (ext === 'flv') return 'video/x-flv';
  if (ext === 'ts') return 'video/mp2t';
  if (ext === 'mpeg' || ext === 'mpg') return 'video/mpeg';
  if (ext === 'mp4') return 'video/mp4';
  return null;
}

async function stableUploadFileUri(
  uri: string,
  clientRequestId: string,
  ext: string | null,
): Promise<{ uri: string; copied: boolean }> {
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) return { uri, copied: false };
  const safeExt = ext?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const dest = `${cacheRoot}chat-vibe-tus-${clientRequestId}.${safeExt}`;
  if (uri === dest) return { uri, copied: false };
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({ from: uri, to: dest });
    return { uri: dest, copied: true };
  } catch {
    return { uri, copied: false };
  }
}

async function deleteQuiet(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

async function createUpload(params: {
  matchId: string;
  clientRequestId: string;
  accessToken: string;
  durationMs: number;
  sourceBytes: number;
  mimeType: string;
  fileName: string;
  aspectRatio?: number | null;
}): Promise<CreateResponse> {
  const { data, error } = await supabase.functions.invoke('create-chat-vibe-clip-upload', {
    body: {
      match_id: params.matchId,
      client_request_id: params.clientRequestId,
      duration_ms: params.durationMs,
      source_bytes: params.sourceBytes,
      mime_type: params.mimeType,
      file_name: params.fileName,
      aspect_ratio: params.aspectRatio ?? null,
      capture_source: 'native',
    },
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (error) throw error;
  const payload = data as CreateResponse | null;
  if (!payload?.success) throw new Error(payload?.error || 'Could not start clip upload.');
  return payload;
}

async function completeUpload(params: {
  uploadId?: string;
  clientRequestId: string;
  accessToken: string;
}): Promise<CompleteResponse> {
  const { data, error } = await supabase.functions.invoke('complete-chat-vibe-clip-upload', {
    body: {
      ...(params.uploadId ? { upload_id: params.uploadId } : {}),
      client_request_id: params.clientRequestId,
    },
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (error) throw error;
  const payload = data as CompleteResponse | null;
  if (!payload?.success) throw new Error(payload?.error || 'Could not publish clip.');
  return payload;
}

function uploadTus(params: {
  fileUri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  endpoint: string;
  signature: string;
  expirationTime: number;
  videoId: string;
  libraryId: number | string;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const rnFileSource = { uri: params.fileUri, name: params.fileName, type: params.mimeType };
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(rnFileSource as unknown as File, {
      endpoint: params.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: TUS_CHUNK_SIZE,
      uploadSize: params.fileSize,
      headers: {
        AuthorizationSignature: params.signature,
        AuthorizationExpire: String(params.expirationTime),
        VideoId: params.videoId,
        LibraryId: String(params.libraryId),
      },
      metadata: {
        filetype: params.mimeType,
        title: params.fileName,
        thumbnailTime: '1000',
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        params.onProgress?.(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0);
      },
      onError: (error) => reject(error),
      onSuccess: () => resolve(),
      onShouldRetry: (error, retryAttempt) => {
        const status = (error as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.();
        if (status != null && status >= 400 && status < 500) return false;
        return retryAttempt < 4;
      },
    });
    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
      upload.start();
    }).catch(() => upload.start());
  });
}

function providerObjectIdFromPlaybackRef(ref: string | null | undefined): string | null {
  const match = /^bunny_stream:([0-9a-f-]{32,36})(?::thumbnail)?$/i.exec(ref?.trim() ?? '');
  return match?.[1] ?? null;
}

function resultFromCompletedUpload(params: {
  uploadId: string;
  videoId: string;
  completed: CompleteResponse;
}): ChatVibeClipStreamUploadResult {
  const messageId = params.completed.message_id || getMessageId(params.completed.message);
  if (!messageId) throw new Error('Clip published but message confirmation was missing.');

  return {
    uploadId: params.uploadId,
    videoId: params.videoId,
    message: params.completed.message,
    messageId,
    status: params.completed.status || 'processing',
    playbackRef: `bunny_stream:${params.videoId}`,
    posterRef: `bunny_stream:${params.videoId}:thumbnail`,
  };
}

export async function completePublishedChatVibeClipUpload(params: {
  clientRequestId: string;
  playbackRef?: string | null;
}): Promise<ChatVibeClipStreamUploadResult> {
  const accessToken = await getFreshCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  const completed = await completeUpload({
    clientRequestId: params.clientRequestId,
    accessToken,
  });
  const videoId =
    completed.provider_object_id ||
    providerObjectIdFromPlaybackRef(params.playbackRef);
  if (!videoId) throw new Error('Clip confirmation was missing its Bunny video reference.');

  return resultFromCompletedUpload({
    uploadId: '',
    videoId,
    completed,
  });
}

export async function uploadAndPublishChatVibeClipToBunnyStream(params: {
  matchId: string;
  clientRequestId: string;
  uri: string;
  durationMs: number;
  mimeType?: string | null;
  aspectRatio?: number | null;
  onProgress?: (fraction: number) => void;
}): Promise<ChatVibeClipStreamUploadResult> {
  const accessToken = await getFreshCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  const originalExt = extensionFromUri(params.uri) || null;
  const stable = await stableUploadFileUri(params.uri, params.clientRequestId, originalExt);
  try {
    const info = await FileSystem.getInfoAsync(stable.uri);
    if (!info.exists || info.isDirectory || !info.size) throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
    if (info.size > VIBE_CLIP_MAX_SOURCE_BYTES) throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());

    const mimeType = mimeFromExtension(originalExt ?? '', params.mimeType);
    if (!mimeType) throw new Error(VIBE_CLIP_UPLOAD_INVALID_TYPE);
    const fileName = `chat-vibe-clip.${extensionForMimeType(mimeType, originalExt)}`;
    const created = await createUpload({
      matchId: params.matchId,
      clientRequestId: params.clientRequestId,
      accessToken,
      durationMs: params.durationMs,
      sourceBytes: info.size,
      mimeType,
      fileName,
      aspectRatio: params.aspectRatio,
    });
    if (!created.upload_id || !created.video_id || !created.signature || !created.expiration_time || !created.library_id) {
      throw new Error('Clip upload service returned an incomplete response.');
    }

    if (created.status === 'failed') throw new Error('Clip processing failed. Please try a new clip.');
    if (!created.status || created.status === 'uploading') {
      await uploadTus({
        fileUri: stable.uri,
        fileName,
        fileSize: info.size,
        mimeType: created.mime_type || mimeType,
        endpoint: created.tus_endpoint || 'https://video.bunnycdn.com/tusupload',
        signature: created.signature,
        expirationTime: created.expiration_time,
        videoId: created.video_id,
        libraryId: created.library_id,
        onProgress: params.onProgress,
      });
    } else {
      params.onProgress?.(1);
    }

    let completed: CompleteResponse;
    try {
      const completionToken = await getFreshCachedAccessToken();
      if (!completionToken) throw new Error('Not authenticated');
      completed = await completeUpload({
        uploadId: created.upload_id,
        clientRequestId: params.clientRequestId,
        accessToken: completionToken,
      });
    } catch (error) {
      throw new ChatVibeClipUploadedButUnpublishedError(
        error instanceof Error ? error.message : 'Clip uploaded but could not be published yet.',
        { uploadId: created.upload_id, videoId: created.video_id, cause: error },
      );
    }

    return resultFromCompletedUpload({
      uploadId: created.upload_id,
      videoId: created.video_id,
      completed,
    });
  } finally {
    if (stable.copied) await deleteQuiet(stable.uri);
  }
}
