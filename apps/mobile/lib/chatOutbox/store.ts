import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatOutboxItem, ChatOutboxSnapshot, ChatOutboxState } from '@/lib/chatOutbox/types';

type Listener = () => void;

function nowMs(): number {
  return Date.now();
}

function keyForUser(userId: string): string {
  return `vibelymeet:chat-outbox:${userId}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function coerceState(x: unknown): ChatOutboxState | null {
  if (!isString(x)) return null;
  const allowed: Set<ChatOutboxState> = new Set([
    'queued',
    'waiting_for_network',
    'sending',
    'awaiting_hydration',
    'failed',
    'sent',
    'canceled',
  ]);
  return allowed.has(x as ChatOutboxState) ? (x as ChatOutboxState) : null;
}

function coerceItem(raw: unknown): ChatOutboxItem | null {
  if (!isRecord(raw)) return null;
  if (!isString(raw.id) || !isString(raw.matchId) || !isString(raw.senderId) || !isString(raw.clientRequestId)) return null;
  if (!isString(raw.kind)) return null;
  const state = coerceState(raw.state);
  if (!state) return null;
  const createdAtMs = isNumber(raw.createdAtMs) ? raw.createdAtMs : null;
  const updatedAtMs = isNumber(raw.updatedAtMs) ? raw.updatedAtMs : null;
  if (createdAtMs == null || updatedAtMs == null) return null;
  if (!isNumber(raw.attemptCount)) return null;
  const nextRetryAtMs = raw.nextRetryAtMs === null || raw.nextRetryAtMs === undefined ? null : isNumber(raw.nextRetryAtMs) ? raw.nextRetryAtMs : null;
  const lastError = raw.lastError === null || raw.lastError === undefined ? null : isString(raw.lastError) ? raw.lastError : null;
  const serverMessageId =
    raw.serverMessageId === null || raw.serverMessageId === undefined ? null : isString(raw.serverMessageId) ? raw.serverMessageId : null;
  const payload = raw.payload;
  if (!isRecord(payload) || !isString(payload.kind)) return null;
  // payload shape is trusted after kind check; executor validates before use.
  return {
    id: raw.id,
    matchId: raw.matchId,
    senderId: raw.senderId,
    kind: raw.kind as ChatOutboxItem['kind'],
    clientRequestId: raw.clientRequestId,
    createdAtMs,
    updatedAtMs,
    state,
    attemptCount: raw.attemptCount,
    nextRetryAtMs,
    lastError,
    serverMessageId,
    payload: payload as ChatOutboxItem['payload'],
  };
}

class ChatOutboxStore {
  private userId: string | null = null;
  private items: ChatOutboxItem[] = [];
  private initialized = false;
  private listeners: Set<Listener> = new Set();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persisting = false;

  getSnapshot(): ChatOutboxSnapshot {
    return { userId: this.userId, items: this.items, initialized: this.initialized };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async initForUser(userId: string | null): Promise<void> {
    if (!userId) {
      this.userId = null;
      this.items = [];
      this.initialized = true;
      this.emit();
      return;
    }
    if (this.userId === userId && this.initialized) return;

    this.userId = userId;
    this.initialized = false;
    this.items = [];
    this.emit();

    const raw = await AsyncStorage.getItem(keyForUser(userId)).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const next: ChatOutboxItem[] = Array.isArray(parsed) ? parsed.map(coerceItem).filter((x): x is ChatOutboxItem => x !== null) : [];
        // Deterministic ordering: oldest first (createdAtMs, then id).
        next.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
        this.items = next;
      } catch {
        this.items = [];
      }
    }
    this.initialized = true;
    this.emit();
  }

  upsert(item: ChatOutboxItem) {
    const idx = this.items.findIndex((i) => i.id === item.id);
    const next = { ...item, updatedAtMs: nowMs() };
    if (idx < 0) {
      this.items = [...this.items, next].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
    } else {
      const copy = [...this.items];
      copy[idx] = next;
      this.items = copy;
    }
    this.emit();
    this.schedulePersist();
  }

  patch(itemId: string, updater: (prev: ChatOutboxItem) => ChatOutboxItem): ChatOutboxItem | null {
    const idx = this.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return null;
    const next = { ...updater(this.items[idx]), updatedAtMs: nowMs() };
    const copy = [...this.items];
    copy[idx] = next;
    this.items = copy;
    this.emit();
    this.schedulePersist();
    return next;
  }

  remove(itemId: string) {
    const next = this.items.filter((i) => i.id !== itemId);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
    this.schedulePersist();
  }

  removeByServerMessageId(serverMessageId: string) {
    const next = this.items.filter((i) => i.serverMessageId !== serverMessageId);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
    this.schedulePersist();
  }

  listByMatch(matchId: string): ChatOutboxItem[] {
    return this.items.filter((i) => i.matchId === matchId && i.state !== 'canceled' && i.state !== 'sent');
  }

  listAll(): ChatOutboxItem[] {
    return this.items;
  }

  private schedulePersist() {
    if (!this.userId) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persistNow();
    }, 250);
  }

  async persistNow(): Promise<void> {
    if (!this.userId) return;
    if (this.persisting) return;
    this.persisting = true;
    const key = keyForUser(this.userId);
    const payload = JSON.stringify(this.items);
    try {
      await AsyncStorage.setItem(key, payload);
    } finally {
      this.persisting = false;
    }
  }
}

export const chatOutboxStore = new ChatOutboxStore();

