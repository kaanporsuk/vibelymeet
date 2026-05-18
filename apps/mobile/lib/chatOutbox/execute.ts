import type { QueryClient } from '@tanstack/react-query';
import {
  invokeSendMessageEdge,
  invokePublishVoiceMessage,
  invalidateAfterThreadMutation,
} from '@/lib/chatApi';
import { formatChatImageMessageContent } from '@/lib/chatMessageContent';
import { uploadChatImageMessage, uploadVoiceMessage } from '@/lib/chatMediaUpload';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';
import {
  ChatVibeClipUploadedButUnpublishedError,
  completePublishedChatVibeClipUpload,
  uploadAndPublishChatVibeClipToBunnyStream,
} from '@/lib/chatVibeClipStreamUpload';

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
  onUploadProgress?: (fraction: number) => void
): Promise<{ serverMessageId: string; uploadedPublicUrl?: string; uploadedMediaUrl?: string }> {
  const { id: clientRequestId, matchId, userId, payload } = item;

  let serverMessageId: string | null = null;
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
    } else if (payload.kind === 'image') {
      let mediaRef = item.uploadedPublicUrl;
      if (!mediaRef) {
        mediaRef = await uploadChatImageMessage(payload.uri, payload.mimeType, matchId);
      }
      uploadedPublicUrl = mediaRef;
      const row = await invokeSendMessageEdge({
        matchId,
        content: formatChatImageMessageContent(mediaRef),
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
    } else if (payload.kind === 'voice') {
      const audioUrl = item.uploadedMediaUrl ?? (await uploadVoiceMessage(payload.uri, matchId));
      uploadedMediaUrl = audioUrl;
      const row = await invokePublishVoiceMessage({
        matchId,
        audioUrl,
        durationSeconds: payload.durationSeconds,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
    } else {
      let uploaded: Awaited<ReturnType<typeof uploadAndPublishChatVibeClipToBunnyStream>>;
      if (isBunnyStreamPlaybackRef(item.uploadedMediaUrl)) {
        uploaded = await completePublishedChatVibeClipUpload({
          clientRequestId,
          playbackRef: item.uploadedMediaUrl,
        });
      } else {
        try {
          uploaded = await uploadAndPublishChatVibeClipToBunnyStream({
            matchId,
            clientRequestId,
            uri: payload.uri,
            durationMs: Math.round(payload.durationSeconds * 1000),
            mimeType: payload.mimeType ?? null,
            aspectRatio:
              typeof payload.aspectRatio === 'number' && Number.isFinite(payload.aspectRatio) && payload.aspectRatio > 0
                ? payload.aspectRatio
                : null,
            onProgress: onUploadProgress,
          });
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
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed';
    throw new OutboxExecuteError(msg, { uploadedPublicUrl, uploadedMediaUrl, cause: e });
  }

  if (!serverMessageId) {
    throw new Error('Send succeeded but no message id returned.');
  }

  invalidateAfterThreadMutation(queryClient, {
    otherUserId: item.otherUserId,
    currentUserId: item.userId,
    matchId: item.matchId,
  });

  return { serverMessageId, uploadedPublicUrl, uploadedMediaUrl };
}

export function nextBackoffMs(attemptCount: number): number {
  const step = Math.min(6, Math.max(0, attemptCount));
  return Math.min(60_000, 1000 * Math.pow(2, step));
}
