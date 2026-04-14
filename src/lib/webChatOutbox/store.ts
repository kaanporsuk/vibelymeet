import type { WebChatOutboxItem } from "./types";

const PREFIX = "vibelymeet:web-chat-outbox:v1:";

export function webOutboxStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export async function loadWebOutboxItems(userId: string): Promise<WebChatOutboxItem[]> {
  const raw = localStorage.getItem(webOutboxStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as WebChatOutboxItem[];
  } catch {
    return [];
  }
}

export async function saveWebOutboxItems(userId: string, items: WebChatOutboxItem[]): Promise<void> {
  localStorage.setItem(webOutboxStorageKey(userId), JSON.stringify(items));
}
