import type { QueryClient } from '@tanstack/react-query';
import {
  invokeSendMessageEdge,
  invokePublishVoiceMessage,
  invalidateAfterThreadMutation,
  patchThreadCacheFromRawMessage,
} from '@/lib/chatApi';
import { formatChatImageMessageContent } from '@/lib/chatMessageContent';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';
import {
  ChatVibeClipUploadedButUnpublishedError,
  completePublishedChatVibeClipUpload,
  uploadAndPublishChatVibeClipToBunnyStream,
} from '@/lib/chatVibeClipStreamUpload';
import { uploadAndPublishChatVibeClipWithMediaSdk } from '@/lib/mediaSdk/nativeVideoUploads';
import {
  uploadChatImageWithMediaSdk,
  uploadVoiceWithMediaSdk,
} from '@/lib/mediaSdk/nativeStorageUploads';

export class OutboxExecuteError extends Error {
  uploadedPublicUrl?: string;
  uploadedMediaUrl?: string;

  constructor(
    message: string,
    opts?: { uploadedPublicUrl?: string; uploadedMediaUrl?: string; cause?: unknown }
  ) {
    super(message);
    this.name = 'OutboxExecuteError';
    this.uploadedPublicUrl = opts?.uploadedPublicUrl;
    this.uploadedMediaUrl = opts?.uploadedMediaUrl;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

function getServerMessageId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function isBunnyStreamPlaybackRef(value: string | null | undefined): value is string {
  return /^bunny_stream:[0-9a-f-]{32,36}$/i.test(value?.trim() ?? '');
}

export async function executeOutboxItem(
  item: ChatOutboxItem,
  queryClient: QueryClient,
  onUploadProgress?: (fraction: number) => void,
  options: { signal?: AbortSignal | null } = {},
): Promise<{
  serverMessageId: string;
  uploadedPublicUrl?: string;
  uploadedMediaUrl?: string;
  patchedThreadCache?: boolean;
  displayReady?: boolean;
}> {
  const { id: clientRequestId, matchId, payload } = item;

  let serverMessageId: string | null = null;
  let serverMessage: unknown;
  let uploadedPublicUrl: string | undefined;
  let uploadedMediaUrl: string | undefined;

  try {
    if (payload.kind === 'text') {
      const row = await invokeSendMessageEdge({
        matchId,
        content: payload.text,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
      serverMessage = row;
    } else if (payload.kind === 'image') {
      let mediaRef = item.uploadedPublicUrl;
      if (!mediaRef) {
        mediaRef = await uploadChatImageWithMediaSdk({
          uri: payload.uri,
          mimeType: payload.mimeType,
          matchId,
          clientRequestId,
        });
      }
      uploadedPublicUrl = mediaRef;
      const row = await invokeSendMessageEdge({
        matchId,
        content: formatChatImageMessageContent(mediaRef),
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
      serverMessage = row;
    } else if (payload.kind === 'voice') {
      const audioUrl =
        item.uploadedMediaUrl ??
        (await uploadVoiceWithMediaSdk({ uri: payload.uri, matchId, clientRequestId }));
      uploadedMediaUrl = audioUrl;
      const row = await invokePublishVoiceMessage({
        matchId,
        audioUrl,
        durationSeconds: payload.durationSeconds,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
      serverMessage = row;
    } else {
      let uploaded: Awaited<ReturnType<typeof uploadAndPublishChatVibeClipToBunnyStream>>;
      if (isBunnyStreamPlaybackRef(item.uploadedMediaUrl)) {
        uploaded = await completePublishedChatVibeClipUpload({
          clientRequestId,
          playbackRef: item.uploadedMediaUrl,
        });
      } else {
        try {
          const uploadParams = {
            matchId,
            clientRequestId,
            uri: payload.uri,
            durationMs: Math.round(payload.durationSeconds * 1000),
            mimeType: payload.mimeType ?? null,
            aspectRatio:
              typeof payload.aspectRatio === 'number' && Number.isFinite(payload.aspectRatio) && payload.aspectRatio > 0
                ? payload.aspectRatio
                : null,
            captions: payload.captions ?? null,
            resumeStrategy: item.vibeClipResumeStrategy,
            onProgress: onUploadProgress,
            signal: options.signal ?? null,
          };
          uploaded = await uploadAndPublishChatVibeClipWithMediaSdk(uploadParams);
        } catch (error) {
          if (error instanceof ChatVibeClipUploadedButUnpublishedError) {
            uploadedMediaUrl = error.playbackRef;
            uploadedPublicUrl = error.posterRef;
          }
          throw error;
        }
      }
      uploadedMediaUrl = uploaded.playbackRef;
      uploadedPublicUrl = uploaded.posterRef;
      serverMessageId = uploaded.messageId || getServerMessageId(uploaded.message);
      serverMessage = uploaded.message;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed';
    throw new OutboxExecuteError(msg, { uploadedPublicUrl, uploadedMediaUrl, cause: e });
  }

  if (!serverMessageId) {
    throw new Error('Send succeeded but no message id returned.');
  }

  const scope = {
    otherUserId: item.otherUserId,
    currentUserId: item.userId,
    matchId: item.matchId,
  };
  const patchResult =
    payload.kind !== 'video' && serverMessage
      ? await patchThreadCacheFromRawMessage({
          queryClient,
          otherUserId: item.otherUserId,
          currentUserId: item.userId,
          matchId: item.matchId,
          raw: serverMessage,
        })
      : { patched: false, displayReady: false };

  invalidateAfterThreadMutation(queryClient, scope);

  return {
    serverMessageId,
    uploadedPublicUrl,
    uploadedMediaUrl,
    patchedThreadCache: patchResult.patched,
    displayReady: patchResult.displayReady,
  };
}

export function nextBackoffMs(attemptCount: number): number {
  const step = Math.min(6, Math.max(0, attemptCount));
  return Math.min(60_000, 1000 * Math.pow(2, step));
}
