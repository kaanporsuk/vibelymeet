import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import {
  VIBE_CLIP_MAX_SOURCE_BYTES,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
} from "../../shared/chat/vibeClipCaptureCopy";

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

async function invokeCreate(params: {
  matchId: string;
  clientRequestId: string;
  durationMs: number;
  file: File;
  aspectRatio?: number | null;
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
      capture_source: "web",
    },
  });
  if (error) throw error;
  const payload = data as CreateChatVibeClipUploadResponse | null;
  if (!payload?.success) throw new Error(payload?.error || "Could not start clip upload.");
  return payload;
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
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
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

export async function uploadAndPublishChatVibeClipToBunnyStream(params: {
  matchId: string;
  clientRequestId: string;
  file: File;
  durationMs: number;
  aspectRatio?: number | null;
  onProgress?: (fraction: number) => void;
}): Promise<ChatVibeClipStreamUploadResult> {
  if (!params.file.size) throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
  if (params.file.size > VIBE_CLIP_MAX_SOURCE_BYTES) throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());

  const created = await invokeCreate(params);
  const uploadId = created.upload_id;
  const videoId = created.video_id;
  if (!uploadId || !videoId || !created.signature || !created.expiration_time || !created.library_id || !created.mime_type) {
    throw new Error("Clip upload service returned an incomplete response.");
  }

  if (created.status === "failed") throw new Error("Clip processing failed. Please try a new clip.");
  if (!created.status || created.status === "uploading") {
    await uploadTus({
      file: params.file,
      endpoint: created.tus_endpoint || "https://video.bunnycdn.com/tusupload",
      signature: created.signature,
      expirationTime: created.expiration_time,
      videoId,
      libraryId: created.library_id,
      mimeType: created.mime_type,
      onProgress: params.onProgress,
    });
  } else {
    params.onProgress?.(1);
  }

  let completed: CompleteChatVibeClipUploadResponse;
  try {
    completed = await invokeComplete({
      uploadId,
      clientRequestId: params.clientRequestId,
    });
  } catch (error) {
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
