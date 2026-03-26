import type { NetworkState } from '@/lib/connectivityService';
import { chatOutboxStore } from '@/lib/chatOutbox/store';
import type { ChatOutboxItem, ChatOutboxPayload } from '@/lib/chatOutbox/types';
import { sendOutboxItem } from '@/lib/chatOutbox/transport';
import { deleteChatOutboxCachedMedia } from '@/lib/chatOutbox/mediaCache';

function nowMs(): number {
  return Date.now();
}

function computeNextRetryAtMs(attemptCount: number): number {
  // Conservative bounded backoff: 3s, 10s, 30s, 2m, 5m (cap).
  const schedule = [3000, 10000, 30000, 120000, 300000];
  const idx = Math.min(schedule.length - 1, Math.max(0, attemptCount - 1));
  return nowMs() + schedule[idx];
}

function payloadHasMedia(payload: ChatOutboxPayload): payload is Exclude<ChatOutboxPayload, { kind: 'text' }> {
  return payload.kind !== 'text';
}

class ChatOutboxExecutor {
  private running = false;
  private inFlightByMatch: Map<string, string> = new Map(); // matchId -> itemId

  tick(params: { network: NetworkState; appActive: boolean }) {
    if (params.network !== 'online' || !params.appActive) return;
    if (!chatOutboxStore.getSnapshot().initialized) return;
    if (this.running) return;
    this.running = true;
    void this.runOnce().finally(() => {
      this.running = false;
    });
  }

  private pickNextEligible(all: ChatOutboxItem[]): ChatOutboxItem | null {
    const now = nowMs();
    const candidates = all
      .filter((i) => i.state === 'queued' || i.state === 'waiting_for_network' || i.state === 'failed')
      .filter((i) => i.nextRetryAtMs == null || i.nextRetryAtMs <= now)
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
    for (const item of candidates) {
      if (this.inFlightByMatch.has(item.matchId)) continue;
      return item;
    }
    return null;
  }

  private async runOnce(): Promise<void> {
    // Process until no eligible items remain for now.
    for (;;) {
      const snap = chatOutboxStore.getSnapshot();
      const item = this.pickNextEligible(snap.items);
      if (!item) return;

      // Mark in-flight per thread for deterministic ordering.
      this.inFlightByMatch.set(item.matchId, item.id);

      chatOutboxStore.patch(item.id, (prev) => ({
        ...prev,
        state: 'sending',
        attemptCount: prev.attemptCount + 1,
        lastError: null,
        nextRetryAtMs: null,
      }));

      try {
        const current = chatOutboxStore.getSnapshot().items.find((i) => i.id === item.id);
        if (!current) {
          this.inFlightByMatch.delete(item.matchId);
          continue;
        }

        const result = await sendOutboxItem({
          matchId: current.matchId,
          senderId: current.senderId,
          clientRequestId: current.clientRequestId,
          payload: current.payload,
        });

        const serverMessageId = result.serverMessageId;
        if (!serverMessageId) {
          chatOutboxStore.patch(current.id, (prev) => ({
            ...prev,
            state: 'awaiting_hydration',
            serverMessageId: null,
          }));
        } else {
          chatOutboxStore.patch(current.id, (prev) => ({
            ...prev,
            state: 'sent',
            serverMessageId,
          }));
          // Cleanup: remove item and cached media after marking sent.
          const payload = current.payload;
          chatOutboxStore.remove(current.id);
          if (payloadHasMedia(payload)) {
            void deleteChatOutboxCachedMedia(payload.uri);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not send message.';
        const nextRetryAtMs = computeNextRetryAtMs(item.attemptCount + 1);
        chatOutboxStore.patch(item.id, (prev) => ({
          ...prev,
          state: 'failed',
          lastError: msg,
          nextRetryAtMs,
        }));
      } finally {
        this.inFlightByMatch.delete(item.matchId);
      }
    }
  }
}

export const chatOutboxExecutor = new ChatOutboxExecutor();

