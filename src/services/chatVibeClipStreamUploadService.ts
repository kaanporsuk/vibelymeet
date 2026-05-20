import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import {
  VIBE_CLIP_MAX_SOURCE_BYTES,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
} from "../../shared/chat/vibeClipCaptureCopy";
import type { VibeClipRecoveryResumeStrategy } from "../../shared/chat/vibeClipRecovery";

const TUS_CHUNK_SIZE = 5 * 1024 * 1024;

type CreateChatVibeClipUploadResponse = {
  success?: boolean;
  upload_id?: string;
  video_id?: string;
  media_asset_id?: string | null;
  library_id?: number | string;
  tus_endpoint?: string;
  expiration_time?: number;
  signature?: string;
  cdn_hostname?: string;
  status?: "uploading" | "processing" | "ready" | "failed";
  mime_type?: string;
  error?: string;
};

type CompleteChatVibeClipUploadResponse = {
  success?: boolean;
  status?: "processing" | "ready" | "failed";
  message?: unknown;
  message_id?: string;
  provider_object_id?: string;
  error?: string;
};

type ChatVibeClipUploadParams = {
  matchId: string;
  clientRequestId: string;
  file: File;
  durationMs: number;
  aspectRatio?: number | null;
  captions?: unknown;
  resumeStrategy?: VibeClipRecoveryResumeStrategy | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal | null;
};

type CreatedUploadCredentials = {
  uploadId: string;
  videoId: string;
  endpoint: string;
  signature: string;
  expirationTime: number;
  libraryId: number | string;
  mimeType: string;
  status?: "uploading" | "processing" | "ready" | "failed";
};

export type ChatVibeClipStreamUploadResult = {
  uploadId: string;
  videoId: string;
  message: unknown;
  messageId: string;
  status: "processing" | "ready" | "failed";
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
    this.name = "ChatVibeClipUploadedButUnpublishedError";
    this.uploadId = params.uploadId;
    this.videoId = params.videoId;
    this.playbackRef = `bunny_stream:${params.videoId}`;
    this.posterRef = `bunny_stream:${params.videoId}:thumbnail`;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

function pickServerMessageId(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

function uploadFileName(file: File): string {
  return file.name?.trim() || "chat-vibe-clip.mp4";
}

function abortError(): Error {
  const error = new Error("Upload cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function invokeCreate(params: {
  matchId: string;
  clientRequestId: string;
  durationMs: number;
  file: File;
  aspectRatio?: number | null;
  captions?: unknown;
}): Promise<CreateChatVibeClipUploadResponse> {
  const { data, error } = await supabase.functions.invoke("create-chat-vibe-clip-upload", {
    body: {
      match_id: params.matchId,
      client_request_id: params.clientRequestId,
      duration_ms: params.durationMs,
      source_bytes: params.file.size,
      mime_type: params.file.type,
      file_name: uploadFileName(params.file),
      aspect_ratio: params.aspectRatio ?? null,
      captions: params.captions ?? null,
      capture_source: "web",
    },
  });
  if (error) throw error;
  const payload = data as CreateChatVibeClipUploadResponse | null;
  if (!payload?.success) throw new Error(payload?.error || "Could not start clip upload.");
  return payload;
}

function requireCreatedUploadCredentials(created: CreateChatVibeClipUploadResponse): CreatedUploadCredentials {
  if (!created.upload_id || !created.video_id || !created.signature || !created.expiration_time || !created.library_id || !created.mime_type) {
    throw new Error("Clip upload service returned an incomplete response.");
  }
  return {
    uploadId: created.upload_id,
    videoId: created.video_id,
    endpoint: created.tus_endpoint || "https://video.bunnycdn.com/tusupload",
    signature: created.signature,
    expirationTime: created.expiration_time,
    libraryId: created.library_id,
    mimeType: created.mime_type,
    status: created.status,
  };
}

async function invokeComplete(params: {
  uploadId?: string;
  clientRequestId: string;
}): Promise<CompleteChatVibeClipUploadResponse> {
  const { data, error } = await supabase.functions.invoke("complete-chat-vibe-clip-upload", {
    body: {
      ...(params.uploadId ? { upload_id: params.uploadId } : {}),
      client_request_id: params.clientRequestId,
    },
  });
  if (error) throw error;
  const payload = data as CompleteChatVibeClipUploadResponse | null;
  if (!payload?.success) throw new Error(payload?.error || "Could not publish clip.");
  return payload;
}

function uploadTus(params: {
  file: File;
  endpoint: string;
  signature: string;
  expirationTime: number;
  videoId: string;
  libraryId: number | string;
  mimeType: string;
  resumePrevious?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal | null;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    let cleanupAbortListener = () => {};
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      resolve();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      reject(error);
    };
    const upload = new tus.Upload(params.file, {
      endpoint: params.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: TUS_CHUNK_SIZE,
      headers: {
        AuthorizationSignature: params.signature,
        AuthorizationExpire: String(params.expirationTime),
        VideoId: params.videoId,
        LibraryId: String(params.libraryId),
      },
      metadata: {
        filetype: params.mimeType,
        title: uploadFileName(params.file),
        thumbnailTime: "1000",
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        params.onProgress?.(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0);
      },
      onError: (error) => rejectOnce(error),
      onSuccess: () => resolveOnce(),
      onShouldRetry: (error, retryAttempt) => {
        if (params.signal?.aborted) return false;
        const status = (error as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.();
        if (status != null && status >= 400 && status < 500) return false;
        return retryAttempt < 4;
      },
    });
    const onAbort = () => {
      try {
        void Promise.resolve(upload.abort()).catch(() => undefined);
      } catch {
        // ignore abort cleanup errors; the caller only needs deterministic rejection
      }
      rejectOnce(abortError());
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    cleanupAbortListener = () => params.signal?.removeEventListener("abort", onAbort);

    upload.findPreviousUploads().then((previousUploads) => {
      if (params.signal?.aborted) {
        onAbort();
        return;
      }
      if (params.resumePrevious !== false && previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
      upload.start();
    }).catch(() => {
      if (params.signal?.aborted) {
        onAbort();
        return;
      }
      upload.start();
    });
  });
}

function tusHttpStatus(error: unknown): number | null {
  const status = (error as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.();
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function isStaleTusCredentialError(error: unknown): boolean {
  const status = tusHttpStatus(error);
  return status === 401 || status === 403 || status === 410;
}

function providerObjectIdFromPlaybackRef(ref: string | null | undefined): string | null {
  const match = /^bunny_stream:([0-9a-f-]{32,36})(?::thumbnail)?$/i.exec(ref?.trim() ?? "");
  return match?.[1] ?? null;
}

function resultFromCompletedUpload(params: {
  uploadId: string;
  videoId: string;
  completed: CompleteChatVibeClipUploadResponse;
}): ChatVibeClipStreamUploadResult {
  const messageId = params.completed.message_id || pickServerMessageId(params.completed.message);
  if (!messageId) throw new Error("Clip published but message confirmation was missing.");

  return {
    uploadId: params.uploadId,
    videoId: params.videoId,
    message: params.completed.message,
    messageId,
    status: params.completed.status || "processing",
    playbackRef: `bunny_stream:${params.videoId}`,
    posterRef: `bunny_stream:${params.videoId}:thumbnail`,
  };
}

export async function completePublishedChatVibeClipUpload(params: {
  clientRequestId: string;
  playbackRef?: string | null;
}): Promise<ChatVibeClipStreamUploadResult> {
  const completed = await invokeComplete({
    clientRequestId: params.clientRequestId,
  });
  const videoId =
    completed.provider_object_id ||
    providerObjectIdFromPlaybackRef(params.playbackRef);
  if (!videoId) throw new Error("Clip confirmation was missing its Bunny video reference.");

  return resultFromCompletedUpload({
    uploadId: "",
    videoId,
    completed,
  });
}

export async function uploadAndPublishChatVibeClipToBunnyStream(params: ChatVibeClipUploadParams): Promise<ChatVibeClipStreamUploadResult> {
  throwIfAborted(params.signal);
  if (!params.file.size) throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
  if (params.file.size > VIBE_CLIP_MAX_SOURCE_BYTES) throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());

  throwIfAborted(params.signal);
  let created = requireCreatedUploadCredentials(await invokeCreate(params));
  const uploadId = created.uploadId;
  const videoId = created.videoId;

  throwIfAborted(params.signal);
  if (created.status === "failed") throw new Error("Clip processing failed. Please try a new clip.");
  if (!created.status || created.status === "uploading") {
    try {
      await uploadTus({
        file: params.file,
        endpoint: created.endpoint,
        signature: created.signature,
        expirationTime: created.expirationTime,
        videoId,
        libraryId: created.libraryId,
        mimeType: created.mimeType,
        onProgress: params.onProgress,
        signal: params.signal,
      });
    } catch (error) {
      if (!isStaleTusCredentialError(error)) throw error;
      const shouldResumePreviousUpload = tusHttpStatus(error) !== 410;
      throwIfAborted(params.signal);
      const refreshed = requireCreatedUploadCredentials(await invokeCreate(params));
      if (refreshed.videoId !== videoId || refreshed.uploadId !== uploadId) {
        throw new Error("Clip recovery returned a different upload target. Please send the clip again.");
      }
      created = refreshed;
      throwIfAborted(params.signal);
      if (!created.status || created.status === "uploading") {
        await uploadTus({
          file: params.file,
          endpoint: created.endpoint,
          signature: created.signature,
          expirationTime: created.expirationTime,
          videoId,
          libraryId: created.libraryId,
          mimeType: created.mimeType,
          resumePrevious: shouldResumePreviousUpload,
          onProgress: params.onProgress,
          signal: params.signal,
        });
      } else {
        params.onProgress?.(1);
      }
    }
  } else {
    params.onProgress?.(1);
  }

  let completed: CompleteChatVibeClipUploadResponse;
  try {
    throwIfAborted(params.signal);
    completed = await invokeComplete({
      uploadId,
      clientRequestId: params.clientRequestId,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ChatVibeClipUploadedButUnpublishedError(
      error instanceof Error ? error.message : "Clip uploaded but could not be published yet.",
      { uploadId, videoId, cause: error },
    );
  }

  return resultFromCompletedUpload({
    uploadId,
    videoId,
    completed,
  });
}
