import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';

const PREFIX = 'vibelymeet:chat-outbox:v1:';

export function outboxStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export async function loadOutboxItems(userId: string): Promise<ChatOutboxItem[]> {
  const raw = await AsyncStorage.getItem(outboxStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatOutboxItem[];
  } catch {
    return [];
  }
}

export async function saveOutboxItems(userId: string, items: ChatOutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(outboxStorageKey(userId), JSON.stringify(items));
}
