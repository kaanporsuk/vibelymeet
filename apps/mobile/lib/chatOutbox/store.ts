import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';

const PREFIX = 'vibelymeet:chat-outbox:v1:';
const VALID_OUTBOX_PAYLOAD_KINDS = new Set(['text', 'image', 'voice', 'video']);

export function outboxStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Per-item shape validation so corrupt/legacy AsyncStorage cannot poison the pending queue
 * (stuck pending UI, drainer crashes). Invalid items are dropped on load; the next save persists
 * the cleaned list. Mirrors the web outbox store.
 */
function isValidOutboxItem(value: unknown): value is ChatOutboxItem {
  if (!value || typeof value !== 'object') return false;
  const it = value as Record<string, unknown>;
  if (typeof it.id !== 'string' || !it.id) return false;
  if (typeof it.matchId !== 'string' || typeof it.userId !== 'string') return false;
  if (typeof it.state !== 'string' || typeof it.createdAtMs !== 'number') return false;
  const payload = it.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (typeof payload.kind !== 'string' || !VALID_OUTBOX_PAYLOAD_KINDS.has(payload.kind)) return false;
  return true;
}

export async function loadOutboxItems(userId: string): Promise<ChatOutboxItem[]> {
  const raw = await AsyncStorage.getItem(outboxStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidOutboxItem);
  } catch {
    return [];
  }
}

export async function saveOutboxItems(userId: string, items: ChatOutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(outboxStorageKey(userId), JSON.stringify(items));
}
