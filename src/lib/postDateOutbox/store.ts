import type { PostDateOutboxItem } from "@clientShared/postDateOutbox/types";

const PREFIX = "vibelymeet:post-date-outbox:v1:";

export function postDateOutboxStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export async function loadPostDateOutboxItems(userId: string): Promise<PostDateOutboxItem[]> {
  try {
    const raw = localStorage.getItem(postDateOutboxStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PostDateOutboxItem[]) : [];
  } catch {
    return [];
  }
}

export async function savePostDateOutboxItems(userId: string, items: PostDateOutboxItem[]): Promise<void> {
  localStorage.setItem(postDateOutboxStorageKey(userId), JSON.stringify(items));
}

