import type { QueryClient } from '@tanstack/react-query';
import {
  invokeSendMessageEdge,
  invokePublishVibeClip,
  invokePublishVoiceMessage,
  invalidateAfterThreadMutation,
} from '@/lib/chatApi';
import { formatChatImageMessageContent } from '@/lib/chatMessageContent';
import { uploadChatImageMessage, uploadChatVideoMessage, uploadVoiceMessage } from '@/lib/chatMediaUpload';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';

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

export async function executeOutboxItem(
  item: ChatOutboxItem,
  queryClient: QueryClient
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
      let publicUrl = item.uploadedPublicUrl;
      if (!publicUrl) {
        publicUrl = await uploadChatImageMessage(payload.uri, payload.mimeType, matchId);
      }
      uploadedPublicUrl = publicUrl;
      const row = await invokeSendMessageEdge({
        matchId,
        content: formatChatImageMessageContent(publicUrl),
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
      const uploaded =
        item.uploadedMediaUrl
          ? {
              videoUrl: item.uploadedMediaUrl,
              thumbnailUrl: item.uploadedPublicUrl ?? null,
              aspectRatio:
                typeof payload.aspectRatio === 'number' && Number.isFinite(payload.aspectRatio) && payload.aspectRatio > 0
                  ? payload.aspectRatio
                  : null,
            }
          : await uploadChatVideoMessage(
              payload.uri,
              matchId,
              payload.mimeType ?? 'video/mp4',
              typeof payload.aspectRatio === 'number' ? payload.aspectRatio : null,
            );
      uploadedMediaUrl = uploaded.videoUrl;
      uploadedPublicUrl = uploaded.thumbnailUrl ?? undefined;
      const row = await invokePublishVibeClip({
        matchId,
        videoUrl: uploaded.videoUrl,
        durationMs: Math.round(payload.durationSeconds * 1000),
        clientRequestId,
        thumbnailUrl: uploaded.thumbnailUrl,
        aspectRatio: uploaded.aspectRatio,
      });
      serverMessageId = getServerMessageId(row);
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
