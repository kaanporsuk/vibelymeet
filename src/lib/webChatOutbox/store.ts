import type { WebChatOutboxItem } from "./types";

const PREFIX = "vibelymeet:web-chat-outbox:v1:";
const VALID_OUTBOX_PAYLOAD_KINDS = new Set(["text", "image", "voice", "video"]);

export function webOutboxStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Per-item shape validation so corrupt/legacy localStorage cannot poison the pending queue
 * (stuck "sending" UI, crashes in the drainer). Invalid items are dropped on load; the next
 * save persists the cleaned list.
 */
function isValidWebOutboxItem(value: unknown): value is WebChatOutboxItem {
  if (!value || typeof value !== "object") return false;
  const it = value as Record<string, unknown>;
  if (typeof it.id !== "string" || !it.id) return false;
  if (typeof it.matchId !== "string" || typeof it.userId !== "string") return false;
  if (typeof it.state !== "string" || typeof it.createdAtMs !== "number") return false;
  const payload = it.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (typeof payload.kind !== "string" || !VALID_OUTBOX_PAYLOAD_KINDS.has(payload.kind)) return false;
  return true;
}

export async function loadWebOutboxItems(userId: string): Promise<WebChatOutboxItem[]> {
  const raw = localStorage.getItem(webOutboxStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidWebOutboxItem);
  } catch {
    return [];
  }
}

export async function saveWebOutboxItems(userId: string, items: WebChatOutboxItem[]): Promise<void> {
  localStorage.setItem(webOutboxStorageKey(userId), JSON.stringify(items));
}
