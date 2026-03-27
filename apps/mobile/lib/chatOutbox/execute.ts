import type { QueryClient } from '@tanstack/react-query';
import {
  insertChatVideoMessageRow,
  insertVoiceMessageRow,
  invokeSendMessageEdge,
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
        publicUrl = await uploadChatImageMessage(payload.uri, payload.mimeType);
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
      const row = await insertVoiceMessageRow({
        matchId,
        currentUserId: userId,
        audioUrl,
        durationSeconds: payload.durationSeconds,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
    } else {
      const videoUrl =
        item.uploadedMediaUrl ?? (await uploadChatVideoMessage(payload.uri, matchId, payload.mimeType ?? 'video/mp4'));
      uploadedMediaUrl = videoUrl;
      const row = await insertChatVideoMessageRow({
        matchId,
        currentUserId: userId,
        videoUrl,
        durationSeconds: payload.durationSeconds,
        clientRequestId,
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

  queryClient.invalidateQueries({ queryKey: ['messages'] });
  queryClient.invalidateQueries({ queryKey: ['matches'] });
  queryClient.invalidateQueries({ queryKey: ['date-suggestions'] });

  return { serverMessageId, uploadedPublicUrl, uploadedMediaUrl };
}

export function nextBackoffMs(attemptCount: number): number {
  const step = Math.min(6, Math.max(0, attemptCount));
  return Math.min(60_000, 1000 * Math.pow(2, step));
}
