import type { ChatOutboxItem, ChatOutboxPayload } from '@/lib/chatOutbox/types';
import { chatOutboxStore } from '@/lib/chatOutbox/store';
import { newClientRequestId, newOutboxId } from '@/lib/chatOutbox/id';
import { copyChatOutboxMediaToCache } from '@/lib/chatOutbox/mediaCache';

function nowMs(): number {
  return Date.now();
}

function baseItem(params: {
  id: string;
  matchId: string;
  senderId: string;
  clientRequestId: string;
  kind: ChatOutboxItem['kind'];
  payload: ChatOutboxPayload;
}): ChatOutboxItem {
  const ts = nowMs();
  return {
    id: params.id,
    matchId: params.matchId,
    senderId: params.senderId,
    kind: params.kind,
    clientRequestId: params.clientRequestId,
    createdAtMs: ts,
    updatedAtMs: ts,
    state: 'queued',
    attemptCount: 0,
    nextRetryAtMs: null,
    lastError: null,
    serverMessageId: null,
    payload: params.payload,
  };
}

export async function enqueueChatOutboxText(params: { matchId: string; senderId: string; text: string }): Promise<string> {
  const trimmed = params.text.trim();
  const id = newOutboxId();
  const clientRequestId = newClientRequestId();
  const item = baseItem({
    id,
    matchId: params.matchId,
    senderId: params.senderId,
    clientRequestId,
    kind: 'text',
    payload: { kind: 'text', text: trimmed },
  });
  chatOutboxStore.upsert(item);
  return id;
}

export async function enqueueChatOutboxImage(params: {
  matchId: string;
  senderId: string;
  uri: string;
  mimeType: string;
}): Promise<string> {
  const id = newOutboxId();
  const clientRequestId = newClientRequestId();
  const { cachedUri } = await copyChatOutboxMediaToCache({
    queueItemId: id,
    kind: 'image',
    uri: params.uri,
    mimeType: params.mimeType,
  });
  const item = baseItem({
    id,
    matchId: params.matchId,
    senderId: params.senderId,
    clientRequestId,
    kind: 'image',
    payload: { kind: 'image', uri: cachedUri, mimeType: params.mimeType },
  });
  chatOutboxStore.upsert(item);
  return id;
}

export async function enqueueChatOutboxVoice(params: {
  matchId: string;
  senderId: string;
  uri: string;
  durationSeconds: number;
}): Promise<string> {
  const id = newOutboxId();
  const clientRequestId = newClientRequestId();
  const { cachedUri } = await copyChatOutboxMediaToCache({
    queueItemId: id,
    kind: 'voice',
    uri: params.uri,
    mimeType: 'audio/m4a',
  });
  const item = baseItem({
    id,
    matchId: params.matchId,
    senderId: params.senderId,
    clientRequestId,
    kind: 'voice',
    payload: { kind: 'voice', uri: cachedUri, durationSeconds: params.durationSeconds },
  });
  chatOutboxStore.upsert(item);
  return id;
}

export async function enqueueChatOutboxVideo(params: {
  matchId: string;
  senderId: string;
  uri: string;
  durationSeconds: number;
  mimeType: string;
}): Promise<string> {
  const id = newOutboxId();
  const clientRequestId = newClientRequestId();
  const { cachedUri } = await copyChatOutboxMediaToCache({
    queueItemId: id,
    kind: 'video',
    uri: params.uri,
    mimeType: params.mimeType,
  });
  const item = baseItem({
    id,
    matchId: params.matchId,
    senderId: params.senderId,
    clientRequestId,
    kind: 'video',
    payload: { kind: 'video', uri: cachedUri, durationSeconds: params.durationSeconds, mimeType: params.mimeType },
  });
  chatOutboxStore.upsert(item);
  return id;
}

export function retryChatOutboxItem(itemId: string) {
  chatOutboxStore.patch(itemId, (prev) => ({
    ...prev,
    state: 'queued',
    nextRetryAtMs: null,
    lastError: null,
  }));
}

export function cancelChatOutboxItem(itemId: string) {
  chatOutboxStore.patch(itemId, (prev) => ({
    ...prev,
    state: 'canceled',
  }));
  chatOutboxStore.remove(itemId);
}

